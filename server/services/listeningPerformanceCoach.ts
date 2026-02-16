import { randomUUID } from "crypto";
import {
  DEFAULT_ACCENT,
  type Accent,
} from "@shared/constants";
import {
  LISTENING_EVENT_TOPICS,
  LISTENING_EVENT_TYPES,
  LISTENING_SCORING_TAGS,
  type ListeningEvidenceReference,
  listeningPerformanceAnalysisSchema,
  type ListeningPerformanceAnalysis,
  type PersonalizedStrategy,
  type NextPracticeRecommendation,
  type WeaknessProfileEntry,
  type ListeningScoringTag,
  type WeaknessSeverity,
  type TutorAdjustmentRequest,
  tutorAdjustmentRequestSchema,
} from "@shared/listening";
import type { TaskProgress } from "@shared/schema";
import { generateAdvisorFeedback } from "../openai";
import { storage } from "../storage";
import { friendlyTagLabel } from "./scoring";
import { normalizeLegacyQuestionsForApi } from "./listeningQuestionAdapters";
import { getRecentListeningSummaries } from "./perfStore";
import { publishListeningEvent } from "./listeningEvents";
import { persistListeningEventToOutbox } from "./listeningEventOutbox";
import { hasProcessedListeningIdempotencyKey, markProcessedListeningIdempotencyKey } from "./listeningIdempotencyStore";
import { canonicalizeListeningErrorCode, classifyListeningRetry, getListeningRetryDelayMs } from "./listeningRetryPolicy";
import { routeListeningTerminalFailureToDLQ } from "./listeningDeadLetter";
import { normalizeAccent } from "../utils/audio";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./listeningObservability";
import {
  buildGovernanceProvenance,
  runGovernancePolicyGateForCoachAnalysis,
} from "./listeningGovernancePolicy";

const ANALYSIS_VERSION = "1.0.0";
const ENABLE_LLM_ENHANCEMENT = process.env.LISTENING_COACH_LLM_ENHANCE === "true";
const COACH_CONFIDENCE_THRESHOLD = Math.max(
  0,
  Math.min(1, Number(process.env.LISTENING_COACH_CONFIDENCE_THRESHOLD ?? 0.6)),
);

type AttemptOutcome = {
  questionId: string;
  isCorrect: boolean;
  responseTimeMs: number | null;
  answerChangeCount: number;
  replayCount: number;
  unanswered: boolean;
  sectionNo?: number | null;
  sectionId?: string | null;
  questionNo?: number | null;
};

type TaggedOutcome = AttemptOutcome & {
  questionNo: number;
  sectionNo: number;
  tags: ListeningScoringTag[];
};

type TaggedOutcomeBuild = {
  taggedOutcomes: TaggedOutcome[];
  integrity: {
    issues: string[];
    knownQuestionNos: Set<number>;
    knownSectionNos: Set<number>;
  };
};

type SectionTagHistogram = Record<string, Record<string, { correct: number; total: number }>>;

type LearnerProfile = {
  currentLevel: number | null;
  targetBand: number | null;
  profileSource: "study_plan" | "task_fallback";
};

const severityRank: Record<WeaknessSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const parseQuestionNo = (value: string): number => {
  const maybe = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isFinite(maybe) && maybe > 0 ? maybe : 0;
};

const parseSectionNo = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value !== "string") {
    return 0;
  }
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const explicit = trimmed.match(/(?:section|part|sec|s)[\s\-_]*([1-9]\d*)/i);
  if (explicit?.[1]) {
    const parsed = Number(explicit[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const maybe = Number(trimmed);
  if (Number.isFinite(maybe) && maybe > 0) return Math.round(maybe);
  return 0;
};

const deriveSectionNoFromQuestionMeta = (question: Record<string, any>, fallback: number): number => {
  const direct = parseSectionNo(question.sectionNo ?? question.section_no ?? question.sectionId ?? question.section_id);
  if (direct > 0) return direct;

  const grouped = parseSectionNo(question.groupId ?? question.group_id);
  if (grouped > 0) return grouped;

  const questionId = String(question.id ?? "");
  const fromId = parseSectionNo(questionId);
  if (fromId > 0) return fromId;

  return fallback;
};

const parseBandValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Number(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const matched = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (!matched?.[1]) return null;
  const parsed = Number(matched[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const deriveDifficulty = (params: {
  taskDifficulty: string | null | undefined;
  trend: "up" | "down" | "flat";
  currentLevel: number | null;
  targetBand: number | null;
}): "easy" | "medium" | "hard" => {
  const input = String(params.taskDifficulty ?? "").toLowerCase();
  const baseDifficulty: "easy" | "medium" | "hard" =
    input.includes("8") || input.includes("7.5")
      ? "hard"
      : input.includes("6") || input.includes("7")
        ? "medium"
        : "medium";
  if (params.currentLevel === null || params.targetBand === null) {
    if (params.trend === "down") return "easy";
    if (params.trend === "up") return "hard";
    return baseDifficulty;
  }

  const gap = Number((params.targetBand - params.currentLevel).toFixed(2));
  if (params.trend === "down") {
    if (gap >= 1.5) return "medium";
    return "easy";
  }
  if (params.trend === "up") {
    if (gap >= 1) return "hard";
    if (gap >= 0.25) return baseDifficulty;
    return "medium";
  }
  if (gap >= 1.25) return "hard";
  if (gap <= -0.25) return "easy";
  return "medium";
};

const resolveLearnerProfile = async (task: TaskProgress): Promise<LearnerProfile> => {
  const fallbackLevel = parseBandValue(task.difficulty);
  const fallbackTarget = fallbackLevel !== null ? Number((fallbackLevel + 1).toFixed(1)) : null;
  try {
    const plans = await storage.getStudyPlansByUserId(task.userId);
    if (!plans.length) {
      return {
        currentLevel: fallbackLevel,
        targetBand: fallbackTarget,
        profileSource: "task_fallback",
      };
    }

    const latestPlan = [...plans].sort((a: any, b: any) => {
      const aTs = new Date(a?.updatedAt ?? a?.createdAt ?? 0).getTime();
      const bTs = new Date(b?.updatedAt ?? b?.createdAt ?? 0).getTime();
      return bTs - aTs;
    })[0];
    const skillRatings = (latestPlan?.skillRatings ?? {}) as Record<string, unknown>;
    const currentLevel = parseBandValue(skillRatings?.listening ?? fallbackLevel);
    const targetBand = parseBandValue(latestPlan?.targetBandScore ?? fallbackTarget);
    return {
      currentLevel,
      targetBand,
      profileSource: "study_plan",
    };
  } catch {
    return {
      currentLevel: fallbackLevel,
      targetBand: fallbackTarget,
      profileSource: "task_fallback",
    };
  }
};

const BALANCED_ACCENT_ROTATION: Accent[] = ["British", "Australian", "American", "Canadian", "NewZealand"];

const rotateAccent = (preferred: Accent): Accent[] => {
  return [preferred, ...BALANCED_ACCENT_ROTATION.filter((item) => item !== preferred)];
};

const toListeningTag = (raw: string): ListeningScoringTag => {
  const normalized = raw.toLowerCase();
  if ((LISTENING_SCORING_TAGS as readonly string[]).includes(normalized)) {
    return normalized as ListeningScoringTag;
  }
  return "general";
};

const buildTaggedOutcomes = (task: TaskProgress, outcomes: AttemptOutcome[]): TaggedOutcomeBuild => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const defaultSectionNo = Number(progressData?.sessionOrder ?? 1) || 1;
  const sectionResults = Array.isArray(progressData?.sectionResults) ? progressData.sectionResults : [];
  const questions = normalizeLegacyQuestionsForApi(task.questions ?? []);
  const byQuestionId = new Map<string, { no: number; sectionNo: number; tags: ListeningScoringTag[] }>();
  const knownQuestionNos = new Set<number>();
  const knownSectionNos = new Set<number>();
  knownSectionNos.add(defaultSectionNo);
  sectionResults.forEach((section) => {
    const sectionNo = Number(section?.sectionNo ?? section?.section_no ?? 0);
    if (Number.isFinite(sectionNo) && sectionNo > 0) {
      knownSectionNos.add(Math.round(sectionNo));
    }
  });
  questions.forEach((question, index) => {
    const no = parseQuestionNo(String(question.id)) || index + 1;
    const questionMeta = question as Record<string, any>;
    const sectionNo = deriveSectionNoFromQuestionMeta(questionMeta, defaultSectionNo);
    const tags = (Array.isArray(question.tags) ? question.tags : [])
      .map((tag) => toListeningTag(String(tag)));
    knownQuestionNos.add(no);
    knownSectionNos.add(sectionNo);
    byQuestionId.set(String(question.id), {
      no,
      sectionNo,
      tags: tags.length ? tags : ["general"],
    });
  });

  const issues: string[] = [];
  const taggedOutcomes = outcomes.map((outcome, index) => {
    const meta = byQuestionId.get(String(outcome.questionId));
    const outcomeSectionNo = parseSectionNo(outcome.sectionNo ?? outcome.sectionId);
    const sectionNo = outcomeSectionNo || meta?.sectionNo || defaultSectionNo;
    const questionNo =
      Number.isFinite(Number(outcome.questionNo)) && Number(outcome.questionNo) > 0
        ? Math.round(Number(outcome.questionNo))
        : meta?.no ?? (parseQuestionNo(outcome.questionId) || index + 1);
    knownQuestionNos.add(questionNo);
    knownSectionNos.add(sectionNo);
    if (!meta) {
      issues.push(`MISSING_QUESTION_META:${String(outcome.questionId)}`);
    }
    if (sectionNo <= 0) {
      issues.push(`INVALID_SECTION_NO:${String(outcome.questionId)}`);
    }
    if (questionNo <= 0) {
      issues.push(`INVALID_QUESTION_NO:${String(outcome.questionId)}`);
    }
    return {
      ...outcome,
      questionNo,
      sectionNo: Math.max(1, sectionNo),
      tags: meta?.tags ?? ["general"],
    };
  });

  return {
    taggedOutcomes,
    integrity: {
      issues: Array.from(new Set(issues)),
      knownQuestionNos,
      knownSectionNos,
    },
  };
};

const buildWeaknessProfile = (params: {
  taggedOutcomes: TaggedOutcome[];
  integrity: TaggedOutcomeBuild["integrity"];
}): { weaknesses: WeaknessProfileEntry[]; integrityIssues: string[] } => {
  const counters = new Map<
    ListeningScoringTag,
    {
      correct: number;
      total: number;
      evidence: Set<number>;
      sections: Set<number>;
    }
  >();

  params.taggedOutcomes.forEach((outcome) => {
    outcome.tags.forEach((tag) => {
      const current = counters.get(tag) ?? {
        correct: 0,
        total: 0,
        evidence: new Set<number>(),
        sections: new Set<number>(),
      };
      current.total += 1;
      if (outcome.isCorrect) {
        current.correct += 1;
      } else {
        current.evidence.add(outcome.questionNo);
      }
      current.sections.add(outcome.sectionNo);
      counters.set(tag, current);
    });
  });

  const weaknesses: Array<WeaknessProfileEntry & { weightedScore: number }> = [];
  counters.forEach((stats, tag) => {
    if (stats.total === 0) return;
    const accuracy = stats.correct / stats.total;
    const errorRate = 1 - accuracy;
    if (errorRate <= 0.2) return;

    const severity: WeaknessSeverity =
      errorRate >= 0.6 ? "high" : errorRate >= 0.35 ? "medium" : "low";
    const confidence = Number(
      Math.min(0.95, 0.35 + stats.total * 0.08 + stats.evidence.size * 0.05).toFixed(2),
    );
    const frequencyFactor = Math.min(1, stats.total / 6);
    const weightedScore = Number((errorRate * 0.7 + frequencyFactor * 0.3).toFixed(4));

    weaknesses.push({
      tag,
      severity,
      confidence,
      evidence_questions: [...stats.evidence].sort((a, b) => a - b),
      affected_sections: [...stats.sections].sort((a, b) => a - b),
      weightedScore,
    });
  });

  const integrityIssues = [...params.integrity.issues];
  const sanitized = weaknesses
    .map((entry) => {
      const validQuestions = entry.evidence_questions.filter((questionNo) =>
        params.integrity.knownQuestionNos.has(questionNo),
      );
      const validSections = entry.affected_sections.filter((sectionNo) =>
        params.integrity.knownSectionNos.has(sectionNo),
      );
      if (validQuestions.length !== entry.evidence_questions.length) {
        integrityIssues.push(`QUESTION_EVIDENCE_MISMATCH:${entry.tag}`);
      }
      if (validSections.length !== entry.affected_sections.length) {
        integrityIssues.push(`SECTION_EVIDENCE_MISMATCH:${entry.tag}`);
      }
      return {
        ...entry,
        evidence_questions: validQuestions,
        affected_sections: validSections,
      };
    })
    .filter((entry) => entry.evidence_questions.length > 0 || entry.affected_sections.length > 0 || entry.tag === "general");

  const sorted = sanitized.sort((a, b) => {
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }
    if (b.weightedScore !== a.weightedScore) {
      return b.weightedScore - a.weightedScore;
    }
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return a.tag.localeCompare(b.tag);
  });

  return {
    weaknesses: sorted.map(({ weightedScore: _weightedScore, ...entry }) => entry),
    integrityIssues: Array.from(new Set(integrityIssues)),
  };
};

const buildBehaviorSignals = (taggedOutcomes: TaggedOutcome[]) => {
  const latencyValues = taggedOutcomes
    .map((item) => Number(item.responseTimeMs ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgLatency =
    latencyValues.length > 0
      ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
      : null;
  const questionCount = taggedOutcomes.length;
  const answerChanges = taggedOutcomes.reduce((sum, item) => sum + Number(item.answerChangeCount ?? 0), 0);
  const replayCount = taggedOutcomes.reduce((sum, item) => sum + Number(item.replayCount ?? 0), 0);
  const unansweredCount = taggedOutcomes.filter((item) => item.unanswered).length;
  const answerChangeRate = Number((answerChanges / Math.max(1, questionCount)).toFixed(4));
  const replayRate = Number((replayCount / Math.max(1, questionCount)).toFixed(4));
  const unansweredRate = Number((unansweredCount / Math.max(1, questionCount)).toFixed(4));
  const avgLatencySec =
    typeof avgLatency === "number" && avgLatency > 0
      ? Number((avgLatency / 1000).toFixed(2))
      : null;

  const sectionBuckets = new Map<number, TaggedOutcome[]>();
  taggedOutcomes.forEach((item) => {
    const bucket = sectionBuckets.get(item.sectionNo) ?? [];
    bucket.push(item);
    sectionBuckets.set(item.sectionNo, bucket);
  });

  return {
    avg_response_latency_ms: avgLatency,
    avg_response_latency_sec: avgLatencySec,
    answer_changes: answerChanges,
    replay_count: replayCount,
    unanswered_count: unansweredCount,
    question_count: questionCount,
    answer_change_rate: answerChangeRate,
    replay_rate: replayRate,
    unanswered_rate: unansweredRate,
    section_rollups: [...sectionBuckets.entries()].map(([sectionNo, rows]) => {
      const sectionLatency = rows
        .map((item) => Number(item.responseTimeMs ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);
      const sectionQuestionCount = rows.length;
      const sectionAnswerChanges = rows.reduce((sum, item) => sum + Number(item.answerChangeCount ?? 0), 0);
      const sectionReplayCount = rows.reduce((sum, item) => sum + Number(item.replayCount ?? 0), 0);
      const sectionUnansweredCount = rows.filter((item) => item.unanswered).length;
      const sectionLatencyMs =
        sectionLatency.length > 0
          ? Math.round(sectionLatency.reduce((sum, value) => sum + value, 0) / sectionLatency.length)
          : null;
      return {
        section_no: sectionNo,
        avg_response_latency_ms: sectionLatencyMs,
        avg_response_latency_sec:
          typeof sectionLatencyMs === "number" && sectionLatencyMs > 0
            ? Number((sectionLatencyMs / 1000).toFixed(2))
            : null,
        answer_changes: sectionAnswerChanges,
        replay_count: sectionReplayCount,
        unanswered_count: sectionUnansweredCount,
        question_count: sectionQuestionCount,
        answer_change_rate: Number((sectionAnswerChanges / Math.max(1, sectionQuestionCount)).toFixed(4)),
        replay_rate: Number((sectionReplayCount / Math.max(1, sectionQuestionCount)).toFixed(4)),
        unanswered_rate: Number((sectionUnansweredCount / Math.max(1, sectionQuestionCount)).toFixed(4)),
      };
    }),
  };
};

const buildNormalizedBehaviorSignals = (signals: ReturnType<typeof buildBehaviorSignals>) => {
  return {
    unansweredRate: signals.unanswered_rate,
    replayRate: signals.replay_rate,
    answerChangeRate: signals.answer_change_rate,
    avgLatencySec: signals.avg_response_latency_sec,
  };
};

const deriveRootCause = (params: {
  scorePercent: number;
  behaviorSignals: ReturnType<typeof buildBehaviorSignals>;
  weaknessProfile: WeaknessProfileEntry[];
}) => {
  const questionCount = Math.max(1, params.behaviorSignals.question_count);
  const normalized = buildNormalizedBehaviorSignals(params.behaviorSignals);
  const unansweredRate = normalized.unansweredRate;
  const replayRate = normalized.replayRate;
  const answerChangeRate = normalized.answerChangeRate;
  const severeWeakness = params.weaknessProfile.some((item) => item.severity === "high");
  const lowData = questionCount < 4;

  if (lowData) {
    return {
      type: "mixed" as const,
      confidence: 0.3,
      rationale: "Limited interaction data. More attempts are needed for a stable diagnosis.",
      needs_more_data: true,
    };
  }

  if ((unansweredRate >= 0.2 || replayRate >= 1.3 || answerChangeRate >= 1.1) && params.scorePercent >= 60) {
    return {
      type: "behavior_pattern" as const,
      confidence: 0.72,
      rationale: "Interaction patterns indicate pacing/playback behavior as a primary limiter.",
      needs_more_data: false,
    };
  }

  if (params.scorePercent < 60 && severeWeakness) {
    return {
      type: "skill_gap" as const,
      confidence: 0.8,
      rationale: "Accuracy and tag-level misses indicate foundational listening skill gaps.",
      needs_more_data: false,
    };
  }

  return {
    type: "mixed" as const,
    confidence: 0.64,
    rationale: "Both accuracy gaps and interaction behavior contribute to performance limits.",
    needs_more_data: false,
  };
};

const buildTagHistogram = (taggedOutcomes: TaggedOutcome[]) => {
  const histogram: Record<string, { correct: number; total: number }> = {};
  taggedOutcomes.forEach((row) => {
    row.tags.forEach((tag) => {
      const bucket = histogram[tag] ?? { correct: 0, total: 0 };
      bucket.total += 1;
      if (row.isCorrect) bucket.correct += 1;
      histogram[tag] = bucket;
    });
  });
  return histogram;
};

const buildSectionTagHistogram = (taggedOutcomes: TaggedOutcome[]): SectionTagHistogram => {
  const histogram: SectionTagHistogram = {};
  taggedOutcomes.forEach((row) => {
    const sectionKey = String(row.sectionNo);
    const sectionBucket = histogram[sectionKey] ?? {};
    row.tags.forEach((tag) => {
      const bucket = sectionBucket[tag] ?? { correct: 0, total: 0 };
      bucket.total += 1;
      if (row.isCorrect) bucket.correct += 1;
      sectionBucket[tag] = bucket;
    });
    histogram[sectionKey] = sectionBucket;
  });
  return histogram;
};

const mergeHistograms = (
  sessions: Array<{ histogram?: Record<string, { correct: number; total: number }> | null }>,
) => {
  const merged: Record<string, { correct: number; total: number }> = {};
  sessions.forEach((session) => {
    Object.entries(session.histogram ?? {}).forEach(([tag, stats]) => {
      merged[tag] = {
        correct: Number(merged[tag]?.correct ?? 0) + Number(stats?.correct ?? 0),
        total: Number(merged[tag]?.total ?? 0) + Number(stats?.total ?? 0),
      };
    });
  });
  return merged;
};

const mergeSectionTagHistograms = (
  sessions: Array<{ sectionTagHistogram?: SectionTagHistogram | null }>,
) => {
  const merged: SectionTagHistogram = {};
  sessions.forEach((session) => {
    Object.entries(session.sectionTagHistogram ?? {}).forEach(([sectionNo, tags]) => {
      const sectionBucket = merged[sectionNo] ?? {};
      Object.entries(tags ?? {}).forEach(([tag, stats]) => {
        const current = sectionBucket[tag] ?? { correct: 0, total: 0 };
        current.correct += Number(stats?.correct ?? 0);
        current.total += Number(stats?.total ?? 0);
        sectionBucket[tag] = current;
      });
      merged[sectionNo] = sectionBucket;
    });
  });
  return merged;
};

const buildTrendAnalysis = async (params: {
  userId: string;
  taskId: string;
  currentScorePercent: number;
  currentHistogram: Record<string, { correct: number; total: number }>;
  currentSectionTagHistogram: SectionTagHistogram;
}) => {
  const recent = await getRecentListeningSummaries(storage, params.userId, 6);
  const baseline = recent.filter((entry) => entry.taskId !== params.taskId);
  const previousScores = baseline
    .map((entry) => Number(entry.scorePercent))
    .filter((value) => Number.isFinite(value));
  const previousAvg =
    previousScores.length > 0
      ? previousScores.reduce((sum, value) => sum + value, 0) / previousScores.length
      : params.currentScorePercent;
  const delta = params.currentScorePercent - previousAvg;
  const direction: "up" | "down" | "flat" = delta > 3 ? "up" : delta < -3 ? "down" : "flat";
  const confidence = Number(Math.min(0.92, 0.35 + baseline.length * 0.12).toFixed(2));

  const previousHistogram = mergeHistograms(baseline);
  const previousSectionTag = mergeSectionTagHistograms(baseline);
  const sectionTagDimensions = Object.entries(params.currentSectionTagHistogram)
    .flatMap(([sectionNo, tags]) =>
      Object.entries(tags).map(([tag, current]) => {
        const previous = previousSectionTag[sectionNo]?.[tag] ?? null;
        const currentAcc = (Number(current.correct ?? 0) / Math.max(1, Number(current.total ?? 0))) * 100;
        const previousAcc = previous
          ? (Number(previous.correct ?? 0) / Math.max(1, Number(previous.total ?? 0))) * 100
          : currentAcc;
        const deltaPoints = Number((currentAcc - previousAcc).toFixed(2));
        const dimensionDirection: "up" | "down" | "flat" =
          deltaPoints > 3 ? "up" : deltaPoints < -3 ? "down" : "flat";
        const confidenceBase = previous
          ? 0.35 + Math.min(0.45, Number(previous.total ?? 0) * 0.03)
          : 0.28;
        return {
          section_no: Number(sectionNo),
          tag: toListeningTag(tag),
          direction: dimensionDirection,
          delta_points: deltaPoints,
          confidence: Number(Math.min(0.92, confidenceBase + baseline.length * 0.08).toFixed(2)),
        };
      }),
    )
    .filter((item) => Number.isFinite(item.section_no) && item.section_no > 0)
    .sort((a, b) => {
      if (a.section_no !== b.section_no) return a.section_no - b.section_no;
      if (a.delta_points !== b.delta_points) return a.delta_points - b.delta_points;
      return a.tag.localeCompare(b.tag);
    });

  const driftByTag = new Map<ListeningScoringTag, { delta_points: number; confidence: number }>();
  sectionTagDimensions.forEach((dimension) => {
    if (dimension.delta_points > -15) return;
    const existing = driftByTag.get(dimension.tag);
    if (!existing || dimension.delta_points < existing.delta_points) {
      driftByTag.set(dimension.tag, {
        delta_points: dimension.delta_points,
        confidence: dimension.confidence,
      });
    }
  });
  const driftAlerts = [...driftByTag.entries()]
    .map(([tag, drift]) => ({
      tag,
      delta_points: drift.delta_points,
      confidence: drift.confidence,
    }))
    .sort((a, b) => a.delta_points - b.delta_points);

  // Include tag-level baseline deltas when section trend history is sparse.
  if (!driftAlerts.length) {
    Object.entries(params.currentHistogram).forEach(([tag, current]) => {
      const previous = previousHistogram[tag];
      if (!previous || Number(previous.total) <= 0 || Number(current.total) <= 0) return;
      const currentAcc = (current.correct / Math.max(1, current.total)) * 100;
      const previousAcc = (previous.correct / Math.max(1, previous.total)) * 100;
      const deltaPoints = Number((currentAcc - previousAcc).toFixed(2));
      if (deltaPoints > -15) return;
      driftAlerts.push({
        tag: toListeningTag(tag),
        delta_points: deltaPoints,
        confidence: Number(Math.min(0.9, 0.4 + previous.total * 0.05).toFixed(2)),
      });
    });
    driftAlerts.sort((a, b) => a.delta_points - b.delta_points);
  }

  return {
    direction,
    confidence,
    data_window_size: baseline.length,
    drift_alerts: driftAlerts,
    section_tag_dimensions: sectionTagDimensions,
  };
};

const strategyTemplates: Array<{
  id: string;
  title: string;
  action: string;
  expected: string;
  tags: ListeningScoringTag[];
}> = [
  {
    id: "numbers_dates",
    title: "Numbers and Dates Capture",
    action: "Practice 10-minute dictation drills focused on dates, prices, and phone numbers before each session.",
    expected: "Fewer misses on factual capture items under time pressure.",
    tags: ["numbers", "dates", "spelling_capture"],
  },
  {
    id: "distractors",
    title: "Distractor Filtering",
    action: "Underline cue words and wait for correction phrases before locking an answer.",
    expected: "Improved accuracy on detail and inference items with distractors.",
    tags: ["detail", "inference", "matching_pair_confusion"],
  },
  {
    id: "map_diagram",
    title: "Spatial Listening Routine",
    action: "Use map-orientation warmups and verbal direction chains to track movement cues.",
    expected: "Stronger performance on map and diagram labeling tasks.",
    tags: ["maps", "directions", "map_spatial_reference"],
  },
  {
    id: "multi_select",
    title: "Multi-Select Constraint Control",
    action: "Apply strict elimination and verify the required selection count before submission.",
    expected: "Reduced over-selection and instruction-limit errors.",
    tags: ["instruction_limit_violation", "matching_pair_confusion", "detail"],
  },
  {
    id: "note_completion",
    title: "Note and Summary Completion",
    action: "Train with chunked note-taking and synonym spotting for short completion windows.",
    expected: "Better completion accuracy and reduced late-answer blanks.",
    tags: ["vocabulary", "synonyms", "general"],
  },
];

const buildEvidenceRefs = (params: {
  sectionIds: number[];
  questionIds: number[];
  tags: ListeningScoringTag[];
}): ListeningEvidenceReference[] => {
  const sectionIds = params.sectionIds.length > 0 ? params.sectionIds : [1];
  return sectionIds.map((sectionNo) => ({
    section_id: `section-${sectionNo}`,
    part_id: sectionNo,
    question_ids: params.questionIds,
    error_tags: params.tags.length > 0 ? params.tags : ["general"],
  }));
};

const buildRuleBasedStrategies = (params: {
  weaknessProfile: WeaknessProfileEntry[];
  rootCause: ReturnType<typeof deriveRootCause>;
}) => {
  const selected: PersonalizedStrategy[] = [];
  const used = new Set<string>();

  params.weaknessProfile.forEach((weakness) => {
    const template = strategyTemplates.find((item) => item.tags.includes(weakness.tag));
    if (!template || used.has(template.id)) return;
    used.add(template.id);

    selected.push({
      title: template.title,
      action: template.action,
      rationale: `${friendlyTagLabel(weakness.tag)} is a ${weakness.severity} weakness with ${Math.round(
        weakness.confidence * 100,
      )}% confidence from recent outcomes.`,
      linked_weakness_tags: [weakness.tag],
      expected_outcome: template.expected,
      evidence: {
        section_ids: weakness.affected_sections,
        question_ids: weakness.evidence_questions,
        section_id: weakness.affected_sections[0] ? `section-${weakness.affected_sections[0]}` : undefined,
        part_id: weakness.affected_sections[0] ?? undefined,
        error_tags: [weakness.tag],
      },
      evidence_refs: buildEvidenceRefs({
        sectionIds: weakness.affected_sections,
        questionIds: weakness.evidence_questions,
        tags: [weakness.tag],
      }),
      priority: selected.length + 1,
      confidence: weakness.confidence,
    });
  });

  if (!selected.length) {
    selected.push({
      title: "Maintain Core Listening Routine",
      action: "Continue balanced practice across all sections and track timing consistency per question.",
      rationale: "No high-confidence weakness cluster was detected; preserve stability and monitor drift.",
      linked_weakness_tags: ["general"],
      expected_outcome: "Steady performance while gathering stronger evidence for personalization.",
      evidence: { section_ids: [], question_ids: [], section_id: "section-1", part_id: 1, error_tags: ["general"] },
      evidence_refs: buildEvidenceRefs({
        sectionIds: [1],
        questionIds: [],
        tags: ["general"],
      }),
      priority: 1,
      confidence: 0.45,
    });
  }

  if (params.rootCause.type === "behavior_pattern") {
    selected.unshift({
      title: "Pacing and Replay Discipline",
      action: "Set a replay cap per section and answer within target timing buckets.",
      rationale: "Behavioral signals show replay/change patterns are reducing conversion of known answers.",
      linked_weakness_tags: ["general"],
      expected_outcome: "Higher completion and reduced unanswered count under timed constraints.",
      evidence: { section_ids: [], question_ids: [], section_id: "section-1", part_id: 1, error_tags: ["general"] },
      evidence_refs: buildEvidenceRefs({
        sectionIds: [1],
        questionIds: [],
        tags: ["general"],
      }),
      priority: 1,
      confidence: params.rootCause.confidence,
    });
  }

  return selected.slice(0, 5).map((item, index) => ({ ...item, priority: index + 1 }));
};

const toLegacyFallbackShape = (params: {
  strategies: PersonalizedStrategy[];
  used: boolean;
  summary?: string | null;
  actions?: string[];
  reasonCode?: string | null;
}) => {
  const baseActions = params.strategies.map((strategy) => strategy.action).slice(0, 5);
  return {
    used: params.used,
    summary:
      params.summary ??
      (params.strategies[0]
        ? `${params.strategies[0].title}: ${params.strategies[0].rationale}`
        : "Deterministic coaching recommendations generated."),
    actions: Array.isArray(params.actions) && params.actions.length ? params.actions : baseActions,
    reason_code: params.reasonCode ?? null,
  };
};

const validateEvidenceBoundText = (text: string, strategy: PersonalizedStrategy) => {
  const allowedQuestions = new Set(strategy.evidence.question_ids);
  const allowedSections = new Set(strategy.evidence.section_ids);

  const questionRefs = Array.from(text.matchAll(/\bq(?:uestion)?\s*#?\s*(\d+)\b/gi)).map((match) => Number(match[1]));
  const sectionRefs = Array.from(text.matchAll(/\bsection\s*#?\s*(\d+)\b/gi)).map((match) => Number(match[1]));

  const invalidQuestionRef = questionRefs.some((value) => Number.isFinite(value) && !allowedQuestions.has(value));
  const invalidSectionRef = sectionRefs.some((value) => Number.isFinite(value) && !allowedSections.has(value));
  return !invalidQuestionRef && !invalidSectionRef;
};

const maybeEnhanceStrategiesWithLlm = async (strategies: PersonalizedStrategy[]) => {
  if (!ENABLE_LLM_ENHANCEMENT || !strategies.length) {
    return {
      strategies,
      fallback: toLegacyFallbackShape({
        strategies,
        used: false,
        reasonCode: null,
      }),
    };
  }

  const highestConfidence = strategies.reduce((max, strategy) => Math.max(max, Number(strategy.confidence ?? 0)), 0);
  if (highestConfidence < COACH_CONFIDENCE_THRESHOLD) {
    return {
      strategies,
      fallback: toLegacyFallbackShape({
        strategies,
        used: true,
        summary: "Fallback mode activated because confidence was below governance threshold.",
        reasonCode: "CONFIDENCE_BELOW_THRESHOLD",
      }),
    };
  }

  const hasEvidence = strategies.some(
    (strategy) => strategy.evidence.question_ids.length > 0 || strategy.evidence.section_ids.length > 0,
  );
  if (!hasEvidence) {
    return {
      strategies,
      fallback: toLegacyFallbackShape({
        strategies,
        used: true,
        summary: "LLM enhancement skipped because strategy evidence coverage is insufficient.",
        reasonCode: "EVIDENCE_MISSING",
      }),
    };
  }

  try {
    const questions = strategies.slice(0, 5).map((strategy, index) => ({
      id: `coach_${index + 1}`,
      question: strategy.title,
      correctAnswer: strategy.expected_outcome,
      selectedAnswer: strategy.action,
    }));
    const evidenceContext = strategies
      .slice(0, 5)
      .map((strategy, index) => {
        const sections = strategy.evidence.section_ids.join(", ") || "none";
        const questions = strategy.evidence.question_ids.join(", ") || "none";
        return `Strategy ${index + 1} evidence -> sections:[${sections}] questions:[${questions}]`;
      })
      .join(" | ");
    const advisor = await generateAdvisorFeedback({
      audioIndex: 0,
      questions,
      scriptExcerpt: `Evidence-bound strategy rewrite request. Use only listed references. ${evidenceContext}`,
    });

    if (!advisor.success) {
      return {
        strategies,
        fallback: toLegacyFallbackShape({
          strategies,
          used: true,
          summary: "LLM enhancement unavailable. Deterministic coach strategies were used.",
          reasonCode: "POLICY_CHECK_FAILED",
        }),
      };
    }

    const advisorActions = Array.isArray(advisor.actions) ? advisor.actions : [];
    const violatesEvidence = advisorActions.some((action, index) => {
      if (typeof action !== "string" || !action.trim()) return false;
      const strategy = strategies[index];
      if (!strategy) return false;
      return !validateEvidenceBoundText(action, strategy);
    });
    if (violatesEvidence) {
      return {
        strategies,
        fallback: toLegacyFallbackShape({
          strategies,
          used: true,
          summary: "LLM enhancement rejected by evidence guardrails. Deterministic strategies were returned.",
          reasonCode: "UNGROUNDED_CLAIM",
        }),
      };
    }

    const enhanced = strategies.map((strategy, index) => ({
      ...strategy,
      rationale: advisorActions[index] ? `${strategy.rationale} ${advisorActions[index]}` : strategy.rationale,
    }));

    return {
      strategies: enhanced,
      fallback: toLegacyFallbackShape({
        strategies: enhanced,
        used: false,
        summary: advisor.summary ?? null,
        actions: advisorActions,
        reasonCode: null,
      }),
    };
  } catch {
    return {
      strategies,
      fallback: toLegacyFallbackShape({
        strategies,
        used: true,
        summary: "LLM enhancement failed. Deterministic coach strategies were returned.",
        reasonCode: "POLICY_CHECK_FAILED",
      }),
    };
  }
};

const buildRecommendations = async (params: {
  task: TaskProgress;
  weaknessProfile: WeaknessProfileEntry[];
  trend: Awaited<ReturnType<typeof buildTrendAnalysis>>;
  sourceAnalysisId: string;
  learnerProfile: LearnerProfile;
}) => {
  const preferredAccent = normalizeAccent(params.task.accent ?? DEFAULT_ACCENT);
  const accentRotation = rotateAccent(preferredAccent);
  const difficulty = deriveDifficulty({
    taskDifficulty: params.task.difficulty,
    trend: params.trend.direction,
    currentLevel: params.learnerProfile.currentLevel,
    targetBand: params.learnerProfile.targetBand,
  });
  const recent = await getRecentListeningSummaries(storage, params.task.userId, 8);

  const focusFromTag = (tag: ListeningScoringTag) => {
    if (tag === "numbers" || tag === "dates" || tag === "spelling_capture") return "number_capture";
    if (tag === "maps" || tag === "directions" || tag === "map_spatial_reference") return "map_labeling";
    if (tag === "instruction_limit_violation" || tag === "matching_pair_confusion") return "multi_select";
    if (tag === "synonyms" || tag === "vocabulary") return "note_completion";
    return "distractor_filtering";
  };

  const weaknessTags = new Set(params.weaknessProfile.map((entry) => entry.tag));
  const accentEvidence = new Map<
    string,
    {
      total: number;
      scoreTotal: number;
      weaknessHits: number;
      contextKeys: Set<string>;
    }
  >();
  recent.forEach((session) => {
    const accent = normalizeAccent(session.accent ?? DEFAULT_ACCENT);
    const score = Number(session.scorePercent ?? 0);
    const current = accentEvidence.get(accent) ?? { total: 0, scoreTotal: 0, weaknessHits: 0, contextKeys: new Set<string>() };
    current.total += 1;
    if (Number.isFinite(score) && score > 0) {
      current.scoreTotal += score;
    }
    Object.entries(session.sectionTagHistogram ?? {}).forEach(([, tags]) => {
      Object.entries(tags ?? {}).forEach(([tag, stats]) => {
        if (!weaknessTags.has(toListeningTag(tag))) return;
        const errorCount = Math.max(0, Number(stats.total ?? 0) - Number(stats.correct ?? 0));
        current.weaknessHits += errorCount;
      });
    });
    Object.entries(session.histogram ?? {}).forEach(([tag, stats]) => {
      if (!weaknessTags.has(toListeningTag(tag))) return;
      const errorCount = Math.max(0, Number(stats.total ?? 0) - Number(stats.correct ?? 0));
      current.weaknessHits += Math.ceil(errorCount * 0.25);
    });
    const exposure = session.contextExposure ?? null;
    const exposureKey = [exposure?.scriptType ?? "", exposure?.topicDomain ?? "", exposure?.contextLabel ?? ""]
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)
      .join("|");
    if (exposureKey) {
      current.contextKeys.add(exposureKey);
    }
    accentEvidence.set(accent, current);
  });
  const accentsByEvidence = [...accentEvidence.entries()]
    .map(([accent, stats]) => ({
      accent,
      ...stats,
      contextDiversity: stats.contextKeys.size,
      averageScore: Number((stats.scoreTotal / Math.max(1, stats.total)).toFixed(2)),
    }))
    .filter((stats) => stats.total >= 2 || stats.weaknessHits > 0 || stats.contextDiversity > 0)
    .sort((a, b) => {
      if (b.weaknessHits !== a.weaknessHits) {
        return b.weaknessHits - a.weaknessHits;
      }
      if (a.contextDiversity !== b.contextDiversity) {
        return a.contextDiversity - b.contextDiversity;
      }
      return a.averageScore - b.averageScore;
    })
    .map((entry) => entry.accent as Accent);
  const accentOrder = accentsByEvidence.length
    ? [...accentsByEvidence, ...accentRotation.filter((accent) => !accentsByEvidence.includes(accent))]
    : [...BALANCED_ACCENT_ROTATION];

  const ranked = params.weaknessProfile.slice(0, 4).map((weakness, index) => {
    const count = weakness.severity === "high" ? 3 : weakness.severity === "medium" ? 2 : 1;
    return {
      focus: focusFromTag(weakness.tag),
      difficulty,
      accent: accentOrder[index % accentOrder.length],
      count,
      reason: `${friendlyTagLabel(weakness.tag)} weakness (${weakness.severity}) with evidence-backed confidence from analysis ${params.sourceAnalysisId}; tuned for level ${params.learnerProfile.currentLevel ?? "n/a"} toward band ${params.learnerProfile.targetBand ?? "n/a"} with accent/context exposure signals when available.`,
      confidence: weakness.confidence,
      severity: weakness.severity,
    } as NextPracticeRecommendation;
  });

  const allowedFocus = new Set([
    "number_capture",
    "map_labeling",
    "multi_select",
    "note_completion",
    "distractor_filtering",
    "balanced_rotation",
  ]);
  const deduped: NextPracticeRecommendation[] = [];
  const focusSet = new Set<string>();
  const guardIssues: string[] = [];
  ranked.forEach((recommendation) => {
    if (!allowedFocus.has(recommendation.focus)) {
      guardIssues.push(`UNSUPPORTED_ENGINE_REFERENCE:${recommendation.focus}`);
      return;
    }
    if (focusSet.has(recommendation.focus)) {
      guardIssues.push(`DUPLICATE_FOCUS:${recommendation.focus}`);
      return;
    }
    if (recommendation.count > 3) {
      guardIssues.push(`EXCESSIVE_COUNT:${recommendation.focus}`);
      recommendation.count = 3;
    }
    focusSet.add(recommendation.focus);
    deduped.push(recommendation);
  });

  const totalCount = deduped.reduce((sum, item) => sum + item.count, 0);
  if (totalCount > 7) {
    guardIssues.push("EXCESSIVE_WORKLOAD");
    deduped.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
    let running = 0;
    deduped.forEach((item) => {
      if (running >= 7) {
        item.count = 1;
        return;
      }
      const remaining = 7 - running;
      item.count = Math.max(1, Math.min(item.count, remaining));
      running += item.count;
    });
  }

  if (!deduped.length) {
    deduped.push({
      focus: "balanced_rotation",
      difficulty: "medium",
      accent: accentOrder[0],
      count: 2,
      reason: "Insufficient weakness evidence. Use balanced listening rotation to gather more data safely.",
      confidence: 0.4,
      severity: "low",
    });
  }

  if (guardIssues.length) {
    console.warn("[PerformanceCoach][RecommendationGuard]", {
      taskId: params.task.id,
      issues: guardIssues,
    });
  }

  return {
    recommendations: deduped.slice(0, 5),
    guardIssues: Array.from(new Set(guardIssues)),
  };
};

const buildSpecificChallenges = (params: {
  weaknessProfile: WeaknessProfileEntry[];
  rootCause: ReturnType<typeof deriveRootCause>;
  trend: Awaited<ReturnType<typeof buildTrendAnalysis>>;
  integrityIssues: string[];
}) => {
  const challenges: string[] = [];
  params.weaknessProfile.slice(0, 3).forEach((item) => {
    const minQuestion = item.evidence_questions.length ? Math.min(...item.evidence_questions) : null;
    const maxQuestion = item.evidence_questions.length ? Math.max(...item.evidence_questions) : null;
    const rangeLabel =
      minQuestion !== null && maxQuestion !== null
        ? minQuestion === maxQuestion
          ? `question ${minQuestion}`
          : `questions ${minQuestion}-${maxQuestion}`
        : "across tracked questions";
    challenges.push(
      `${friendlyTagLabel(item.tag)} weakness in section ${item.affected_sections.join(", ") || "general"} context (${rangeLabel}).`,
    );
  });
  if (params.rootCause.type === "behavior_pattern") {
    challenges.push("Timing and replay behavior are reducing answer completion consistency.");
  }
  if (params.trend.direction === "down") {
    challenges.push("Recent trend indicates declining accuracy against prior sessions.");
  }
  if (params.integrityIssues.length) {
    challenges.push("Some question metadata were incomplete; confidence is reduced until more complete session telemetry is collected.");
  }
  return challenges.slice(0, 5);
};

const buildClosedLoopLinkage = (params: {
  task: TaskProgress;
  sessionId: string;
  attemptId: string;
  trend: Awaited<ReturnType<typeof buildTrendAnalysis>>;
  recommendations: NextPracticeRecommendation[];
}) => {
  const progressData = (params.task.progressData ?? {}) as Record<string, any>;
  const coach = (progressData.performanceCoach ?? {}) as Record<string, any>;
  const adoptedRecommendations = Array.isArray(coach.adoptedRecommendations)
    ? coach.adoptedRecommendations
    : [];
  const sourceAnalysisId = `${params.sessionId}:${params.attemptId}:${ANALYSIS_VERSION}`;
  const updatedPlanItems: string[] = [];
  const recommendationAdopted = adoptedRecommendations.length > 0;
  const loopBreakMetric = !params.task.weeklyPlanId
    ? "MISSING_WEEKLY_PLAN_LINK"
    : params.recommendations.length === 0
      ? "NO_RECOMMENDATIONS_GENERATED"
      : null;

  return {
    source_analysis_id: sourceAnalysisId,
    updated_plan_items: updatedPlanItems,
    recommendation_adopted: recommendationAdopted,
    trend_impact: params.trend.direction,
    loop_break_metric: loopBreakMetric,
  };
};

export const buildListeningPerformanceAnalysis = async (params: {
  task: TaskProgress;
  attemptId: string;
  score: { correct: number; total: number; percent: number };
  outcomes: AttemptOutcome[];
}) => {
  const progressData = (params.task.progressData ?? {}) as Record<string, any>;
  const sessionId = String(progressData?.sessionBatchId ?? params.task.id);
  const context = createTelemetryContext({
    traceId: sessionId,
    requestId: sessionId,
    userId: params.task.userId,
    weeklyPlanId: params.task.weeklyPlanId,
    sessionId,
    sectionId: params.task.id,
    partId: String(progressData?.sessionOrder ?? 1),
    agentName: "performance_coach_agent",
  });
  const span = startListeningStageSpan({
    stage: "coach_analyzed",
    context,
    taskProgressId: params.task.id,
  });
  const tagged = buildTaggedOutcomes(params.task, params.outcomes);
  const weaknessProfileResult = buildWeaknessProfile({
    taggedOutcomes: tagged.taggedOutcomes,
    integrity: tagged.integrity,
  });
  const weaknessProfile = weaknessProfileResult.weaknesses;
  const behaviorSignals = buildBehaviorSignals(tagged.taggedOutcomes);
  const rootCause = deriveRootCause({
    scorePercent: Number(params.score.percent ?? 0),
    behaviorSignals,
    weaknessProfile,
  });
  const histogram = buildTagHistogram(tagged.taggedOutcomes);
  const sectionTagHistogram = buildSectionTagHistogram(tagged.taggedOutcomes);
  const trend = await buildTrendAnalysis({
    userId: params.task.userId,
    taskId: params.task.id,
    currentScorePercent: Number(params.score.percent ?? 0),
    currentHistogram: histogram,
    currentSectionTagHistogram: sectionTagHistogram,
  });
  const baseStrategies = buildRuleBasedStrategies({
    weaknessProfile,
    rootCause,
  });
  const llmEnhanced = await maybeEnhanceStrategiesWithLlm(baseStrategies);
  const sourceAnalysisId = `${sessionId}:${params.attemptId}:${ANALYSIS_VERSION}`;
  const learnerProfile = await resolveLearnerProfile(params.task);
  const recommendationResult = await buildRecommendations({
    task: params.task,
    weaknessProfile,
    trend,
    sourceAnalysisId,
    learnerProfile,
  });
  const specificChallenges = buildSpecificChallenges({
    weaknessProfile,
    rootCause,
    trend,
    integrityIssues: weaknessProfileResult.integrityIssues,
  });
  const closedLoop = buildClosedLoopLinkage({
    task: params.task,
    sessionId,
    attemptId: params.attemptId,
    trend,
    recommendations: recommendationResult.recommendations,
  });
  if (recommendationResult.guardIssues.length && !closedLoop.loop_break_metric) {
    closedLoop.loop_break_metric = "RECOMMENDATION_GUARD_ADJUSTED";
  }
  if (weaknessProfileResult.integrityIssues.length && !closedLoop.loop_break_metric) {
    closedLoop.loop_break_metric = "QUESTION_METADATA_INTEGRITY_GAP";
  }

  const analysis = listeningPerformanceAnalysisSchema.parse({
    analysis_version: ANALYSIS_VERSION,
    generated_at: new Date().toISOString(),
    session_id: sessionId,
    attempt_id: params.attemptId,
    weakness_profile: weaknessProfile,
    behavior_signals: behaviorSignals,
    root_cause: rootCause,
    trend,
    personalized_strategies: llmEnhanced.strategies,
    specific_challenges: specificChallenges,
    next_practice_set: recommendationResult.recommendations,
    fallback: llmEnhanced.fallback,
    governance: buildGovernanceProvenance({
      task: params.task,
      riskClass: "personalized_coaching",
      confidenceScore: rootCause.confidence,
      fallbackUsed: llmEnhanced.fallback.used,
      fallbackReason: llmEnhanced.fallback.reason_code ?? null,
    }),
    closed_loop: closedLoop,
  });
  const governanceGate = runGovernancePolicyGateForCoachAnalysis(analysis);
  const finalAnalysis = governanceGate.ok
    ? analysis
    : listeningPerformanceAnalysisSchema.parse({
        ...analysis,
        personalized_strategies: baseStrategies,
        fallback: toLegacyFallbackShape({
          strategies: baseStrategies,
          used: true,
          summary: `Governance fallback activated: ${governanceGate.message ?? governanceGate.code}`,
          reasonCode: governanceGate.code ?? "POLICY_CHECK_FAILED",
        }),
        governance: buildGovernanceProvenance({
          task: params.task,
          riskClass: "personalized_coaching",
          confidenceScore: rootCause.confidence,
          fallbackUsed: true,
          fallbackReason: governanceGate.code ?? "POLICY_CHECK_FAILED",
        }),
      });
  await finishListeningStageSpan(span, {
    success: true,
    metadata: {
      weaknesses: finalAnalysis.weakness_profile.length,
      strategies: finalAnalysis.personalized_strategies.length,
      recommendations: finalAnalysis.next_practice_set.length,
    },
  });

  return finalAnalysis;
};

const patchClosedLoopOnAnalysis = (analysis: any, patch: Partial<ListeningPerformanceAnalysis["closed_loop"]>) => {
  if (!analysis || typeof analysis !== "object") return analysis;
  const closedLoop = (analysis.closed_loop ?? {}) as Record<string, any>;
  return {
    ...analysis,
    closed_loop: {
      ...closedLoop,
      ...patch,
    },
  };
};

const applyWeeklyPlanAdjustmentBridge = async (params: {
  task: TaskProgress;
  analysis: ListeningPerformanceAnalysis;
  traceId: string;
  correlationId: string;
}) => {
  const sourceAnalysisId = params.analysis.closed_loop.source_analysis_id;
  const nowIso = new Date().toISOString();
  const weeklyPlanId = params.task.weeklyPlanId ?? null;
  if (!weeklyPlanId) {
    return {
      updatedPlanItemIds: [] as string[],
      loopBreakMetric: "MISSING_WEEKLY_PLAN_LINK",
    };
  }

  const sourceTask = (await storage.getTaskProgress(params.task.id)) ?? params.task;
  const sourceProgressData = (sourceTask.progressData ?? {}) as Record<string, any>;
  const sourceCoach = (sourceProgressData.performanceCoach ?? {}) as Record<string, any>;
  const bridgeState = (sourceCoach.bridge ?? {}) as Record<string, any>;
  const appliedSourceAnalyses = Array.isArray(bridgeState.appliedSourceAnalyses)
    ? bridgeState.appliedSourceAnalyses
    : [];
  if (appliedSourceAnalyses.includes(sourceAnalysisId)) {
    const existing = Array.isArray(bridgeState.linkages)
      ? bridgeState.linkages.find((entry: any) => entry?.sourceAnalysisId === sourceAnalysisId)
      : null;
    return {
      updatedPlanItemIds: Array.isArray(existing?.updatedPlanItems) ? existing.updatedPlanItems : [],
      loopBreakMetric: null,
    };
  }

  const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
  if (!weeklyPlan) {
    return {
      updatedPlanItemIds: [] as string[],
      loopBreakMetric: "WEEKLY_PLAN_NOT_FOUND",
    };
  }

  const planTasks = await storage.getTaskProgressByWeeklyPlan(weeklyPlanId, params.task.userId);
  const candidateTasks = planTasks
    .filter((task) => task.id !== params.task.id && String(task.status ?? "") !== "completed")
    .sort((a, b) => {
      if (Number(a.dayNumber ?? 0) !== Number(b.dayNumber ?? 0)) {
        return Number(a.dayNumber ?? 0) - Number(b.dayNumber ?? 0);
      }
      return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
    });

  const appliedTaskIds: string[] = [];
  const appliedByTaskId = new Map<string, NextPracticeRecommendation>();
  params.analysis.next_practice_set.slice(0, 5).forEach((recommendation, index) => {
    const target = candidateTasks[index];
    if (!target) return;
    appliedTaskIds.push(target.id);
    appliedByTaskId.set(target.id, recommendation);
  });

  for (const targetId of appliedTaskIds) {
    const target = planTasks.find((task) => task.id === targetId);
    const recommendation = appliedByTaskId.get(targetId);
    if (!target || !recommendation) continue;
    const targetProgressData = (target.progressData ?? {}) as Record<string, any>;
    const targetCoach = (targetProgressData.performanceCoach ?? {}) as Record<string, any>;
    const adoptedRecommendations = Array.isArray(targetCoach.adoptedRecommendations)
      ? targetCoach.adoptedRecommendations
      : [];
    const duplicate = adoptedRecommendations.some(
      (entry: any) =>
        entry?.sourceAnalysisId === sourceAnalysisId &&
        entry?.sourceTaskProgressId === params.task.id &&
        entry?.focus === recommendation.focus,
    );
    if (duplicate) {
      continue;
    }
    const nextAdopted = [
      ...adoptedRecommendations,
      {
        sourceAnalysisId,
        sourceTaskProgressId: params.task.id,
        sourceSessionId: params.analysis.session_id,
        sourceAttemptId: params.analysis.attempt_id,
        focus: recommendation.focus,
        difficulty: recommendation.difficulty,
        accent: recommendation.accent,
        reason: recommendation.reason,
        confidence: recommendation.confidence,
        severity: recommendation.severity,
        linkedAt: nowIso,
      },
    ];
    await storage.updateTaskProgress(target.id, {
      progressData: {
        ...targetProgressData,
        performanceCoach: {
          ...targetCoach,
          adoptedRecommendations: nextAdopted,
        },
      },
    });
  }

  const planData = (weeklyPlan.planData ?? {}) as Record<string, any>;
  const planEntries = Array.isArray(planData.plan) ? planData.plan : [];
  const taskByDay = new Map<number, TaskProgress>();
  planTasks.forEach((task) => {
    if (!taskByDay.has(task.dayNumber)) {
      taskByDay.set(task.dayNumber, task);
    }
  });
  const planByTaskId = new Map<string, NextPracticeRecommendation>();
  appliedByTaskId.forEach((recommendation, taskId) => {
    planByTaskId.set(taskId, recommendation);
  });

  const nextPlanEntries = planEntries.map((entry: any) => {
    const dayNumber = Number(entry?.dayNumber ?? 0);
    const mappedTask = taskByDay.get(dayNumber);
    const progressId = entry?.progressId ?? mappedTask?.id ?? null;
    if (!progressId || !planByTaskId.has(progressId)) {
      return entry;
    }
    const recommendation = planByTaskId.get(progressId)!;
    const existingCoaching = Array.isArray(entry?.coachingRecommendations)
      ? entry.coachingRecommendations
      : [];
    const duplicate = existingCoaching.some(
      (item: any) => item?.sourceAnalysisId === sourceAnalysisId && item?.focus === recommendation.focus,
    );
    if (duplicate) {
      return {
        ...entry,
        progressId,
      };
    }
    return {
      ...entry,
      progressId,
      coachingRecommendations: [
        ...existingCoaching,
        {
          sourceAnalysisId,
          focus: recommendation.focus,
          difficulty: recommendation.difficulty,
          accent: recommendation.accent,
          linkedAt: nowIso,
        },
      ],
    };
  });

  const adjustmentHistory = Array.isArray((planData.performanceCoach ?? {}).adjustments)
    ? (planData.performanceCoach as any).adjustments
    : [];
  const adjustmentExists = adjustmentHistory.some(
    (entry: any) => entry?.sourceAnalysisId === sourceAnalysisId,
  );
  const nextAdjustmentHistory = adjustmentExists
    ? adjustmentHistory
    : [
        ...adjustmentHistory,
        {
          sourceAnalysisId,
          sourceTaskProgressId: params.task.id,
          sourceAttemptId: params.analysis.attempt_id,
          sourceSessionId: params.analysis.session_id,
          requestedAt: nowIso,
          recommendedFocus: params.analysis.next_practice_set.map((item) => item.focus),
          updatedPlanItems: appliedTaskIds,
          traceId: params.traceId,
          correlationId: params.correlationId,
        },
      ];

  await storage.updateWeeklyStudyPlanPlanData(weeklyPlan.id, {
    ...planData,
    plan: nextPlanEntries,
    performanceCoach: {
      ...((planData.performanceCoach ?? {}) as Record<string, any>),
      adjustments: nextAdjustmentHistory.slice(-30),
      updatedAt: nowIso,
    },
  });

  const sourceLatest = patchClosedLoopOnAnalysis(sourceCoach.latest, {
    updated_plan_items: appliedTaskIds,
    loop_break_metric: appliedTaskIds.length ? null : "MISSING_UPDATED_PLAN_ITEMS",
  });
  const sourceHistory = Array.isArray(sourceCoach.history)
    ? sourceCoach.history.map((entry: any) =>
        entry?.closed_loop?.source_analysis_id === sourceAnalysisId
          ? patchClosedLoopOnAnalysis(entry, {
              updated_plan_items: appliedTaskIds,
              loop_break_metric: appliedTaskIds.length ? null : "MISSING_UPDATED_PLAN_ITEMS",
            })
          : entry,
      )
    : [];
  const nextBridgeLinkages = Array.isArray(bridgeState.linkages) ? [...bridgeState.linkages] : [];
  nextBridgeLinkages.push({
    sourceAnalysisId,
    updatedPlanItems: appliedTaskIds,
    updatedAt: nowIso,
  });
  await storage.updateTaskProgress(sourceTask.id, {
    progressData: {
      ...sourceProgressData,
      performanceCoach: {
        ...sourceCoach,
        latest: sourceLatest,
        history: sourceHistory,
        closedLoop: sourceLatest?.closed_loop ?? sourceCoach.closedLoop ?? null,
        bridge: {
          ...bridgeState,
          appliedSourceAnalyses: [...appliedSourceAnalyses, sourceAnalysisId],
          linkages: nextBridgeLinkages.slice(-30),
        },
      },
    },
  });

  return {
    updatedPlanItemIds: appliedTaskIds,
    loopBreakMetric: appliedTaskIds.length ? null : "MISSING_UPDATED_PLAN_ITEMS",
  };
};

const recordClosedLoopOutcomes = async (params: {
  task: TaskProgress;
  analysis: ListeningPerformanceAnalysis;
  progressData: Record<string, any>;
}) => {
  const coach = (params.progressData.performanceCoach ?? {}) as Record<string, any>;
  const adoptedRecommendations = Array.isArray(coach.adoptedRecommendations)
    ? coach.adoptedRecommendations
    : [];
  if (!adoptedRecommendations.length) return;

  const nowIso = new Date().toISOString();
  const sourceGroups = new Map<string, { sourceAnalysisId: string; sourceTaskProgressId: string }>();
  adoptedRecommendations.forEach((entry: any) => {
    const sourceAnalysisId = String(entry?.sourceAnalysisId ?? "");
    const sourceTaskProgressId = String(entry?.sourceTaskProgressId ?? "");
    if (!sourceAnalysisId || !sourceTaskProgressId) return;
    sourceGroups.set(`${sourceTaskProgressId}:${sourceAnalysisId}`, {
      sourceAnalysisId,
      sourceTaskProgressId,
    });
  });

  for (const group of sourceGroups.values()) {
    const sourceTask = await storage.getTaskProgress(group.sourceTaskProgressId);
    if (!sourceTask) continue;
    const sourceProgressData = (sourceTask.progressData ?? {}) as Record<string, any>;
    const sourceCoach = (sourceProgressData.performanceCoach ?? {}) as Record<string, any>;
    const linkageOutcomes = Array.isArray(sourceCoach.closedLoopOutcomes)
      ? sourceCoach.closedLoopOutcomes
      : [];
    const duplicate = linkageOutcomes.some(
      (entry: any) =>
        entry?.sourceAnalysisId === group.sourceAnalysisId &&
        entry?.adoptedTaskProgressId === params.task.id &&
        entry?.adoptedAttemptId === params.analysis.attempt_id,
    );
    if (duplicate) continue;

    const nextOutcomes = [
      ...linkageOutcomes,
      {
        sourceAnalysisId: group.sourceAnalysisId,
        adoptedTaskProgressId: params.task.id,
        adoptedAttemptId: params.analysis.attempt_id,
        outcomeRecordedAt: nowIso,
        trendImpact: params.analysis.trend.direction,
      },
    ];

    const sourceLatest = sourceCoach.latest;
    const shouldPatchLatest = sourceLatest?.closed_loop?.source_analysis_id === group.sourceAnalysisId;
    const patchedLatest = shouldPatchLatest
      ? patchClosedLoopOnAnalysis(sourceLatest, {
          recommendation_adopted: true,
          trend_impact: params.analysis.trend.direction,
          loop_break_metric: null,
        })
      : sourceLatest;

    await storage.updateTaskProgress(sourceTask.id, {
      progressData: {
        ...sourceProgressData,
        performanceCoach: {
          ...sourceCoach,
          latest: patchedLatest,
          closedLoop: patchedLatest?.closed_loop ?? sourceCoach.closedLoop ?? null,
          closedLoopOutcomes: nextOutcomes.slice(-50),
        },
      },
    });
  }
};

export const persistListeningPerformanceAnalysis = async (params: {
  task: TaskProgress;
  analysis: ListeningPerformanceAnalysis;
}) => {
  const progressData = (params.task.progressData ?? {}) as Record<string, any>;
  const coach = (progressData.performanceCoach ?? {}) as Record<string, any>;
  const adoptedRecommendations = Array.isArray(coach.adoptedRecommendations)
    ? coach.adoptedRecommendations
    : [];
  const nowIso = new Date().toISOString();
  const consumedAdoptions = adoptedRecommendations.map((entry: any) => ({
    ...entry,
    consumedAt: entry?.consumedAt ?? nowIso,
    adoptedAttemptId: params.analysis.attempt_id,
  }));
  const history = Array.isArray(coach.history) ? coach.history : [];
  const nextHistory = [...history, params.analysis].slice(-10);
  const nextProgressData = {
    ...progressData,
    performanceCoach: {
      ...coach,
      version: ANALYSIS_VERSION,
      updatedAt: params.analysis.generated_at,
      latest: params.analysis,
      history: nextHistory,
      closedLoop: params.analysis.closed_loop,
      adoptedRecommendations: consumedAdoptions,
    },
  };
  await storage.updateTaskProgress(params.task.id, { progressData: nextProgressData });
  await recordClosedLoopOutcomes({
    task: params.task,
    analysis: params.analysis,
    progressData: nextProgressData,
  });
  return nextProgressData;
};

const publishCoachEventWithRetry = async (params: {
  task: TaskProgress;
  idempotencyKey: string;
  topic: typeof LISTENING_EVENT_TOPICS.FEEDBACK_EVENTS;
  eventType: string;
  payload: Record<string, unknown>;
  traceId: string;
  correlationId: string;
  maxAttempts?: number;
}) => {
  const alreadyProcessed = await hasProcessedListeningIdempotencyKey(params.task.id, params.idempotencyKey);
  if (alreadyProcessed) return null;

  const maxAttempts = Math.max(1, params.maxAttempts ?? 3);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const event = publishListeningEvent({
        topic: params.topic,
        eventType: params.eventType,
        eventVersion: ANALYSIS_VERSION,
        producer: "performance-coach",
        traceId: params.traceId,
        correlationId: params.correlationId,
        idempotencyKey: params.idempotencyKey,
        userId: params.task.userId,
        payload: params.payload,
      });
      await persistListeningEventToOutbox({
        taskProgressId: params.task.id,
        userId: params.task.userId,
        topic: params.topic,
        event,
      });
      await markProcessedListeningIdempotencyKey(params.task.id, params.idempotencyKey);
      return event;
    } catch (error: any) {
      lastError = error;
      const errorCode = canonicalizeListeningErrorCode(error);
      const retry = classifyListeningRetry({ step: "publish", errorCode });
      if (retry.disposition === "non_retryable" || attempt >= maxAttempts) {
        break;
      }
      await sleep(getListeningRetryDelayMs("publish", attempt - 1));
    }
  }

  await routeListeningTerminalFailureToDLQ({
    task: params.task,
    sectionId: `${params.task.id}:coach`,
    sectionNo: Number(((params.task.progressData ?? {}) as Record<string, any>)?.sessionOrder ?? 1),
    stepName: "performance_coach_publish",
    errorCode: canonicalizeListeningErrorCode(lastError),
    attempts: maxAttempts,
    context: {
      eventType: params.eventType,
      idempotencyKey: params.idempotencyKey,
    },
    traceId: params.traceId,
    correlationId: params.correlationId,
  });
  throw lastError;
};

export const publishListeningPerformanceCoachEvents = async (params: {
  task: TaskProgress;
  analysis: ListeningPerformanceAnalysis;
  traceId?: string;
  correlationId?: string;
}) => {
  const traceId = params.traceId ?? `trc_coach_${randomUUID()}`;
  const correlationId = params.correlationId ?? params.analysis.session_id;
  const analysisKey = `${params.analysis.session_id}:${params.analysis.attempt_id}:${params.analysis.analysis_version}`;

  const performancePayload = {
    listening_session_id: params.analysis.session_id,
    attempt_id: params.analysis.attempt_id,
    source_analysis_id: params.analysis.closed_loop.source_analysis_id,
    weakness_profile: params.analysis.weakness_profile,
    personalized_strategies: params.analysis.personalized_strategies,
    specific_challenges: params.analysis.specific_challenges,
    next_practice_set: params.analysis.next_practice_set,
    trend: params.analysis.trend,
  };
  const performanceEvent = await publishCoachEventWithRetry({
    task: params.task,
    idempotencyKey: `${analysisKey}:performance_analyzed`,
    topic: LISTENING_EVENT_TOPICS.FEEDBACK_EVENTS,
    eventType: LISTENING_EVENT_TYPES.PERFORMANCE_ANALYZED,
    payload: performancePayload,
    traceId,
    correlationId,
  });

  const progressData = (params.task.progressData ?? {}) as Record<string, any>;
  const weeklyPlanId = params.task.weeklyPlanId ?? null;
  const adjustmentPayload = tutorAdjustmentRequestSchema.parse({
    weekly_plan_id: weeklyPlanId,
    listening_session_id: params.analysis.session_id,
    attempt_id: params.analysis.attempt_id,
    source_analysis_id: params.analysis.closed_loop.source_analysis_id,
    weakness_profile: params.analysis.weakness_profile.map((entry) => ({
      tag: entry.tag,
      severity: entry.severity,
      confidence: entry.confidence,
    })),
    recommended_focus: params.analysis.next_practice_set.map((item) => item.focus),
  }) as TutorAdjustmentRequest;

  const adjustmentEvent = await publishCoachEventWithRetry({
    task: params.task,
    idempotencyKey: `${analysisKey}:weekly_plan_adjustment`,
    topic: LISTENING_EVENT_TOPICS.FEEDBACK_EVENTS,
    eventType: LISTENING_EVENT_TYPES.WEEKLY_PLAN_ADJUSTMENT_REQUESTED,
    payload: adjustmentPayload as unknown as Record<string, unknown>,
    traceId,
    correlationId,
  });

  const bridgeResult = await applyWeeklyPlanAdjustmentBridge({
    task: params.task,
    analysis: params.analysis,
    traceId,
    correlationId,
  });
  const persistedTask = (await storage.getTaskProgress(params.task.id)) ?? params.task;
  const persistedProgressData = (persistedTask.progressData ?? progressData) as Record<string, any>;
  const persistedCoach = (persistedProgressData.performanceCoach ?? {}) as Record<string, any>;
  const latestAnalysis = persistedCoach.latest ?? params.analysis;
  const patchedLatest = patchClosedLoopOnAnalysis(latestAnalysis, {
    updated_plan_items: bridgeResult.updatedPlanItemIds,
    loop_break_metric: bridgeResult.loopBreakMetric ?? latestAnalysis?.closed_loop?.loop_break_metric ?? null,
  });
  const patchedHistory = Array.isArray(persistedCoach.history)
    ? persistedCoach.history.map((entry: any) =>
        entry?.closed_loop?.source_analysis_id === params.analysis.closed_loop.source_analysis_id
          ? patchClosedLoopOnAnalysis(entry, {
              updated_plan_items: bridgeResult.updatedPlanItemIds,
              loop_break_metric: bridgeResult.loopBreakMetric ?? entry?.closed_loop?.loop_break_metric ?? null,
            })
          : entry,
      )
    : [];

  await storage.updateTaskProgress(params.task.id, {
    progressData: {
      ...persistedProgressData,
      performanceCoach: {
        ...persistedCoach,
        latest: patchedLatest,
        history: patchedHistory,
        closedLoop: patchedLatest?.closed_loop ?? persistedCoach.closedLoop ?? null,
        lastPublishedAt: new Date().toISOString(),
        eventIds: {
          performanceAnalyzed: performanceEvent?.event_id ?? null,
          weeklyPlanAdjustment: adjustmentEvent?.event_id ?? null,
        },
      },
    },
  });

  return {
    performanceEventId: performanceEvent?.event_id ?? null,
    adjustmentEventId: adjustmentEvent?.event_id ?? null,
    updatedPlanItems: bridgeResult.updatedPlanItemIds,
  };
};
