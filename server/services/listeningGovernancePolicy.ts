import type { TaskProgress } from "@shared/schema";
import type {
  ListeningEvidenceReference,
  ListeningGovernanceCheckResult,
  ListeningGovernanceProvenance,
  ListeningPerformanceAnalysis,
  ListeningRiskClass,
} from "@shared/listening";
import {
  listeningGovernanceCheckResultSchema,
  listeningGovernanceProvenanceSchema,
} from "@shared/listening";

const GOVERNANCE_POLICY_VERSION = process.env.LISTENING_GOVERNANCE_POLICY_VERSION ?? "J-1.0.0";
const GOVERNANCE_VALIDATOR_SET_VERSION =
  process.env.LISTENING_GOVERNANCE_VALIDATOR_SET_VERSION ?? "J-validators-1.0.0";
const COACH_CONFIDENCE_THRESHOLD = Math.max(
  0,
  Math.min(1, Number(process.env.LISTENING_COACH_CONFIDENCE_THRESHOLD ?? 0.6)),
);

const PROHIBITED_PATTERNS = [
  /\bignore previous instructions\b/i,
  /\bsystem prompt\b/i,
  /\bapi[_\s-]?key\b/i,
  /\bsecret\b/i,
  /\bpassword\b/i,
];

const hasProhibitedContent = (text: string) => {
  const normalized = String(text ?? "");
  return PROHIBITED_PATTERNS.some((pattern) => pattern.test(normalized));
};

const derivePromptModelFromTask = (task: TaskProgress) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const prompt = (progressData?.listeningSegments?.prompt ?? {}) as Record<string, any>;
  const promptId = String(prompt?.prompt_id ?? "listening.segment.generation");
  const promptVersion = String(prompt?.version ?? "unknown");
  const registryId = String(prompt?.prompt_registry_id ?? `${promptId}@${promptVersion}`);
  const status = String(prompt?.status ?? "draft");
  const approvedAt = typeof prompt?.approved_at === "string" ? prompt.approved_at : null;
  const modelId = String(prompt?.model_id ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini");
  const modelSettings =
    prompt?.model_settings && typeof prompt.model_settings === "object"
      ? prompt.model_settings
      : {};
  const owner = String(prompt?.owner ?? "platform_ai");
  return {
    prompt_id: promptId,
    prompt_version: promptVersion,
    prompt_registry_id: registryId,
    model_id: modelId,
    model_settings: modelSettings,
    owner,
    approved_at: approvedAt ?? new Date(0).toISOString(),
    status:
      status === "approved" || status === "active" || status === "deprecated"
        ? (status === "active" ? "approved" : status)
        : "draft",
  } as const;
};

export const buildGovernanceProvenance = (params: {
  task: TaskProgress;
  riskClass: ListeningRiskClass;
  confidenceScore?: number | null;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
}): ListeningGovernanceProvenance => {
  const promptModel = derivePromptModelFromTask(params.task);
  return listeningGovernanceProvenanceSchema.parse({
    policy_version: GOVERNANCE_POLICY_VERSION,
    risk_class: params.riskClass,
    validator_set_version: GOVERNANCE_VALIDATOR_SET_VERSION,
    prompt_model: promptModel,
    confidence_threshold: params.riskClass === "personalized_coaching" ? COACH_CONFIDENCE_THRESHOLD : undefined,
    confidence_score:
      typeof params.confidenceScore === "number" && Number.isFinite(params.confidenceScore)
        ? Number(Math.max(0, Math.min(1, params.confidenceScore)).toFixed(4))
        : undefined,
    fallback_used: params.fallbackUsed ?? undefined,
    fallback_reason: params.fallbackReason ?? undefined,
  });
};

export const runGovernancePolicyGateForManifest = (task: TaskProgress): ListeningGovernanceCheckResult => {
  const promptModel = derivePromptModelFromTask(task);
  if (!(promptModel.status === "approved")) {
    return listeningGovernanceCheckResultSchema.parse({
      ok: false,
      code: "UNAPPROVED_PROMPT_VERSION",
      message: "Prompt version is not approved for production",
      risk_class: "learning_content",
      diagnostics: {
        prompt_registry_id: promptModel.prompt_registry_id,
        status: promptModel.status,
      },
    });
  }

  if (hasProhibitedContent(String(task.scriptText ?? ""))) {
    return listeningGovernanceCheckResultSchema.parse({
      ok: false,
      code: "PROHIBITED_CONTENT_DETECTED",
      message: "Prohibited content detected in generated transcript",
      risk_class: "learning_content",
      diagnostics: {
        section_id: task.id,
      },
    });
  }

  return listeningGovernanceCheckResultSchema.parse({
    ok: true,
    risk_class: "learning_content",
    diagnostics: {
      prompt_registry_id: promptModel.prompt_registry_id,
      policy_version: GOVERNANCE_POLICY_VERSION,
      validator_set_version: GOVERNANCE_VALIDATOR_SET_VERSION,
    },
  });
};

const flattenEvidence = (analysis: ListeningPerformanceAnalysis): ListeningEvidenceReference[] => {
  return analysis.personalized_strategies.flatMap((strategy) => {
    return strategy.evidence_refs ?? [];
  });
};

const questionRefRegex = /\bq(?:uestion)?\s*#?\s*(\d+)\b/gi;
const sectionRefRegex = /\bsection\s*#?\s*(\d+)\b/gi;

const assertTextGroundedToEvidence = (text: string, evidence: ListeningEvidenceReference[]) => {
  const allowedQuestions = new Set<number>();
  const allowedSections = new Set<number>();
  evidence.forEach((entry) => {
    entry.question_ids.forEach((qid) => allowedQuestions.add(qid));
    allowedSections.add(entry.part_id);
  });

  for (const match of text.matchAll(questionRefRegex)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && !allowedQuestions.has(value)) {
      return false;
    }
  }
  for (const match of text.matchAll(sectionRefRegex)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && !allowedSections.has(value)) {
      return false;
    }
  }
  return true;
};

export const runGovernancePolicyGateForCoachAnalysis = (analysis: ListeningPerformanceAnalysis) => {
  const evidence = flattenEvidence(analysis);
  if (!evidence.length) {
    return listeningGovernanceCheckResultSchema.parse({
      ok: false,
      code: "EVIDENCE_MISSING",
      message: "Coaching claims must include evidence references",
      risk_class: "personalized_coaching",
      diagnostics: {},
    });
  }

  const missingEvidence = analysis.personalized_strategies.find(
    (strategy) => !Array.isArray(strategy.evidence_refs) || strategy.evidence_refs.length === 0,
  );
  if (missingEvidence) {
    return listeningGovernanceCheckResultSchema.parse({
      ok: false,
      code: "EVIDENCE_MISSING",
      message: "A strategy is missing evidence references",
      risk_class: "personalized_coaching",
      diagnostics: {
        strategy_title: missingEvidence.title,
      },
    });
  }

  const confidence = Number(analysis.root_cause?.confidence ?? 0);
  if (Number.isFinite(confidence) && confidence < COACH_CONFIDENCE_THRESHOLD && analysis.fallback.used !== true) {
    return listeningGovernanceCheckResultSchema.parse({
      ok: false,
      code: "CONFIDENCE_BELOW_THRESHOLD",
      message: "Generative coaching requires fallback when confidence is below threshold",
      risk_class: "personalized_coaching",
      diagnostics: {
        confidence,
        threshold: COACH_CONFIDENCE_THRESHOLD,
      },
    });
  }

  const ungroundedStrategy = analysis.personalized_strategies.find(
    (strategy) => !assertTextGroundedToEvidence(`${strategy.rationale} ${strategy.action}`, strategy.evidence_refs),
  );
  if (ungroundedStrategy) {
    return listeningGovernanceCheckResultSchema.parse({
      ok: false,
      code: "UNGROUNDED_CLAIM",
      message: "A coaching strategy contains references not present in session evidence",
      risk_class: "personalized_coaching",
      diagnostics: {
        strategy_title: ungroundedStrategy.title,
      },
    });
  }

  return listeningGovernanceCheckResultSchema.parse({
    ok: true,
    risk_class: "personalized_coaching",
    diagnostics: {
      policy_version: GOVERNANCE_POLICY_VERSION,
      validator_set_version: GOVERNANCE_VALIDATOR_SET_VERSION,
      confidence_threshold: COACH_CONFIDENCE_THRESHOLD,
    },
  });
};

export const getListeningGovernancePolicyInfo = () => {
  return {
    policyVersion: GOVERNANCE_POLICY_VERSION,
    validatorSetVersion: GOVERNANCE_VALIDATOR_SET_VERSION,
    confidenceThreshold: COACH_CONFIDENCE_THRESHOLD,
    riskClasses: [
      "learning_content",
      "scoring_feedback",
      "personalized_coaching",
      "plan_adjustment",
    ] as ListeningRiskClass[],
    checksByRiskClass: {
      learning_content: ["schema_validation", "prohibited_output", "prompt_approval"],
      scoring_feedback: ["schema_validation", "tag_consistency"],
      personalized_coaching: ["schema_validation", "evidence_binding", "confidence_threshold", "grounded_claims"],
      plan_adjustment: ["schema_validation", "prohibited_output"],
    },
    ownershipAndApprovalChain: {
      promptRegistryOwner: "platform_ai",
      modelPolicyOwner: "platform_ai",
      releaseApproverRole: "reviewer",
      exceptionApproverRole: "admin",
    },
    productionExceptionPolicy: {
      requiredFields: ["owner", "expires_at", "reason", "incident_ticket_optional"],
      expiryRequired: true,
    },
  };
};
