import { createHash, randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  listeningPromptAssignment,
  listeningPromptChangeRequest,
  listeningPromptExperiment,
  listeningPromptRegistry,
} from "@shared/schema";
import {
  LEGACY_LISTENING_SCRIPT_SYSTEM_PROMPT_TEMPLATE,
  LISTENING_ADVISOR_SYSTEM_PROMPT_TEMPLATE,
  LISTENING_QUESTION_SYSTEM_PROMPT_TEMPLATE,
  LISTENING_SEGMENT_PROMPT_TEMPLATE,
} from "./listeningPromptTemplates";

export type PromptStatus = "draft" | "active" | "inactive";

export interface PromptTemplateRecord {
  prompt_id: string;
  version: string;
  status: PromptStatus | "approved" | "deprecated";
  owner: string;
  approved_at: string | null;
  model_id: string;
  model_settings: Record<string, unknown>;
  created_by: string;
  created_at: string;
  template: string;
}

type PromptExperimentConfig = {
  enabled: boolean;
  percentage: number;
  candidateVersion: string | null;
};

type PromptAssignment = {
  mode: "default" | "experiment";
  bucket: number | null;
};

export type ListeningOutputClass = "scripts" | "questions" | "coaching";

type PromptChangeRequestStatus = "approved" | "rejected" | "post_hoc_pending" | "post_hoc_completed";

type PromptCompatibilityResult = {
  ok: boolean;
  issues: string[];
};

type PromptChangeRequestRecord = {
  id: string;
  prompt_id: string;
  version: string;
  output_class: ListeningOutputClass;
  risk_class: string;
  requested_by: string;
  approver_id: string | null;
  status: PromptChangeRequestStatus;
  staged_testing_evidence: string;
  expected_impact: string;
  rollback_criteria: string;
  quality_gate_passed: boolean;
  is_emergency: boolean;
  incident_ticket: string | null;
  post_hoc_review_due_at: string | null;
  post_hoc_reviewed_at: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const REGISTRY = new Map<string, PromptTemplateRecord[]>();
const EXPERIMENTS = new Map<string, PromptExperimentConfig>();
const CHANGE_REQUESTS = new Map<string, PromptChangeRequestRecord>();
const EXPERIMENT_FEATURE_FLAG = process.env.LISTENING_PROMPT_EXPERIMENTS_ENABLED !== "false";
const ALLOW_DIRECT_ACTIVATION = process.env.LISTENING_ALLOW_DIRECT_PROMPT_ACTIVATION === "true";
const EMERGENCY_POST_HOC_SLA_HOURS = Math.max(
  1,
  Number(process.env.LISTENING_GOVERNANCE_EMERGENCY_REVIEW_SLA_HOURS ?? 48),
);

export const PROMPT_OUTPUT_CLASS_TO_ID: Record<ListeningOutputClass, string> = {
  scripts: "listening.segment.generation",
  questions: "listening.question.generation",
  coaching: "listening.coaching.advisor",
};

const getDefaultTemplateByPromptId = (promptId: string) => {
  if (promptId === "listening.script.legacy") {
    return LEGACY_LISTENING_SCRIPT_SYSTEM_PROMPT_TEMPLATE;
  }
  if (promptId === "listening.question.generation") {
    return LISTENING_QUESTION_SYSTEM_PROMPT_TEMPLATE;
  }
  if (promptId === "listening.coaching.advisor") {
    return LISTENING_ADVISOR_SYSTEM_PROMPT_TEMPLATE;
  }
  return LISTENING_SEGMENT_PROMPT_TEMPLATE;
};

const getDefaultRecord = (promptId: string): PromptTemplateRecord => ({
  prompt_id: promptId,
  version: "1.0.0",
  status: "approved",
  owner: "platform_ai",
  approved_at: new Date().toISOString(),
  model_id: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  model_settings: {
    temperature: 0.4,
    response_format: "json_object",
  },
  created_by: "system",
  created_at: new Date().toISOString(),
  template: getDefaultTemplateByPromptId(promptId),
});

const normalizeStatus = (status: string): PromptTemplateRecord["status"] => {
  if (status === "approved" || status === "active" || status === "inactive" || status === "deprecated") {
    return status;
  }
  return "draft";
};

const compareVersions = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const bucketPercent = (seed: string): number => {
  const hash = createHash("sha1").update(seed).digest("hex").slice(0, 8);
  const value = parseInt(hash, 16);
  return value % 100;
};

const isNoTableError = (error: unknown) => {
  const message = String((error as any)?.message ?? "");
  return message.includes("does not exist") || message.includes("relation") || message.includes("no such table");
};

const ensureRegistryInMemory = (promptId: string) => {
  if (!REGISTRY.has(promptId)) {
    REGISTRY.set(promptId, [getDefaultRecord(promptId)]);
  }
  if (!EXPERIMENTS.has(promptId)) {
    EXPERIMENTS.set(promptId, {
      enabled: false,
      percentage: 0,
      candidateVersion: null,
    });
  }
};

const mapPromptChangeRequestRow = (row: typeof listeningPromptChangeRequest.$inferSelect): PromptChangeRequestRecord => ({
  id: row.id,
  prompt_id: row.promptId,
  version: row.version,
  output_class: row.outputClass as ListeningOutputClass,
  risk_class: row.riskClass,
  requested_by: row.requestedBy,
  approver_id: row.approverId ?? null,
  status: row.status as PromptChangeRequestStatus,
  staged_testing_evidence: row.stagedTestingEvidence,
  expected_impact: row.expectedImpact,
  rollback_criteria: row.rollbackCriteria,
  quality_gate_passed: Boolean(row.qualityGatePassed),
  is_emergency: Boolean(row.isEmergency),
  incident_ticket: row.incidentTicket ?? null,
  post_hoc_review_due_at: row.postHocReviewDueAt ? row.postHocReviewDueAt.toISOString() : null,
  post_hoc_reviewed_at: row.postHocReviewedAt ? row.postHocReviewedAt.toISOString() : null,
  reason: row.reason ?? null,
  metadata: (row.metadata ?? {}) as Record<string, unknown>,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

const refreshRegistryCacheFromDb = async (promptId: string) => {
  const rows = await db
    .select()
    .from(listeningPromptRegistry)
    .where(eq(listeningPromptRegistry.promptId, promptId));

  if (!rows.length) {
    return;
  }

  const mapped: PromptTemplateRecord[] = rows
    .map((row) => ({
      prompt_id: row.promptId,
      version: row.version,
      status: normalizeStatus(row.status),
      owner: row.owner,
      approved_at: row.approvedAt ? row.approvedAt.toISOString() : null,
      model_id: row.modelId,
      model_settings: (row.modelSettings ?? {}) as Record<string, unknown>,
      created_by: row.createdBy,
      created_at: row.createdAt.toISOString(),
      template: row.template,
    }))
    .sort((a, b) => compareVersions(a.version, b.version));

  REGISTRY.set(promptId, mapped);
};

const refreshExperimentCacheFromDb = async (promptId: string) => {
  const [row] = await db
    .select()
    .from(listeningPromptExperiment)
    .where(eq(listeningPromptExperiment.promptId, promptId))
    .limit(1);
  if (!row) {
    return;
  }
  EXPERIMENTS.set(promptId, {
    enabled: Boolean(row.enabled),
    percentage: Math.max(0, Math.min(100, Number(row.percentage ?? 0))),
    candidateVersion: row.candidateVersion ?? null,
  });
};

const ensureRegistryPersisted = async (promptId: string) => {
  try {
    await refreshRegistryCacheFromDb(promptId);
    if ((REGISTRY.get(promptId) ?? []).length === 0) {
      const defaultRecord = getDefaultRecord(promptId);
      await db.insert(listeningPromptRegistry).values({
        id: `lpr_${randomUUID()}`,
        promptId: defaultRecord.prompt_id,
        version: defaultRecord.version,
        status: defaultRecord.status,
        owner: defaultRecord.owner,
        approvedAt: defaultRecord.approved_at ? new Date(defaultRecord.approved_at) : null,
        modelId: defaultRecord.model_id,
        modelSettings: defaultRecord.model_settings,
        createdBy: defaultRecord.created_by,
        template: defaultRecord.template,
        metadata: {},
      });
      REGISTRY.set(promptId, [defaultRecord]);
    }

    await refreshExperimentCacheFromDb(promptId);
    if (!EXPERIMENTS.has(promptId)) {
      await db.insert(listeningPromptExperiment).values({
        promptId,
        enabled: false,
        percentage: 0,
        candidateVersion: null,
      });
      EXPERIMENTS.set(promptId, {
        enabled: false,
        percentage: 0,
        candidateVersion: null,
      });
    }
  } catch (error) {
    if (!isNoTableError(error)) {
      console.warn("[PromptRegistry][PersistenceFallback]", {
        promptId,
        error: String((error as any)?.message ?? error),
      });
    }
  }
};

const ensureRegistry = async (promptId: string) => {
  ensureRegistryInMemory(promptId);
  await ensureRegistryPersisted(promptId);
};

const activatePromptVersion = async (promptId: string, version: string) => {
  const versions = REGISTRY.get(promptId) ?? [];
  const exists = versions.some((item) => item.version === version);
  if (!exists) {
    throw new Error(`Prompt version not found: ${promptId}@${version}`);
  }
  const nowIso = new Date().toISOString();
  REGISTRY.set(
    promptId,
    versions.map((item) => ({
      ...item,
      status:
        item.version === version
          ? "approved"
          : item.status === "active" || item.status === "approved"
            ? "inactive"
            : item.status,
      approved_at: item.version === version ? nowIso : item.approved_at ?? null,
    })),
  );

  try {
    await db
      .update(listeningPromptRegistry)
      .set({
        status: "inactive",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(listeningPromptRegistry.promptId, promptId),
          eq(listeningPromptRegistry.status, "approved"),
        ),
      );
    await db
      .update(listeningPromptRegistry)
      .set({
        status: "approved",
        approvedAt: new Date(nowIso),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(listeningPromptRegistry.promptId, promptId),
          eq(listeningPromptRegistry.version, version),
        ),
      );
  } catch (error) {
    if (!isNoTableError(error)) {
      console.warn("[PromptRegistry][ActivationPersistenceFallback]", {
        promptId,
        version,
        error: String((error as any)?.message ?? error),
      });
    }
  }
};

export const listPromptVersions = async (promptId: string): Promise<PromptTemplateRecord[]> => {
  await ensureRegistry(promptId);
  return [...(REGISTRY.get(promptId) ?? [])].sort((a, b) => compareVersions(a.version, b.version));
};

export const registerPromptTemplate = async (record: PromptTemplateRecord) => {
  await ensureRegistry(record.prompt_id);
  const versions = REGISTRY.get(record.prompt_id) ?? [];
  const next = versions.filter((item) => item.version !== record.version);
  next.push(record);
  REGISTRY.set(record.prompt_id, next.sort((a, b) => compareVersions(a.version, b.version)));

  try {
    await db
      .insert(listeningPromptRegistry)
      .values({
        id: `lpr_${randomUUID()}`,
        promptId: record.prompt_id,
        version: record.version,
        status: record.status,
        owner: record.owner,
        approvedAt: record.approved_at ? new Date(record.approved_at) : null,
        modelId: record.model_id,
        modelSettings: record.model_settings ?? {},
        createdBy: record.created_by,
        template: record.template,
        metadata: {},
      })
      .onConflictDoUpdate({
        target: [listeningPromptRegistry.promptId, listeningPromptRegistry.version],
        set: {
          status: record.status,
          owner: record.owner,
          approvedAt: record.approved_at ? new Date(record.approved_at) : null,
          modelId: record.model_id,
          modelSettings: record.model_settings ?? {},
          createdBy: record.created_by,
          template: record.template,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    if (!isNoTableError(error)) {
      console.warn("[PromptRegistry][RegisterPersistenceFallback]", {
        promptId: record.prompt_id,
        version: record.version,
        error: String((error as any)?.message ?? error),
      });
    }
  }
};

export const getPromptVersionRecord = async (promptId: string, version: string): Promise<PromptTemplateRecord | null> => {
  await ensureRegistry(promptId);
  const versions = REGISTRY.get(promptId) ?? [];
  return versions.find((item) => item.version === version) ?? null;
};

export const setActivePromptVersion = async (promptId: string, version: string) => {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !ALLOW_DIRECT_ACTIVATION) {
    throw new Error("PROMPT_ACTIVATION_REQUIRES_PROMOTION");
  }
  await ensureRegistry(promptId);
  await activatePromptVersion(promptId, version);
};

export const promotePromptVersion = async (params: {
  promptId: string;
  version: string;
  qualityGatePassed: boolean;
}) => {
  if (!params.qualityGatePassed) {
    throw new Error(`Cannot promote ${params.promptId}@${params.version}: regression suite failed`);
  }
  await ensureRegistry(params.promptId);
  await activatePromptVersion(params.promptId, params.version);
};

export const configurePromptExperiment = async (params: {
  promptId: string;
  enabled: boolean;
  percentage: number;
  candidateVersion: string | null;
}) => {
  await ensureRegistry(params.promptId);
  const next: PromptExperimentConfig = {
    enabled: params.enabled,
    percentage: Math.max(0, Math.min(100, Math.round(params.percentage))),
    candidateVersion: params.candidateVersion,
  };
  EXPERIMENTS.set(params.promptId, next);

  try {
    await db
      .insert(listeningPromptExperiment)
      .values({
        promptId: params.promptId,
        enabled: next.enabled,
        percentage: next.percentage,
        candidateVersion: next.candidateVersion,
      })
      .onConflictDoUpdate({
        target: listeningPromptExperiment.promptId,
        set: {
          enabled: next.enabled,
          percentage: next.percentage,
          candidateVersion: next.candidateVersion,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    if (!isNoTableError(error)) {
      console.warn("[PromptRegistry][ExperimentPersistenceFallback]", {
        promptId: params.promptId,
        error: String((error as any)?.message ?? error),
      });
    }
  }
};

export const resolvePromptTemplateForExecution = async (params: {
  promptId: string;
  userId: string;
  sectionId: string;
}): Promise<{ selected: PromptTemplateRecord; assignment: PromptAssignment }> => {
  await ensureRegistry(params.promptId);
  const versions = REGISTRY.get(params.promptId) ?? [];
  const active =
    versions.find((item) => item.status === "approved" || item.status === "active") ??
    versions[versions.length - 1] ??
    getDefaultRecord(params.promptId);
  const experiment = EXPERIMENTS.get(params.promptId);

  if (EXPERIMENT_FEATURE_FLAG && experiment?.enabled && experiment.candidateVersion) {
    const candidate = versions.find((item) => item.version === experiment.candidateVersion);
    if (candidate) {
      const pct = bucketPercent(`${params.userId}:${params.sectionId}:${params.promptId}`);
      if (pct < experiment.percentage) {
        return {
          selected: candidate,
          assignment: {
            mode: "experiment",
            bucket: pct,
          },
        };
      }
    }
  }

  return {
    selected: active,
    assignment: {
      mode: "default",
      bucket: null,
    },
  };
};

export const assertPromptVersionApprovedForProduction = async (params: {
  promptId: string;
  version: string;
}) => {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) return;
  const record = await getPromptVersionRecord(params.promptId, params.version);
  if (!record) {
    throw new Error("UNAPPROVED_PROMPT_VERSION");
  }
  if (!(record.status === "approved" || record.status === "active")) {
    throw new Error("UNAPPROVED_PROMPT_VERSION");
  }
  if (!record.model_id || !record.approved_at) {
    throw new Error("UNAPPROVED_PROMPT_VERSION");
  }
};

export const recordPromptAssignmentOutcome = async (params: {
  promptId: string;
  version: string;
  taskProgressId?: string | null;
  userId?: string | null;
  sectionId?: string | null;
  assignment: PromptAssignment;
  outcome: "success" | "failed";
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  try {
    await db.insert(listeningPromptAssignment).values({
      id: `lpa_${randomUUID()}`,
      promptId: params.promptId,
      version: params.version,
      taskProgressId: params.taskProgressId ?? null,
      userId: params.userId ?? null,
      sectionId: params.sectionId ?? null,
      assignmentMode: params.assignment.mode,
      assignmentBucket: params.assignment.bucket,
      outcome: params.outcome,
      reason: params.reason ?? null,
      metadata: params.metadata ?? {},
    });
  } catch (error) {
    if (!isNoTableError(error)) {
      console.warn("[PromptRegistry][AssignmentPersistenceFallback]", {
        promptId: params.promptId,
        version: params.version,
        error: String((error as any)?.message ?? error),
      });
    }
  }
};

export const resolvePromptIdForOutputClass = (outputClass: ListeningOutputClass): string =>
  PROMPT_OUTPUT_CLASS_TO_ID[outputClass];

export const validatePromptTemplateCompatibility = (params: {
  outputClass: ListeningOutputClass;
  template: string;
}): PromptCompatibilityResult => {
  const template = String(params.template ?? "");
  const lower = template.toLowerCase();
  const issues: string[] = [];
  const pushIfMissing = (needles: string[], code: string) => {
    if (!needles.some((needle) => lower.includes(needle))) {
      issues.push(code);
    }
  };
  const pushIfMissingAll = (needles: string[], code: string) => {
    if (!needles.every((needle) => lower.includes(needle.toLowerCase()))) {
      issues.push(code);
    }
  };
  const pushMissingPlaceholders = (placeholders: string[], codePrefix: string) => {
    placeholders.forEach((placeholder) => {
      if (!template.includes(placeholder)) {
        issues.push(`${codePrefix}_${placeholder.replace(/[{}]/g, "").toUpperCase()}`);
      }
    });
  };

  if (params.outputClass === "scripts") {
    pushMissingPlaceholders(
      [
        "{{blueprint_context}}",
        "{{segment_no}}",
        "{{target_duration_seconds}}",
        "{{user_level}}",
        "{{target_band}}",
        "{{accent}}",
      ],
      "MISSING_SCRIPT_PLACEHOLDER",
    );
    pushIfMissingAll(
      ["\"transcript\"", "\"predicteddurationsec\"", "\"difficulty\"", "\"difficultyconfidence\""],
      "MISSING_SCRIPT_RESPONSE_SCHEMA",
    );
    pushIfMissing(["listening", "segment", "script"], "MISSING_SCRIPT_CONTEXT");
    pushIfMissing(["json", "valid"], "MISSING_JSON_CONTRACT");
  }
  if (params.outputClass === "questions") {
    pushMissingPlaceholders(["{{difficulty}}"], "MISSING_QUESTION_PLACEHOLDER");
    pushIfMissingAll(
      ["\"questions\"", "\"question\"", "\"options\"", "\"correctanswer\"", "\"explanation\""],
      "MISSING_QUESTION_RESPONSE_SCHEMA",
    );
    pushIfMissing(["exactly 10", "10 questions"], "MISSING_QUESTION_COUNT_CONTRACT");
    pushIfMissing(["question"], "MISSING_QUESTION_CONTEXT");
    pushIfMissing(["options", "choice"], "MISSING_OPTIONS_CONTEXT");
  }
  if (params.outputClass === "coaching") {
    pushIfMissingAll(["\"summary\"", "\"actions\""], "MISSING_COACHING_RESPONSE_SCHEMA");
    pushIfMissing(["exactly three", "3 actionable", "tip 1"], "MISSING_COACHING_ACTION_COUNT_CONTRACT");
    pushIfMissing(["coach", "advisor", "feedback"], "MISSING_COACHING_CONTEXT");
    pushIfMissing(["evidence", "weakness", "improvement"], "MISSING_EVIDENCE_CONTEXT");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
};

export const rollbackPromptVersionForOutputClass = async (params: {
  outputClass: ListeningOutputClass;
  actorId: string;
}) => {
  const promptId = resolvePromptIdForOutputClass(params.outputClass);
  await ensureRegistry(promptId);
  const versions = [...(REGISTRY.get(promptId) ?? [])].sort((a, b) => compareVersions(a.version, b.version));
  if (versions.length < 2) {
    throw new Error(`No rollback candidate available for ${promptId}`);
  }
  const active =
    versions.find((item) => item.status === "approved" || item.status === "active") ??
    versions[versions.length - 1];
  if (!active) {
    throw new Error(`No active prompt version found for ${promptId}`);
  }

  const rollbackCandidate =
    [...versions]
      .filter((item) => item.version !== active.version && compareVersions(item.version, active.version) < 0)
      .sort((a, b) => compareVersions(b.version, a.version))[0] ??
    [...versions]
      .filter((item) => item.version !== active.version)
      .sort((a, b) => compareVersions(b.version, a.version))[0];

  if (!rollbackCandidate) {
    throw new Error(`No rollback candidate available for ${promptId}`);
  }
  const compatibility = validatePromptTemplateCompatibility({
    outputClass: params.outputClass,
    template: rollbackCandidate.template,
  });
  if (!compatibility.ok) {
    throw new Error(
      `ROLLBACK_COMPATIBILITY_FAILED: ${promptId}@${rollbackCandidate.version} (${compatibility.issues.join(",")})`,
    );
  }

  await activatePromptVersion(promptId, rollbackCandidate.version);
  return {
    promptId,
    fromVersion: active.version,
    toVersion: rollbackCandidate.version,
    actorId: params.actorId,
    compatibility,
  };
};

export const createPromptChangeRequest = async (params: {
  promptId: string;
  version: string;
  outputClass: ListeningOutputClass;
  riskClass: string;
  requestedBy: string;
  approverId?: string | null;
  status: PromptChangeRequestStatus;
  stagedTestingEvidence: string;
  expectedImpact: string;
  rollbackCriteria: string;
  qualityGatePassed: boolean;
  isEmergency: boolean;
  incidentTicket?: string | null;
  postHocReviewDueAt?: Date | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  const now = new Date();
  const dueAt =
    params.postHocReviewDueAt ??
    (params.isEmergency ? new Date(now.getTime() + EMERGENCY_POST_HOC_SLA_HOURS * 60 * 60 * 1000) : null);
  const record: PromptChangeRequestRecord = {
    id: `pcr_${randomUUID()}`,
    prompt_id: params.promptId,
    version: params.version,
    output_class: params.outputClass,
    risk_class: params.riskClass,
    requested_by: params.requestedBy,
    approver_id: params.approverId ?? null,
    status: params.status,
    staged_testing_evidence: params.stagedTestingEvidence,
    expected_impact: params.expectedImpact,
    rollback_criteria: params.rollbackCriteria,
    quality_gate_passed: Boolean(params.qualityGatePassed),
    is_emergency: Boolean(params.isEmergency),
    incident_ticket: params.incidentTicket ?? null,
    post_hoc_review_due_at: dueAt ? dueAt.toISOString() : null,
    post_hoc_reviewed_at: null,
    reason: params.reason ?? null,
    metadata: params.metadata ?? {},
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  CHANGE_REQUESTS.set(record.id, record);

  try {
    const [created] = await db
      .insert(listeningPromptChangeRequest)
      .values({
        id: record.id,
        promptId: record.prompt_id,
        version: record.version,
        outputClass: record.output_class,
        riskClass: record.risk_class,
        requestedBy: record.requested_by,
        approverId: record.approver_id,
        status: record.status,
        stagedTestingEvidence: record.staged_testing_evidence,
        expectedImpact: record.expected_impact,
        rollbackCriteria: record.rollback_criteria,
        qualityGatePassed: record.quality_gate_passed,
        isEmergency: record.is_emergency,
        incidentTicket: record.incident_ticket,
        postHocReviewDueAt: dueAt,
        postHocReviewedAt: null,
        reason: record.reason,
        metadata: record.metadata,
        updatedAt: now,
      })
      .returning();
    if (created) {
      const mapped = mapPromptChangeRequestRow(created);
      CHANGE_REQUESTS.set(mapped.id, mapped);
      return mapped;
    }
  } catch (error) {
    if (!isNoTableError(error)) {
      console.warn("[PromptRegistry][ChangeRequestPersistenceFallback]", {
        promptId: params.promptId,
        version: params.version,
        error: String((error as any)?.message ?? error),
      });
    }
  }
  return record;
};

export const listPromptChangeRequests = async (params?: {
  promptId?: string;
  status?: string;
  limit?: number;
}) => {
  const limit = Math.max(1, Math.min(500, Number(params?.limit ?? 100)));
  try {
    const conditions = [];
    if (params?.promptId) {
      conditions.push(eq(listeningPromptChangeRequest.promptId, params.promptId));
    }
    if (params?.status) {
      conditions.push(eq(listeningPromptChangeRequest.status, params.status));
    }
    const rows = await db
      .select()
      .from(listeningPromptChangeRequest)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(listeningPromptChangeRequest.createdAt))
      .limit(limit);
    const mapped = rows.map(mapPromptChangeRequestRow);
    for (const row of mapped) {
      CHANGE_REQUESTS.set(row.id, row);
    }
    return mapped;
  } catch (error) {
    if (!isNoTableError(error)) {
      console.warn("[PromptRegistry][ChangeRequestListFallback]", {
        error: String((error as any)?.message ?? error),
      });
    }
  }

  return [...CHANGE_REQUESTS.values()]
    .filter((item) => (params?.promptId ? item.prompt_id === params.promptId : true))
    .filter((item) => (params?.status ? item.status === params.status : true))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
};

export const listOverduePostHocPromptChanges = async (now = new Date()) => {
  const nowTime = now.getTime();
  const all = await listPromptChangeRequests({ limit: 500 });
  return all.filter((item) => {
    if (item.status !== "post_hoc_pending") return false;
    if (!item.post_hoc_review_due_at) return false;
    return new Date(item.post_hoc_review_due_at).getTime() < nowTime;
  });
};

export const markPromptChangeRequestPostHocReviewed = async (params: {
  id: string;
  reviewedBy: string;
  reason?: string;
}) => {
  const now = new Date();
  try {
    const [updated] = await db
      .update(listeningPromptChangeRequest)
      .set({
        status: "post_hoc_completed",
        postHocReviewedAt: now,
        reason: params.reason ?? null,
        metadata: {
          reviewed_by: params.reviewedBy,
          review_reason: params.reason ?? null,
        },
        updatedAt: now,
      })
      .where(eq(listeningPromptChangeRequest.id, params.id))
      .returning();
    if (updated) {
      const mapped = mapPromptChangeRequestRow(updated);
      CHANGE_REQUESTS.set(mapped.id, mapped);
      return mapped;
    }
    return null;
  } catch (error) {
    if (!isNoTableError(error)) {
      console.warn("[PromptRegistry][PostHocReviewFallback]", {
        id: params.id,
        error: String((error as any)?.message ?? error),
      });
    }
  }

  const existing = CHANGE_REQUESTS.get(params.id);
  if (!existing) return null;
  const next: PromptChangeRequestRecord = {
    ...existing,
    status: "post_hoc_completed",
    post_hoc_reviewed_at: now.toISOString(),
    reason: params.reason ?? existing.reason ?? null,
    metadata: {
      ...existing.metadata,
      reviewed_by: params.reviewedBy,
      review_reason: params.reason ?? null,
    },
    updated_at: now.toISOString(),
  };
  CHANGE_REQUESTS.set(next.id, next);
  return next;
};
