import type { TaskProgress } from "@shared/schema";
import { listeningAnchorSchema, type ListeningAnchor, type ListeningSectionSegment } from "@shared/listening";
import { storage } from "../storage";

const ANCHOR_ROOT = "listeningAnchors";
type ConfiguredBlockAnchorContract = {
  segment_no: number;
  question_range?: { from: number; to: number };
};

const parseQuestionNo = (questionId: string, fallback: number) => {
  const m = String(questionId).match(/(\d+)/);
  if (!m) return fallback;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : fallback;
};

export const buildAnchorsForSegments = (params: {
  task: TaskProgress;
  segments: ListeningSectionSegment[];
}): ListeningAnchor[] => {
  const progressData = (params.task.progressData ?? {}) as Record<string, any>;
  const segmentAssignments = (progressData.segmentAssignments ?? {}) as Record<string, string[]>;

  return params.segments.map((segment, index) => {
    const assignedQuestionIds = Array.isArray(segmentAssignments[segment.segment_id])
      ? segmentAssignments[segment.segment_id]
      : [];

    const from = assignedQuestionIds.length > 0 ? parseQuestionNo(assignedQuestionIds[0], index * 3 + 1) : index * 3 + 1;
    const to =
      assignedQuestionIds.length > 0
        ? parseQuestionNo(assignedQuestionIds[assignedQuestionIds.length - 1], from + 2)
        : from + 2;

    const anchor: ListeningAnchor = {
      anchor_id: `${segment.segment_id}:anchor:start`,
      segment_no: segment.segment_no,
      offset_seconds: 0,
      label: `Segment ${segment.segment_no}`,
      question_range: { from, to },
    };
    return listeningAnchorSchema.parse(anchor);
  });
};

export const validateAnchorTimingBounds = (
  anchors: ListeningAnchor[],
  segments: ListeningSectionSegment[],
  ttsDurationsBySegmentNo?: Record<number, number>,
) => {
  const segmentMap = new Map<number, ListeningSectionSegment>();
  segments.forEach((segment) => segmentMap.set(segment.segment_no, segment));

  const invalid: string[] = [];
  anchors.forEach((anchor) => {
    const segment = segmentMap.get(anchor.segment_no);
    if (!segment) {
      invalid.push(`${anchor.anchor_id}:SEGMENT_NOT_FOUND`);
      return;
    }
    const durationCap = Number(ttsDurationsBySegmentNo?.[anchor.segment_no] ?? segment.predicted_duration_seconds);
    if (!(anchor.offset_seconds >= 0 && anchor.offset_seconds < durationCap)) {
      invalid.push(`${anchor.anchor_id}:OFFSET_OUT_OF_BOUNDS`);
    }
  });

  return {
    ok: invalid.length === 0,
    errors: invalid,
  };
};

const resolveConfiguredBlockPlans = (task: TaskProgress): ConfiguredBlockAnchorContract[] => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const blockPlans =
    progressData?.listeningQuestionContract?.block_plan?.plans ??
    progressData?.questionContract?.block_plan?.plans ??
    null;

  if (!Array.isArray(blockPlans)) {
    return [];
  }

  return blockPlans.reduce<ConfiguredBlockAnchorContract[]>((acc, plan: any) => {
      const segmentNo = Number(plan?.segment_no);
      if (!Number.isFinite(segmentNo) || segmentNo <= 0) {
        return acc;
      }
      const rangeFrom = Number(plan?.question_range?.from);
      const rangeTo = Number(plan?.question_range?.to);
      const question_range =
        Number.isFinite(rangeFrom) && Number.isFinite(rangeTo) && rangeFrom > 0 && rangeTo >= rangeFrom
          ? { from: Math.round(rangeFrom), to: Math.round(rangeTo) }
          : undefined;
      acc.push({
        segment_no: Math.round(segmentNo),
        question_range,
      });
      return acc;
    }, []);
};

export const validateAnchorCoverageForConfiguredBlocks = (task: TaskProgress, anchors: ListeningAnchor[]) => {
  const configuredBlocks = resolveConfiguredBlockPlans(task);
  const errors: string[] = [];

  configuredBlocks.forEach((block) => {
    const anchorForSegment = anchors.find((anchor) => anchor.segment_no === block.segment_no);
    if (!anchorForSegment) {
      errors.push(`segment_${block.segment_no}:MISSING_ANCHOR_FOR_CONFIGURED_BLOCK`);
      return;
    }

    if (block.question_range) {
      if (!anchorForSegment.question_range) {
        errors.push(`${anchorForSegment.anchor_id}:MISSING_QUESTION_RANGE`);
        return;
      }
      if (
        anchorForSegment.question_range.from !== block.question_range.from ||
        anchorForSegment.question_range.to !== block.question_range.to
      ) {
        errors.push(`${anchorForSegment.anchor_id}:QUESTION_RANGE_MISMATCH`);
      }
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
};

export const validateAnchorsForSection = (params: {
  task: TaskProgress;
  anchors: ListeningAnchor[];
  segments: ListeningSectionSegment[];
  ttsDurationsBySegmentNo?: Record<number, number>;
}) => {
  const timing = validateAnchorTimingBounds(params.anchors, params.segments, params.ttsDurationsBySegmentNo);
  const coverage = validateAnchorCoverageForConfiguredBlocks(params.task, params.anchors);
  const errors = [...timing.errors, ...coverage.errors];

  return {
    ok: errors.length === 0,
    errors,
    timingErrors: timing.errors,
    coverageErrors: coverage.errors,
  };
};

export const persistAnchors = async (task: TaskProgress, anchors: ListeningAnchor[], validation: { ok: boolean; errors: string[] }) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  await storage.updateTaskProgress(task.id, {
    progressData: {
      ...progressData,
      [ANCHOR_ROOT]: {
        data: anchors,
        validation,
        updated_at: new Date().toISOString(),
      },
    },
  });
};

export const loadAnchors = (task: TaskProgress): ListeningAnchor[] => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const raw = progressData?.[ANCHOR_ROOT]?.data;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((anchor) => listeningAnchorSchema.safeParse(anchor))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
};
