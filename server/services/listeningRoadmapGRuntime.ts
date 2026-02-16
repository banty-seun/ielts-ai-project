export type ListeningStartupGateMode = "legacy" | "section_ready";
export type ListeningStartupGateStrategy = ListeningStartupGateMode | "cohort";

export type ListeningStartupGateConfig = {
  strategy: ListeningStartupGateStrategy;
  cohortPercent: number;
  cohortSeed: string;
};

const LEGACY_READY_STATES = new Set(["ready"]);

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const normalizeTimestamp = (value: unknown): number | null => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const stableBucketPercent = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
};

const percentileFromSorted = (sorted: number[], ratio: number) => {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[index];
};

export const resolveListeningStartupGateStrategy = (raw: unknown): ListeningStartupGateStrategy => {
  const normalized = String(raw ?? "section_ready").toLowerCase();
  if (normalized === "legacy") return "legacy";
  if (normalized === "cohort" || normalized === "mixed") return "cohort";
  return "section_ready";
};

export const resolveListeningStartupGateModeForTask = (
  config: ListeningStartupGateConfig,
  params: {
    taskProgressId: string;
    userId?: string | null;
  },
): ListeningStartupGateMode => {
  if (config.strategy === "legacy") return "legacy";
  if (config.strategy === "section_ready") return "section_ready";

  const cohortPercent = clampPercent(config.cohortPercent);
  if (cohortPercent <= 0) return "legacy";
  if (cohortPercent >= 100) return "section_ready";

  const base = [
    config.cohortSeed,
    params.userId ?? "unknown-user",
    params.taskProgressId || "unknown-task",
  ].join(":");
  const bucket = stableBucketPercent(base);
  return bucket < cohortPercent ? "section_ready" : "legacy";
};

export const resolveStartupGateReadyForMode = (params: {
  mode: ListeningStartupGateMode;
  partReady: boolean;
  prefetchStatus?: string | null;
  hasAudio: boolean;
}) => {
  if (params.mode !== "legacy") {
    return params.partReady;
  }
  const status = String(params.prefetchStatus ?? "idle");
  return (
    params.partReady ||
    LEGACY_READY_STATES.has(status) ||
    (status === "ready_partial" && params.hasAudio) ||
    params.hasAudio
  );
};

export const buildTimingDistribution = (values: number[]) => {
  if (!values.length) {
    return {
      count: 0,
      minMs: null,
      maxMs: null,
      p50Ms: null,
      p90Ms: null,
      avgMs: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: percentileFromSorted(sorted, 0.5),
    p90Ms: percentileFromSorted(sorted, 0.9),
    avgMs: Math.round(total / sorted.length),
  };
};

export const buildSectionAndSessionAnalytics = (
  sectionResults: Array<Record<string, any>>,
  schemaVersion: string,
) => {
  const sections = sectionResults.map((section) => {
    const perQuestion = Array.isArray(section?.perQuestion) ? section.perQuestion : [];
    const timings = perQuestion
      .map((entry: any) => Number(entry?.responseTimeMs ?? 0))
      .filter((value: number) => Number.isFinite(value) && value > 0);
    const replayTotal = perQuestion.reduce((sum: number, entry: any) => sum + Number(entry?.replayCount ?? 0), 0);
    const answerChangeTotal = perQuestion.reduce(
      (sum: number, entry: any) => sum + Number(entry?.answerChangeCount ?? 0),
      0,
    );
    return {
      sectionId: String(section?.sectionId ?? ""),
      sectionNo: Number(section?.sectionNo ?? 0),
      attempted: Number(section?.attempted ?? 0),
      correct: Number(section?.correct ?? 0),
      incorrect: Number(section?.incorrect ?? 0),
      unanswered: Number(section?.unanswered ?? 0),
      accuracy: Number(section?.accuracy ?? 0),
      challengeTags: Array.isArray(section?.challengeTags) ? section.challengeTags : [],
      timing: buildTimingDistribution(timings),
      playback: {
        replayTotal,
        answerChangeTotal,
      },
      submittedAt: section?.submittedAt ?? null,
      acknowledgedAt: section?.acknowledgedAt ?? null,
    };
  });

  const allQuestionRows = sectionResults.flatMap((section) =>
    Array.isArray(section?.perQuestion) ? section.perQuestion : [],
  );
  const allTimings = allQuestionRows
    .map((entry: any) => Number(entry?.responseTimeMs ?? 0))
    .filter((value: number) => Number.isFinite(value) && value > 0);
  const replayTotal = allQuestionRows.reduce((sum, entry: any) => sum + Number(entry?.replayCount ?? 0), 0);
  const answerChangeTotal = allQuestionRows.reduce(
    (sum, entry: any) => sum + Number(entry?.answerChangeCount ?? 0),
    0,
  );

  return {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    sections,
    session: {
      totalSections: sections.length,
      playback: {
        replayTotal,
        answerChangeTotal,
      },
      timing: buildTimingDistribution(allTimings),
    },
  };
};

export const buildCoachOutcomesFromSectionResults = (sectionResults: Array<Record<string, any>>) => {
  return sectionResults.flatMap((section) => {
    const perQuestion = Array.isArray(section?.perQuestion) ? section.perQuestion : [];
    return perQuestion.map((entry: any) => ({
      questionId: String(entry?.questionId ?? ""),
      isCorrect: Boolean(entry?.correct),
      responseTimeMs:
        Number.isFinite(Number(entry?.responseTimeMs)) && Number(entry?.responseTimeMs) > 0
          ? Math.round(Number(entry?.responseTimeMs))
          : null,
      answerChangeCount:
        Number.isFinite(Number(entry?.answerChangeCount)) && Number(entry?.answerChangeCount) > 0
          ? Math.round(Number(entry?.answerChangeCount))
          : 0,
      replayCount:
        Number.isFinite(Number(entry?.replayCount)) && Number(entry?.replayCount) > 0
          ? Math.round(Number(entry?.replayCount))
          : 0,
      unanswered: Boolean(entry?.unanswered),
    }));
  });
};

export const summarizeStartupGateTelemetry = (
  startupTelemetry: Record<string, any>,
  nowMs: number = Date.now(),
) => {
  const waits = Array.isArray(startupTelemetry.waits) ? startupTelemetry.waits : [];
  const waitValues = waits
    .map((entry: any) => {
      const explicit = Number(entry?.waitMs);
      if (Number.isFinite(explicit) && explicit >= 0) {
        return Math.round(explicit);
      }
      const startedAt = normalizeTimestamp(entry?.startedAt);
      const readyAt = normalizeTimestamp(entry?.readyAt);
      if (startedAt !== null && readyAt !== null && readyAt >= startedAt) {
        return Math.round(readyAt - startedAt);
      }
      return null;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const totalWaitMs = waitValues.reduce((sum, value) => sum + value, 0);
  const waitingStartedAt = normalizeTimestamp(startupTelemetry.waitingStartedAt);
  const inFlightWaitMs =
    waitingStartedAt !== null && nowMs >= waitingStartedAt ? Math.round(nowMs - waitingStartedAt) : null;

  const boostCount = Number(startupTelemetry.boostCount ?? 0);
  const successfulBoostCount = Number(startupTelemetry.successfulBoostCount ?? 0);

  return {
    version: startupTelemetry.version ?? null,
    mode: startupTelemetry.mode ?? null,
    boostCount,
    successfulBoostCount,
    boostSuccessRate:
      boostCount > 0 ? Number((successfulBoostCount / Math.max(boostCount, 1)).toFixed(4)) : null,
    boostBySource:
      startupTelemetry.boostBySource && typeof startupTelemetry.boostBySource === "object"
        ? startupTelemetry.boostBySource
        : {},
    lastBoostAt: startupTelemetry.lastBoostAt ?? null,
    lastBoostSource: startupTelemetry.lastBoostSource ?? null,
    waitingStartedAt: startupTelemetry.waitingStartedAt ?? null,
    inFlightWaitMs,
    waitStats: {
      count: waitValues.length,
      minMs: waitValues.length ? waitValues[0] : null,
      maxMs: waitValues.length ? waitValues[waitValues.length - 1] : null,
      p50Ms: percentileFromSorted(waitValues, 0.5),
      p90Ms: percentileFromSorted(waitValues, 0.9),
      avgMs: waitValues.length ? Math.round(totalWaitMs / waitValues.length) : null,
      totalMs: totalWaitMs,
    },
  };
};
