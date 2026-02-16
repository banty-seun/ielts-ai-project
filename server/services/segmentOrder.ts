import { v4 as uuidv4 } from "uuid";
import type { TaskProgress as TaskProgressRecord, Question as TaskQuestion } from "@shared/schema";
import { storage } from "../storage";

export type QuestionAssignmentMap = Record<string, string[]>;

const INTERNAL_LOCKED_TYPES = new Set(["matching", "table", "diagram", "map"]);
const DEFAULT_SHUFFLE_TYPES = new Set(["multiple-choice", "fill-in-the-gap", "fill-in-multiple-gaps", "short", "mcq"]);

const toKey = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const randomShuffle = <T>(input: T[]): T[] => {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const chunkQuestionIds = (ids: string[], segmentCount: number, index: number) => {
  if (!ids.length || segmentCount <= 0) return [];
  const start = Math.floor((index / segmentCount) * ids.length);
  const rawEnd = Math.floor(((index + 1) / segmentCount) * ids.length);
  const end = Math.max(start + 1, rawEnd);
  return ids.slice(start, end);
};

const dedupe = (values: string[]) => Array.from(new Set(values));

export const deriveSegmentAssignmentsForCoverage = (params: {
  questionIds: string[];
  segmentIds: string[];
  existingAssignments?: QuestionAssignmentMap;
}) => {
  const questionIds = dedupe(params.questionIds.filter(Boolean));
  const segmentIds = dedupe(params.segmentIds.filter(Boolean));
  const existingAssignments = params.existingAssignments ?? {};
  const assignments: QuestionAssignmentMap = { ...existingAssignments };
  let changed = false;

  if (!questionIds.length || !segmentIds.length) {
    return { assignments, changed };
  }

  segmentIds.forEach((segmentId, index) => {
    if (!Array.isArray(assignments[segmentId]) || assignments[segmentId].length === 0) {
      assignments[segmentId] = chunkQuestionIds(questionIds, segmentIds.length, index);
      changed = true;
    }
  });

  return { assignments, changed };
};

export const validateSegmentAssignmentCoverage = (params: {
  questionIds: string[];
  segmentIds: string[];
  assignments: QuestionAssignmentMap;
  segmentOrder?: Record<string, string[]>;
}) => {
  const questionIds = dedupe(params.questionIds.filter(Boolean));
  const segmentIds = dedupe(params.segmentIds.filter(Boolean));
  const assignmentMap = params.assignments ?? {};
  const orderMap = params.segmentOrder ?? {};

  const byQuestion = new Map<string, string[]>();
  const unknownAssignedQuestionIds = new Set<string>();
  const emptySegments: string[] = [];
  const orderIssues: Array<{ segment_id: string; question_id: string; reason: string }> = [];

  segmentIds.forEach((segmentId) => {
    const ids = Array.isArray(assignmentMap[segmentId]) ? dedupe(assignmentMap[segmentId].map(String)) : [];
    if (ids.length === 0) {
      emptySegments.push(segmentId);
    }

    ids.forEach((questionId) => {
      if (!questionIds.includes(questionId)) {
        unknownAssignedQuestionIds.add(questionId);
        return;
      }
      const current = byQuestion.get(questionId) ?? [];
      byQuestion.set(questionId, [...current, segmentId]);
    });

    const order = Array.isArray(orderMap[segmentId]) ? orderMap[segmentId].map(String) : [];
    order.forEach((questionId) => {
      if (!questionIds.includes(questionId)) {
        orderIssues.push({
          segment_id: segmentId,
          question_id: questionId,
          reason: "ORDER_REFERENCES_UNKNOWN_QUESTION",
        });
        return;
      }
      if (!ids.includes(questionId)) {
        orderIssues.push({
          segment_id: segmentId,
          question_id: questionId,
          reason: "ORDER_NOT_IN_ASSIGNMENT",
        });
      }
    });
  });

  const missingQuestionIds = questionIds.filter((questionId) => !byQuestion.has(questionId));
  const duplicateQuestionIds = questionIds.filter((questionId) => (byQuestion.get(questionId)?.length ?? 0) > 1);

  return {
    ok:
      missingQuestionIds.length === 0 &&
      duplicateQuestionIds.length === 0 &&
      orderIssues.length === 0 &&
      unknownAssignedQuestionIds.size === 0,
    diagnostics: {
      missing_question_ids: missingQuestionIds,
      duplicate_question_ids: duplicateQuestionIds,
      unknown_assigned_question_ids: Array.from(unknownAssignedQuestionIds),
      empty_segments: emptySegments,
      order_issues: orderIssues,
    },
  };
};

export const buildQuestionRangesFromDistribution = (
  distribution: readonly number[],
  questionCount: number,
): Array<{ from: number; to: number }> => {
  let start = 1;
  const ranges = distribution.map((count) => {
    const from = start;
    const to = start + count - 1;
    start += count;
    return { from, to };
  });

  if (!ranges.length || ranges[ranges.length - 1]!.to !== questionCount) {
    throw new Error("QUESTION_BLOCK_COVERAGE_INCOMPLETE");
  }
  return ranges;
};

const normalizeOptions = (question: TaskQuestion): { optionIds: string[]; mutated: boolean } => {
  const optionIds: string[] = [];
  let mutated = false;
  if (!Array.isArray(question.options)) {
    return { optionIds, mutated };
  }

  question.options = question.options.map((option: any, idx: number) => {
    const id = toKey(option?.id, `choice-${idx + 1}`);
    const label = typeof option?.text === "string" ? option.text : option?.label ?? "";
    optionIds.push(id);
    if (option?.id !== id || (!option?.text && typeof label === "string")) {
      mutated = true;
    }
    return {
      ...option,
      id,
      text: label,
    };
  });

  return { optionIds, mutated };
};

const arraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const buildBlockOrder = (segmentId: string, questionIds: string[], map: Map<string, TaskQuestion>) => {
  const groups = new Map<
    string,
    {
      key: string;
      questionIds: string[];
      type: string;
    }
  >();

  questionIds.forEach((questionId) => {
    const question = map.get(questionId);
    if (!question) {
      return;
    }
    const baseKey = toKey((question as any)?.groupId, questionId);
    const key = `${segmentId}-${baseKey}`;
    const entry = groups.get(key);
    const questionType = typeof question.type === "string" ? question.type.toLowerCase() : "multiple-choice";
    if (!entry) {
      groups.set(key, {
        key,
        questionIds: [questionId],
        type: questionType,
      });
    } else {
      entry.questionIds.push(questionId);
    }
  });

  const blocks = Array.from(groups.values());
  const shuffledBlocks = randomShuffle(blocks);
  const orderedIds: string[] = [];

  shuffledBlocks.forEach((block) => {
    const blockType = block.type;
    const shouldShuffleInternal =
      block.questionIds.length > 1 && !INTERNAL_LOCKED_TYPES.has(blockType) && DEFAULT_SHUFFLE_TYPES.has(blockType);
    const blockQuestions = shouldShuffleInternal ? randomShuffle(block.questionIds) : block.questionIds;
    orderedIds.push(...blockQuestions);
  });

  console.log("[ORDER] seg=%s blocks=%s order=%s", segmentId, JSON.stringify(shuffledBlocks), JSON.stringify(orderedIds));
  return orderedIds;
};

export const ensureSegmentOrder = async (
  task: TaskProgressRecord | null,
  assignments?: QuestionAssignmentMap,
): Promise<TaskProgressRecord | null> => {
  if (!task || task.skill !== "listening") {
    return task;
  }

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const assignmentMap: QuestionAssignmentMap = { ...(assignments ?? (progressData.segmentAssignments ?? {})) };
  let assignmentsMutated = false;

  const rawQuestions: TaskQuestion[] = Array.isArray(task.questions) ? [...task.questions] : [];
  if (!rawQuestions.length) {
    return task;
  }

  const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
  if (!Object.keys(assignmentMap).length && segments.length) {
    const ids = rawQuestions.map((question, idx) => {
      const qid = typeof question?.id === "string" ? question.id : `q${idx + 1}`;
      return qid;
    });
    segments.forEach((segment: any, index: number) => {
      const segId = toKey(segment?.id, `segment-${index + 1}`);
      assignmentMap[segId] = chunkQuestionIds(ids, segments.length, index);
    });
    assignmentsMutated = true;
  }

  let questionsMutated = false;
  const normalizedQuestions = rawQuestions.map((question, idx) => {
    const q = { ...question } as TaskQuestion & { optionOrder?: string[] };
    if (typeof q.id !== "string" || !q.id) {
      q.id = uuidv4();
      questionsMutated = true;
    }
    const { optionIds, mutated } = normalizeOptions(q);
    if (mutated) {
      questionsMutated = true;
    }
    if (optionIds.length > 1) {
      const hasExistingOrder =
        Array.isArray((q as any).optionOrder) &&
        optionIds.length === (q as any).optionOrder.length &&
        (q as any).optionOrder.every((choiceId: string) => optionIds.includes(choiceId));
      if (!hasExistingOrder) {
        (q as any).optionOrder = randomShuffle(optionIds);
        questionsMutated = true;
      }
      console.log("[ORDER] mcq optionOrder", { questionId: q.id, optionOrder: (q as any).optionOrder });
    }
    return q;
  });

  if (questionsMutated) {
    await storage.updateTaskContent(task.id, { questions: normalizedQuestions });
    task.questions = normalizedQuestions;
  }

  const questionMap = new Map<string, TaskQuestion>();
  normalizedQuestions.forEach((question) => {
    questionMap.set(String(question.id), question);
  });

  const existingOrder = (progressData.segmentOrder ?? {}) as Record<string, string[]>;
  const nextOrder: Record<string, string[]> = { ...existingOrder };
  let orderMutated = false;

  Object.entries(assignmentMap).forEach(([segmentId, questionIds]) => {
    if (!Array.isArray(questionIds) || !questionIds.length) {
      return;
    }
    const normalizedOrder = buildBlockOrder(segmentId, questionIds, questionMap);
    const current = Array.isArray(existingOrder[segmentId]) ? existingOrder[segmentId] : [];
    if (!arraysEqual(current, normalizedOrder)) {
      nextOrder[segmentId] = normalizedOrder;
      orderMutated = true;
    }
  });

  if (orderMutated || assignmentsMutated) {
    const updatedProgressData = {
      ...progressData,
      segmentAssignments: assignmentsMutated ? assignmentMap : progressData.segmentAssignments,
      segmentOrder: nextOrder,
    };
    await storage.updateTaskProgress(task.id, { progressData: updatedProgressData });
    task.progressData = updatedProgressData;
  }

  return task;
};
