import { randomUUID } from "crypto";
import type { TaskProgress } from "@shared/schema";
import {
  type ListeningSectionBlueprint,
  listeningSectionBlueprintSchema,
  resolveExpectedContextType,
  validateContextScriptTypeCompatibility,
  validateBlueprintQuality,
} from "@shared/listening";
import { normalizeAccent } from "../utils/audio";
import { storage } from "../storage";

const BLUEPRINT_ROOT = "listeningBlueprint";

const isTransientBlueprintError = (code: string) => {
  return code === "BLUEPRINT_BUILD_FAILED";
};

export const buildSectionBlueprint = (task: TaskProgress, sectionNo = 1): ListeningSectionBlueprint => {
  const sectionId = `${task.id}:section-${sectionNo}`;
  const compatibility = validateContextScriptTypeCompatibility({
    ieltsPart: task.ieltsPart,
    scriptType: task.scriptType,
  });
  if (!compatibility.ok) {
    const error = new Error(compatibility.errors.join("; "));
    (error as any).code = "BLUEPRINT_CONTEXT_VALIDATION_FAILED";
    throw error;
  }
  const contextType = resolveExpectedContextType({
    ieltsPart: task.ieltsPart,
    scriptType: task.scriptType,
  });
  const scriptType = String(task.scriptType ?? "dialogue").toLowerCase() === "monologue" ? "monologue" : "dialogue";
  const contextLabel = task.contextLabel ?? "Listening context";
  const topicDomain = task.topicDomain ?? "General";
  const scenarioOverview = task.scenarioOverview ?? `${contextLabel} in ${topicDomain}`;
  const defaultAccent = normalizeAccent(task.accent ?? "British");

  const blueprint: ListeningSectionBlueprint = {
    blueprint_id: `bp_${randomUUID()}`,
    blueprint_version: 1,
    section_id: sectionId,
    section_no: sectionNo,
    context_type: contextType,
    entities: [
      { id: "entity-1", name: "Speaker A", role: scriptType === "monologue" ? "presenter" : "participant" },
      { id: "entity-2", name: "Speaker B", role: scriptType === "monologue" ? "audience" : "participant" },
    ],
    timeline: [
      { id: "t1", label: "Setup", order: 1 },
      { id: "t2", label: "Details", order: 2 },
      { id: "t3", label: "Outcome", order: 3 },
    ],
    facts: [
      { id: "f1", text: `Topic domain is ${topicDomain}` },
      { id: "f2", text: `Context label is ${contextLabel}` },
      { id: "f3", text: scenarioOverview },
    ],
    roles: scriptType === "monologue" ? ["presenter", "audience"] : ["participant_a", "participant_b"],
    accent_plan: {
      default_accent: defaultAccent,
      segment_accents: [
        { segment_no: 1, accent: defaultAccent },
        { segment_no: 2, accent: defaultAccent },
        { segment_no: 3, accent: defaultAccent },
      ],
    },
    topic_domain: topicDomain,
    context_label: contextLabel,
    scenario_overview: scenarioOverview,
    script_type: scriptType,
    created_at: new Date().toISOString(),
  };

  return listeningSectionBlueprintSchema.parse(blueprint);
};

export const persistSectionBlueprint = async (task: TaskProgress, blueprint: ListeningSectionBlueprint) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const existing = (progressData[BLUEPRINT_ROOT] ?? {}) as Record<string, any>;
  const currentVersion = Number(existing?.version ?? 0);
  const nextVersion = Math.max(currentVersion + 1, blueprint.blueprint_version);
  const persisted = {
    ...blueprint,
    blueprint_version: nextVersion,
  };

  await storage.updateTaskProgress(task.id, {
    progressData: {
      ...progressData,
      [BLUEPRINT_ROOT]: {
        section_id: persisted.section_id,
        version: persisted.blueprint_version,
        data: persisted,
      },
    },
  });

  return persisted;
};

export const createAndPersistSectionBlueprint = async (task: TaskProgress, sectionNo = 1) => {
  try {
    const blueprint = buildSectionBlueprint(task, sectionNo);
    const quality = validateBlueprintQuality(blueprint);

    if (!quality.ok) {
      return {
        ok: false as const,
        errorCode: "BLUEPRINT_QUALITY_FAILED",
        retryable: false,
        details: quality.errors,
      };
    }

    const persisted = await persistSectionBlueprint(task, blueprint);
    return {
      ok: true as const,
      blueprint: persisted,
    };
  } catch (error: any) {
    const errorCode = typeof error?.code === "string" ? error.code : "BLUEPRINT_BUILD_FAILED";
    return {
      ok: false as const,
      errorCode,
      retryable: isTransientBlueprintError(errorCode),
      details: [String(error?.message ?? "Failed to create blueprint")],
    };
  }
};

export const loadSectionBlueprint = (task: TaskProgress): ListeningSectionBlueprint | null => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const raw = progressData?.[BLUEPRINT_ROOT]?.data;
  const parsed = listeningSectionBlueprintSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};
