export type ListeningPriorityClass = "P1_CURRENT" | "P2_NEXT_24H" | "P3_LATER";
export type ListeningPrefetchSource =
  | "dashboard_start_click"
  | "session_open"
  | "transition_wait"
  | "task_content_auto"
  | "next_task_create"
  | "session_detail"
  | "unknown";

export const normalizeListeningPrefetchSource = (value: unknown): ListeningPrefetchSource => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "dashboard_start_click") return "dashboard_start_click";
  if (raw === "session_open") return "session_open";
  if (raw === "transition_wait") return "transition_wait";
  if (raw === "task_content_auto") return "task_content_auto";
  if (raw === "next_task_create") return "next_task_create";
  if (raw === "session_detail") return "session_detail";
  return "unknown";
};

export const deriveListeningPrioritySignalsFromSource = (source: ListeningPrefetchSource) => {
  if (source === "dashboard_start_click") {
    return {
      dashboardOpenBoost: true,
      startClickBoost: true,
    };
  }
  if (source === "session_open" || source === "transition_wait" || source === "next_task_create") {
    return {
      dashboardOpenBoost: false,
      startClickBoost: true,
    };
  }
  if (source === "session_detail") {
    return {
      dashboardOpenBoost: true,
      startClickBoost: false,
    };
  }
  return {
    dashboardOpenBoost: false,
    startClickBoost: false,
  };
};

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
