import type { AnswerKey, AnswerKeyEntry } from "@shared/listening";
import { normalizeTextAnswer } from "@shared/listening";
import { buildSessionFeedback } from "./feedback";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./listeningObservability";

export interface MixedEngineAnswer {
  question_id: string;
  value: string | string[] | Array<{ left: string; right: string }> | null;
}

export interface MixedEngineQuestionOutcome {
  questionId: string;
  isCorrect: boolean;
  tagStats: Record<string, { correct: number; total: number }>;
  normalizationAudit?: {
    mode: string;
    numericHandling: string;
    submitted?: string;
    accepted?: string[];
  };
}

const toTagStats = (tags: string[], isCorrect: boolean) => {
  return tags.reduce<Record<string, { correct: number; total: number }>>((acc, tag) => {
    acc[tag] = { correct: isCorrect ? 1 : 0, total: 1 };
    return acc;
  }, {});
};

const compareMatchingPairs = (
  actual: Array<{ left: string; right: string }>,
  expected: Array<{ left: string; right: string }>,
  ordered: boolean,
) => {
  if (actual.length !== expected.length) return false;
  if (ordered) {
    return actual.every((pair, index) => pair.left === expected[index]?.left && pair.right === expected[index]?.right);
  }
  const normalize = (pairs: Array<{ left: string; right: string }>) =>
    pairs.map((pair) => `${pair.left}:${pair.right}`).sort();
  const a = normalize(actual);
  const b = normalize(expected);
  return a.every((value, index) => value === b[index]);
};

const evaluateEntry = (entry: AnswerKeyEntry, answer: MixedEngineAnswer | undefined) => {
  if (!answer) return { isCorrect: false as const };

  if (entry.kind === "single_choice") {
    return { isCorrect: typeof answer.value === "string" && entry.accepted_option_ids.includes(answer.value) };
  }

  if (entry.kind === "multi_choice") {
    if (!Array.isArray(answer.value)) return { isCorrect: false as const };
    const selected = answer.value.map((value) => String(value));
    const expected = entry.accepted_option_ids;
    if (selected.length !== expected.length) return { isCorrect: false as const };
    if (entry.ordered) {
      return { isCorrect: selected.every((value, index) => value === expected[index]) };
    }
    return { isCorrect: selected.sort().every((value, index) => value === [...expected].sort()[index]) };
  }

  if (entry.kind === "text") {
    if (typeof answer.value !== "string") return { isCorrect: false as const };
    const submitted = normalizeTextAnswer(answer.value, entry.normalization);
    const accepted = entry.accepted_texts.map((value) => normalizeTextAnswer(value, entry.normalization));
    return {
      isCorrect: accepted.some((value) => value === submitted),
      normalizationAudit: {
        mode: entry.normalization.mode,
        numericHandling: entry.normalization.numeric_handling,
        submitted,
        accepted,
      },
    };
  }

  if (!Array.isArray(answer.value)) return { isCorrect: false as const };
  const normalizedPairs = (answer.value as Array<{ left: string; right: string }>).map((pair) => ({
    left: String(pair.left),
    right: String(pair.right),
  }));
  return { isCorrect: compareMatchingPairs(normalizedPairs, entry.accepted_pairs, entry.ordered) };
};

export const scoreMixedEngineAttempt = (params: {
  answerKey: AnswerKey;
  answers: MixedEngineAnswer[];
}) => {
  const span = startListeningStageSpan({
    stage: "result_computed",
    context: createTelemetryContext({
      traceId: `trc_result_mixed_${params.answerKey.section_id}`,
      requestId: `req_result_mixed_${params.answerKey.section_id}`,
      userId: null,
      sessionId: params.answerKey.section_id,
      sectionId: params.answerKey.section_id,
      partId: null,
      agentName: "scoring_bridge",
    }),
  });
  const answersByQuestionId = new Map(params.answers.map((answer) => [answer.question_id, answer]));
  const outcomes: MixedEngineQuestionOutcome[] = params.answerKey.entries.map((entry) => {
    const answer = answersByQuestionId.get(entry.question_id);
    const evaluation = evaluateEntry(entry, answer);
    const isCorrect = evaluation.isCorrect;
    return {
      questionId: entry.question_id,
      isCorrect,
      tagStats: toTagStats(entry.tags, isCorrect),
      normalizationAudit: evaluation.normalizationAudit,
    };
  });

  const histogram: Record<string, { correct: number; total: number }> = {};
  outcomes.forEach((outcome) => {
    Object.entries(outcome.tagStats).forEach(([tag, stats]) => {
      if (!histogram[tag]) {
        histogram[tag] = { correct: 0, total: 0 };
      }
      histogram[tag].correct += stats.correct;
      histogram[tag].total += stats.total;
    });
  });

  const correct = outcomes.filter((outcome) => outcome.isCorrect).length;
  const total = outcomes.length;
  const scorePercent = total ? Math.round((correct / total) * 100) : 0;
  const sessionFeedback = buildSessionFeedback({
    histogram,
    recentSessions: [],
  });

  const result = {
    correct,
    total,
    percent: scorePercent,
    outcomes,
    histogram,
    sessionFeedback,
  };
  void finishListeningStageSpan(span, {
    success: true,
    metadata: {
      total_questions: total,
      correct,
      percent: scorePercent,
    },
  });
  return result;
};
