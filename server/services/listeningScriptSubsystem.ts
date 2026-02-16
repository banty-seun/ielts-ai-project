import type { TaskProgress } from "@shared/schema";
import { createAndPersistSectionBlueprint } from "./listeningBlueprint";
import { generateThreeLinkedSegments, regenerateSpecificSegments } from "./listeningSegmentPipeline";
import { buildAnchorsForSegments, persistAnchors, validateAnchorsForSection } from "./listeningAnchors";
import { evaluateContinuity } from "./listeningContinuity";
import { runPromptQualityRegression } from "./listeningPromptRegression";
import { getAnchorRecoveryDecision } from "./listeningAnchorRecoveryPolicy";

const ANCHOR_RECOVERY_POLICY = (process.env.LISTENING_ANCHOR_RECOVERY_POLICY ?? "anchor_map").toLowerCase();
const MAX_ANCHOR_RECOVERY_ATTEMPTS = Math.max(1, Number(process.env.LISTENING_ANCHOR_RECOVERY_ATTEMPTS ?? 2));
const MAX_CONTINUITY_REGEN_ATTEMPTS = Math.max(0, Number(process.env.LISTENING_CONTINUITY_REGEN_ATTEMPTS ?? 1));

const joinSegmentsTranscript = (segments: Array<{ segment_no: number; transcript_text: string }>) => {
  return segments
    .sort((a, b) => a.segment_no - b.segment_no)
    .map((segment) => segment.transcript_text.trim())
    .join("\n\n");
};

const clampAnchorsToSegmentBounds = (
  anchors: ReturnType<typeof buildAnchorsForSegments>,
  segments: Array<{ segment_no: number; predicted_duration_seconds: number }>,
) => {
  const durations = new Map(segments.map((segment) => [segment.segment_no, segment.predicted_duration_seconds]));
  return anchors.map((anchor) => {
    const duration = Number(durations.get(anchor.segment_no) ?? 1);
    const maxOffset = Math.max(0, duration - 1);
    return {
      ...anchor,
      offset_seconds: Math.max(0, Math.min(anchor.offset_seconds, maxOffset)),
    };
  });
};

export const runListeningScriptSubsystem = async (params: {
  task: TaskProgress;
  userLevel: number;
  targetBand: number;
  sectionNo?: number;
}) => {
  const sectionNo = params.sectionNo ?? 1;
  const blueprintResult = await createAndPersistSectionBlueprint(params.task, sectionNo);
  if (!blueprintResult.ok) {
    return {
      ...blueprintResult,
      stage: "blueprint" as const,
    };
  }

  let segmentResult = await generateThreeLinkedSegments({
    task: params.task,
    blueprint: blueprintResult.blueprint,
    userLevel: params.userLevel,
    targetBand: params.targetBand,
  });
  if (!segmentResult.ok) {
    return {
      ...segmentResult,
      stage: "segments" as const,
    };
  }

  let activeSegments = segmentResult.segments;
  let anchors = buildAnchorsForSegments({
    task: params.task,
    segments: activeSegments,
  });
  const progressData = (params.task.progressData ?? {}) as Record<string, any>;
  const ttsDurationsBySegmentNo = Array.isArray(progressData.segments)
    ? progressData.segments.reduce((acc: Record<number, number>, segment: any) => {
        const partNo = Number(segment?.ieltsPart);
        const duration = Number(segment?.estimatedDurationSec);
        if (Number.isFinite(partNo) && Number.isFinite(duration) && duration > 0) {
          acc[partNo] = duration;
        }
        return acc;
      }, {})
    : {};
  let anchorValidation = validateAnchorsForSection({
    task: params.task,
    anchors,
    segments: activeSegments,
    ttsDurationsBySegmentNo,
  });
  let anchorRecoveryAttempts = 0;
  while (!anchorValidation.ok) {
    const decision = getAnchorRecoveryDecision({
      policy: ANCHOR_RECOVERY_POLICY,
      attempt: anchorRecoveryAttempts,
      maxAttempts: MAX_ANCHOR_RECOVERY_ATTEMPTS,
    });
    if (decision === "stop") {
      break;
    }

    if (decision === "anchor_map") {
      anchors = clampAnchorsToSegmentBounds(anchors, activeSegments);
      anchorValidation = validateAnchorsForSection({
        task: params.task,
        anchors,
        segments: activeSegments,
        ttsDurationsBySegmentNo,
      });
      anchorRecoveryAttempts += 1;
      continue;
    }

    const segmentNos = anchors
      .filter((anchor) => anchorValidation.errors.some((error) => error.startsWith(`${anchor.anchor_id}:`)))
      .map((anchor) => anchor.segment_no);
    const regen = await regenerateSpecificSegments({
      task: params.task,
      blueprint: blueprintResult.blueprint,
      existingSegments: activeSegments,
      segmentNos,
      userLevel: params.userLevel,
      targetBand: params.targetBand,
    });
    if (!regen.ok) {
      break;
    }
    activeSegments = regen.segments;
    anchors = buildAnchorsForSegments({
      task: params.task,
      segments: activeSegments,
    });
    anchorValidation = validateAnchorsForSection({
      task: params.task,
      anchors,
      segments: activeSegments,
      ttsDurationsBySegmentNo,
    });
    anchorRecoveryAttempts += 1;
  }
  await persistAnchors(params.task, anchors, anchorValidation);
  if (!anchorValidation.ok) {
    return {
      ok: false as const,
      errorCode: "ANCHOR_VALIDATION_FAILED",
      retryable: true,
      stage: "anchors" as const,
      details: anchorValidation.errors,
      anchorValidation,
      anchorRecoveryAttempts,
    };
  }

  let continuity = await evaluateContinuity({
    task: params.task,
    blueprint: blueprintResult.blueprint,
    segments: activeSegments,
  });
  let continuityRecoveryAttempts = 0;
  while (!continuity.ok && continuity.retryable && continuityRecoveryAttempts < MAX_CONTINUITY_REGEN_ATTEMPTS) {
    const affectedSegmentNos = Array.from(
      new Set(
        continuity.report.issues
          .flatMap((issue) => issue.segment_refs)
          .filter((segmentNo) => Number.isFinite(segmentNo) && segmentNo > 0),
      ),
    );
    if (affectedSegmentNos.length === 0) {
      break;
    }

    const regen = await regenerateSpecificSegments({
      task: params.task,
      blueprint: blueprintResult.blueprint,
      existingSegments: activeSegments,
      segmentNos: affectedSegmentNos,
      userLevel: params.userLevel,
      targetBand: params.targetBand,
    });
    if (!regen.ok) {
      break;
    }
    activeSegments = regen.segments;
    continuityRecoveryAttempts += 1;
    continuity = await evaluateContinuity({
      task: params.task,
      blueprint: blueprintResult.blueprint,
      segments: activeSegments,
    });
  }
  if (!continuity.ok) {
    return {
      ok: false as const,
      errorCode: continuity.errorCode,
      retryable: continuity.retryable,
      stage: "continuity" as const,
      details: continuity.report.issues.map((issue) => issue.message),
      continuity: continuity.report,
      continuityRecoveryAttempts,
    };
  }

  const regression = runPromptQualityRegression(activeSegments);
  if (!regression.ok) {
    return {
      ok: false as const,
      errorCode: "PROMPT_REGRESSION_FAILED",
      retryable: false,
      stage: "regression" as const,
      details: regression.failures,
    };
  }

  const combinedScript = joinSegmentsTranscript(activeSegments);
  const avgDifficultyConfidence =
    activeSegments.reduce((sum, segment) => sum + segment.difficulty_confidence, 0) / activeSegments.length;

  return {
    ok: true as const,
    blueprint: blueprintResult.blueprint,
    segments: activeSegments,
    anchors,
    prompt: segmentResult.prompt,
    anchorRecoveryAttempts,
    continuityRecoveryAttempts,
    continuity: continuity.report,
    scriptText: combinedScript,
    estimatedDurationSec: activeSegments.reduce(
      (sum, segment) => sum + segment.predicted_duration_seconds,
      0,
    ),
    difficulty: `Band ${params.targetBand}`,
    difficultyConfidence: Number(avgDifficultyConfidence.toFixed(2)),
  };
};
