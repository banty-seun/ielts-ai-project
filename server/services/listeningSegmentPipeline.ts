import type { TaskProgress } from "@shared/schema";
import {
  type ListeningSectionBlueprint,
  type ListeningSectionSegment,
  listeningSectionSegmentSchema,
} from "@shared/listening";
import { storage } from "../storage";
import { generateListeningSegmentFromBlueprint } from "../openai";
import { normalizeAccent } from "../utils/audio";
import {
  assertPromptVersionApprovedForProduction,
  recordPromptAssignmentOutcome,
  resolvePromptTemplateForExecution,
} from "./listeningPromptRegistry";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./listeningObservability";
import { isPrivacySafeLogMode, redactSensitive } from "../utils/privacy";

const SEGMENT_ROOT = "listeningSegments";
const DEFAULT_SEGMENT_TARGETS = [150, 150, 150];
const SECTION_DURATION_TOLERANCE_SECONDS = Number(process.env.LISTENING_SECTION_DURATION_TOLERANCE_SECONDS ?? 90);
const MAX_DURATION_REGEN_ATTEMPTS = Math.max(0, Number(process.env.LISTENING_SEGMENT_REGEN_ATTEMPTS ?? 1));
const SEGMENT_VERBOSE_LOGS = process.env.NODE_ENV !== "production";

const logSegmentDebug = (label: string, payload?: unknown) => {
  if (!SEGMENT_VERBOSE_LOGS) return;
  if (typeof payload === "undefined") {
    console.log(label);
    return;
  }
  console.log(label, isPrivacySafeLogMode() ? redactSensitive(payload) : payload);
};

const clampSegmentTarget = (value: number) => Math.max(120, Math.min(180, Math.round(value)));

const parseConfiguredSegmentTargets = () => {
  const raw = process.env.LISTENING_SEGMENT_TARGETS_SECONDS;
  if (!raw || !raw.trim()) {
    return null;
  }
  const parsed = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 3);

  if (parsed.length !== 3) {
    return null;
  }
  return parsed.map((value) => clampSegmentTarget(value));
};

const buildTargets = (task: TaskProgress) => {
  const configured = parseConfiguredSegmentTargets();
  if (configured) {
    return configured;
  }
  const sectionBudgetSeconds = Number(task.estimatedDurationSec ?? 480);
  const perSegment = Math.floor(sectionBudgetSeconds / 3);
  const target = clampSegmentTarget(perSegment || 150);
  return [target, target, target];
};

const persistSegments = async (
  task: TaskProgress,
  blueprint: ListeningSectionBlueprint,
  segments: ListeningSectionSegment[],
  promptMetadata: Record<string, unknown>,
) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  await storage.updateTaskProgress(task.id, {
    progressData: {
      ...progressData,
      [SEGMENT_ROOT]: {
        section_id: blueprint.section_id,
        section_no: blueprint.section_no,
        blueprint_id: blueprint.blueprint_id,
        prompt: promptMetadata,
        data: segments,
      },
    },
  });
};

const durationWithinBudget = (segments: ListeningSectionSegment[], targetSeconds: number) => {
  const total = segments.reduce((sum, segment) => sum + segment.predicted_duration_seconds, 0);
  return Math.abs(total - targetSeconds) <= SECTION_DURATION_TOLERANCE_SECONDS;
};

const selectSegmentForDurationRegen = (segments: ListeningSectionSegment[], targetSeconds: number): number => {
  const total = segments.reduce((sum, segment) => sum + segment.predicted_duration_seconds, 0);
  if (total > targetSeconds) {
    return segments.reduce(
      (bestIdx, segment, idx, arr) =>
        segment.predicted_duration_seconds > arr[bestIdx].predicted_duration_seconds ? idx : bestIdx,
      0,
    );
  }
  return segments.reduce(
    (bestIdx, segment, idx, arr) =>
      segment.predicted_duration_seconds < arr[bestIdx].predicted_duration_seconds ? idx : bestIdx,
    0,
  );
};

const logPromptAssignmentOutcome = async (params: {
  taskId: string;
  userId: string;
  sectionId: string;
  promptId: string;
  version: string;
  assignment: { mode?: unknown; bucket?: unknown; [key: string]: unknown };
  outcome: "success" | "failed";
  reason?: string;
}) => {
  logSegmentDebug("[PromptRegistry][Outcome]", {
    taskId: params.taskId,
    sectionId: params.sectionId,
    promptId: params.promptId,
    version: params.version,
    assignment: params.assignment,
    outcome: params.outcome,
    reason: params.reason,
  });
  await recordPromptAssignmentOutcome({
    promptId: params.promptId,
    version: params.version,
    taskProgressId: params.taskId,
    userId: params.userId,
    sectionId: params.sectionId,
    assignment: {
      mode: params.assignment.mode === "experiment" ? "experiment" : "default",
      bucket: Number.isFinite(Number(params.assignment.bucket)) ? Number(params.assignment.bucket) : null,
    },
    outcome: params.outcome,
    reason: params.reason ?? null,
    metadata: {
      assignment: params.assignment,
    },
  });
};

const generateSegment = async (params: {
  task: TaskProgress;
  blueprint: ListeningSectionBlueprint;
  segmentNo: 1 | 2 | 3;
  targetDurationSeconds: number;
  userLevel: number;
  targetBand: number;
  promptTemplate: string;
}): Promise<{ ok: true; segment: ListeningSectionSegment } | { ok: false; details: string[] }> => {
  const accentEntry = params.blueprint.accent_plan.segment_accents.find((entry) => entry.segment_no === params.segmentNo);
  const accent = normalizeAccent(accentEntry?.accent ?? params.blueprint.accent_plan.default_accent);
  const generated = await generateListeningSegmentFromBlueprint({
    blueprint: params.blueprint,
    segmentNo: params.segmentNo,
    targetDurationSeconds: params.targetDurationSeconds,
    userLevel: params.userLevel,
    targetBand: params.targetBand,
    accent,
    promptTemplate: params.promptTemplate,
  });

  if (!generated.success || !generated.transcript) {
    return {
      ok: false,
      details: [generated.error ?? "Failed to generate segment"],
    };
  }

  const segment: ListeningSectionSegment = {
    segment_id: `${params.blueprint.section_id}:segment-${params.segmentNo}`,
    section_id: params.blueprint.section_id,
    section_no: params.blueprint.section_no,
    segment_no: params.segmentNo,
    transcript_text: generated.transcript,
    predicted_duration_seconds: generated.predictedDurationSec ?? params.targetDurationSeconds,
    stable_id: `${params.blueprint.section_id}:S${params.segmentNo}:v1`,
    linkage: {
      previous_segment_id:
        params.segmentNo > 1 ? `${params.blueprint.section_id}:segment-${params.segmentNo - 1}` : null,
      next_segment_id: params.segmentNo < 3 ? `${params.blueprint.section_id}:segment-${params.segmentNo + 1}` : null,
      blueprint_id: params.blueprint.blueprint_id,
    },
    difficulty: generated.difficulty ?? `Band ${params.targetBand}`,
    difficulty_confidence: generated.difficultyConfidence ?? 0.75,
    accent_plan: {
      accent,
      voice_hint: accentEntry?.voice_hint,
    },
  };
  return {
    ok: true,
    segment: listeningSectionSegmentSchema.parse(segment),
  };
};

export const generateThreeLinkedSegments = async (params: {
  task: TaskProgress;
  blueprint: ListeningSectionBlueprint;
  userLevel: number;
  targetBand: number;
}) => {
  const { task, blueprint } = params;
  const spanContext = createTelemetryContext({
    traceId: `trc_script_${task.id}`,
    requestId: `req_script_${task.id}`,
    userId: task.userId,
    weeklyPlanId: task.weeklyPlanId,
    sessionId: task.id,
    sectionId: blueprint.section_id,
    partId: String(blueprint.section_no),
    agentName: "script_agent",
  });
  const scriptSpan = startListeningStageSpan({
    stage: "script_generated",
    context: spanContext,
    metadata: {
      section_no: blueprint.section_no,
      span_scope: "section",
    },
    taskProgressId: task.id,
  });
  const targets = buildTargets(task);
  const promptResolved = await resolvePromptTemplateForExecution({
    promptId: "listening.segment.generation",
    userId: task.userId,
    sectionId: blueprint.section_id,
  });
  await assertPromptVersionApprovedForProduction({
    promptId: promptResolved.selected.prompt_id,
    version: promptResolved.selected.version,
  });
  logSegmentDebug("[PromptRegistry][Assignment]", {
    taskId: task.id,
    sectionId: blueprint.section_id,
    promptId: promptResolved.selected.prompt_id,
    version: promptResolved.selected.version,
    assignment: promptResolved.assignment,
  });

  const segmentList: ListeningSectionSegment[] = [];
  for (let index = 0; index < 3; index += 1) {
    const segmentNo = (index + 1) as 1 | 2 | 3;
    const targetDuration = targets[index] ?? DEFAULT_SEGMENT_TARGETS[index];
    const partSpan = startListeningStageSpan({
      stage: "script_generated",
      context: createTelemetryContext({
        traceId: spanContext.trace_id,
        requestId: spanContext.request_id,
        userId: task.userId,
        weeklyPlanId: task.weeklyPlanId,
        sessionId: task.id,
        sectionId: blueprint.section_id,
        partId: String(segmentNo),
        agentName: "script_agent",
      }),
      attempt: 1,
      metadata: {
        section_no: blueprint.section_no,
        part_no: segmentNo,
        segment_no: segmentNo,
        span_scope: "part",
      },
      taskProgressId: task.id,
    });
    const generated = await generateSegment({
      task,
      blueprint,
      segmentNo,
      targetDurationSeconds: clampSegmentTarget(targetDuration),
      userLevel: params.userLevel,
      targetBand: params.targetBand,
      promptTemplate: promptResolved.selected.template,
    });
    if (!generated.ok) {
      await logPromptAssignmentOutcome({
        taskId: task.id,
        userId: task.userId,
        sectionId: blueprint.section_id,
        promptId: promptResolved.selected.prompt_id,
        version: promptResolved.selected.version,
        assignment: promptResolved.assignment,
        outcome: "failed",
        reason: "SEGMENT_GENERATION_FAILED",
      });
      await finishListeningStageSpan(partSpan, {
        success: false,
        errorClass: "SEGMENT_GENERATION_FAILED",
        metadata: {
          section_no: blueprint.section_no,
          part_no: segmentNo,
        },
      });
      await finishListeningStageSpan(scriptSpan, {
        success: false,
        errorClass: "SEGMENT_GENERATION_FAILED",
        metadata: {
          section_no: blueprint.section_no,
          segment_no: segmentNo,
        },
      });
      return {
        ok: false as const,
        errorCode: "SEGMENT_GENERATION_FAILED",
        retryable: true,
        segmentNo,
        details: generated.details,
      };
    }
    await finishListeningStageSpan(partSpan, {
      success: true,
      metadata: {
        section_no: blueprint.section_no,
        part_no: segmentNo,
      },
    });
    segmentList.push(generated.segment);
  }

  const targetSeconds = Number(task.estimatedDurationSec ?? 480);
  let regenAttempts = 0;
  while (!durationWithinBudget(segmentList, targetSeconds) && regenAttempts < MAX_DURATION_REGEN_ATTEMPTS) {
    const targetIdx = selectSegmentForDurationRegen(segmentList, targetSeconds);
    const segmentNo = (targetIdx + 1) as 1 | 2 | 3;
    const regenAttempt = regenAttempts + 1;
    const regenPartSpan = startListeningStageSpan({
      stage: "script_generated",
      context: createTelemetryContext({
        traceId: spanContext.trace_id,
        requestId: spanContext.request_id,
        userId: task.userId,
        weeklyPlanId: task.weeklyPlanId,
        sessionId: task.id,
        sectionId: blueprint.section_id,
        partId: String(segmentNo),
        agentName: "script_agent",
      }),
      attempt: regenAttempt,
      metadata: {
        section_no: blueprint.section_no,
        part_no: segmentNo,
        segment_no: segmentNo,
        span_scope: "part_regen",
      },
      taskProgressId: task.id,
    });
    const totalCurrent = segmentList.reduce((sum, segment) => sum + segment.predicted_duration_seconds, 0);
    const delta = targetSeconds - totalCurrent;
    const adjusted = clampSegmentTarget(segmentList[targetIdx].predicted_duration_seconds + Math.round(delta));
    const regenerated = await generateSegment({
      task,
      blueprint,
      segmentNo,
      targetDurationSeconds: adjusted,
      userLevel: params.userLevel,
      targetBand: params.targetBand,
      promptTemplate: promptResolved.selected.template,
    });
    if (!regenerated.ok) {
      await logPromptAssignmentOutcome({
        taskId: task.id,
        userId: task.userId,
        sectionId: blueprint.section_id,
        promptId: promptResolved.selected.prompt_id,
        version: promptResolved.selected.version,
        assignment: promptResolved.assignment,
        outcome: "failed",
        reason: "SEGMENT_DURATION_REGEN_FAILED",
      });
      await finishListeningStageSpan(regenPartSpan, {
        success: false,
        errorClass: "SEGMENT_DURATION_REGEN_FAILED",
        metadata: {
          section_no: blueprint.section_no,
          part_no: segmentNo,
          regen_attempt: regenAttempt,
        },
      });
      await finishListeningStageSpan(scriptSpan, {
        success: false,
        errorClass: "SEGMENT_DURATION_REGEN_FAILED",
        metadata: {
          section_no: blueprint.section_no,
          segment_no: segmentNo,
        },
      });
      return {
        ok: false as const,
        errorCode: "SEGMENT_DURATION_REGEN_FAILED",
        retryable: true,
        segmentNo,
        details: regenerated.details,
      };
    }
    await finishListeningStageSpan(regenPartSpan, {
      success: true,
      metadata: {
        section_no: blueprint.section_no,
        part_no: segmentNo,
        regen_attempt: regenAttempt,
      },
    });
    segmentList[targetIdx] = regenerated.segment;
    regenAttempts += 1;
  }

  if (!durationWithinBudget(segmentList, targetSeconds)) {
    await logPromptAssignmentOutcome({
      taskId: task.id,
      userId: task.userId,
      sectionId: blueprint.section_id,
      promptId: promptResolved.selected.prompt_id,
      version: promptResolved.selected.version,
      assignment: promptResolved.assignment,
      outcome: "failed",
      reason: "SEGMENT_DURATION_OUT_OF_BOUNDS",
    });
    await finishListeningStageSpan(scriptSpan, {
      success: false,
      errorClass: "SEGMENT_DURATION_OUT_OF_BOUNDS",
      metadata: {
        section_no: blueprint.section_no,
      },
    });
    return {
      ok: false as const,
      errorCode: "SEGMENT_DURATION_OUT_OF_BOUNDS",
      retryable: true,
      details: [`Segment durations exceed section tolerance after ${regenAttempts} regeneration attempt(s)`],
    };
  }

  await persistSegments(task, blueprint, segmentList, {
    prompt_id: promptResolved.selected.prompt_id,
    version: promptResolved.selected.version,
    prompt_registry_id: `${promptResolved.selected.prompt_id}@${promptResolved.selected.version}`,
    owner: promptResolved.selected.owner,
    approved_at: promptResolved.selected.approved_at,
    model_id: promptResolved.selected.model_id,
    model_settings: promptResolved.selected.model_settings,
    status: promptResolved.selected.status,
    assignment: promptResolved.assignment,
    assignment_outcome: "success",
  });
  await logPromptAssignmentOutcome({
    taskId: task.id,
    userId: task.userId,
    sectionId: blueprint.section_id,
    promptId: promptResolved.selected.prompt_id,
    version: promptResolved.selected.version,
    assignment: promptResolved.assignment,
    outcome: "success",
  });
  await finishListeningStageSpan(scriptSpan, {
    success: true,
    metadata: {
      section_no: blueprint.section_no,
      segments_generated: segmentList.length,
      regeneration_attempts: regenAttempts,
    },
  });

  return {
    ok: true as const,
    segments: segmentList,
    regeneration: {
      attempts: regenAttempts,
    },
    prompt: {
      id: promptResolved.selected.prompt_id,
      version: promptResolved.selected.version,
      assignment: promptResolved.assignment,
    },
  };
};

export const loadGeneratedSegments = (task: TaskProgress): ListeningSectionSegment[] => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const raw = progressData?.[SEGMENT_ROOT]?.data;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => listeningSectionSegmentSchema.safeParse(item))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => a.segment_no - b.segment_no);
};

export const regenerateSpecificSegments = async (params: {
  task: TaskProgress;
  blueprint: ListeningSectionBlueprint;
  existingSegments: ListeningSectionSegment[];
  segmentNos: number[];
  userLevel: number;
  targetBand: number;
}) => {
  const promptResolved = await resolvePromptTemplateForExecution({
    promptId: "listening.segment.generation",
    userId: params.task.userId,
    sectionId: params.blueprint.section_id,
  });
  await assertPromptVersionApprovedForProduction({
    promptId: promptResolved.selected.prompt_id,
    version: promptResolved.selected.version,
  });
  const targets = buildTargets(params.task);
  const next = [...params.existingSegments];

  for (const segNoRaw of params.segmentNos) {
    const segmentNo = Math.max(1, Math.min(3, Math.round(segNoRaw))) as 1 | 2 | 3;
    const regenerated = await generateSegment({
      task: params.task,
      blueprint: params.blueprint,
      segmentNo,
      targetDurationSeconds: targets[segmentNo - 1] ?? DEFAULT_SEGMENT_TARGETS[segmentNo - 1],
      userLevel: params.userLevel,
      targetBand: params.targetBand,
      promptTemplate: promptResolved.selected.template,
    });
    if (!regenerated.ok) {
      return {
        ok: false as const,
        errorCode: "SEGMENT_TARGETED_REGEN_FAILED",
        details: regenerated.details,
      };
    }
    const idx = next.findIndex((segment) => segment.segment_no === segmentNo);
    if (idx >= 0) {
      next[idx] = regenerated.segment;
    }
  }

  await persistSegments(params.task, params.blueprint, next, {
    prompt_id: promptResolved.selected.prompt_id,
    version: promptResolved.selected.version,
    prompt_registry_id: `${promptResolved.selected.prompt_id}@${promptResolved.selected.version}`,
    owner: promptResolved.selected.owner,
    approved_at: promptResolved.selected.approved_at,
    model_id: promptResolved.selected.model_id,
    model_settings: promptResolved.selected.model_settings,
    status: promptResolved.selected.status,
    assignment: promptResolved.assignment,
    targeted_regeneration: params.segmentNos,
  });

  return {
    ok: true as const,
    segments: next,
  };
};
