export type ListeningPriorityClass = "P1_CURRENT" | "P2_NEXT_24H" | "P3_LATER";

export const deriveListeningPriority = (params: {
  sessionStartAt?: Date | null;
  now?: Date;
  dashboardOpenBoost?: boolean;
  startClickBoost?: boolean;
  readinessGap?: number;
}) => {
  const now = params.now ?? new Date();
  const sessionStartMs = params.sessionStartAt ? params.sessionStartAt.getTime() : null;
  const minutesToSession = sessionStartMs !== null ? Math.round((sessionStartMs - now.getTime()) / 60_000) : null;

  const imminenceScore = minutesToSession === null ? 0 : minutesToSession <= 60 ? 100 : minutesToSession <= 24 * 60 ? 50 : 10;
  const dashboardBoost = params.dashboardOpenBoost ? 10 : 0;
  const startBoost = params.startClickBoost ? 20 : 0;
  const readinessGapBoost = Math.max(0, Math.min(20, Number(params.readinessGap ?? 0) * 5));

  const score = imminenceScore + dashboardBoost + startBoost + readinessGapBoost;
  const priorityClass: ListeningPriorityClass = score >= 90 ? "P1_CURRENT" : score >= 45 ? "P2_NEXT_24H" : "P3_LATER";

  return {
    score,
    priorityClass,
    components: {
      imminenceScore,
      dashboardBoost,
      startBoost,
      readinessGapBoost,
      minutesToSession,
    },
  };
};
