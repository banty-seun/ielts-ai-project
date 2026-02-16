import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../db";
import { listeningDeadLetter, listeningQueueMetric, taskProgress } from "@shared/schema";
import { getPrefetchRetryMetricsSnapshot } from "./prefetchRetry";
import { listRecentListeningSyntheticProbeRuns } from "./listeningSyntheticProbes";

type AlertSeverity = "warning" | "high" | "critical";

export type ListeningAlert = {
  signature: string;
  rule: string;
  severity: AlertSeverity;
  observed: number;
  threshold: number;
  windowMinutes: number;
  traceId: string | null;
  requestId: string | null;
  sessionId: string | null;
  sectionId: string | null;
  topFailingStage: string | null;
  topFailingProvider: string | null;
  dedupeWindowMinutes: number;
  suppressionWindowMinutes: number;
  at: string;
};

type AlertRuleState = {
  open: boolean;
  lastSentAtMs: number;
  healthyWindows: number;
  suppressionUntilMs: number;
};

type AlertEngineState = {
  timer: NodeJS.Timeout | null;
  intervalMs: number | null;
  ruleStates: Map<string, AlertRuleState>;
  lastRetrySnapshot: ReturnType<typeof getPrefetchRetryMetricsSnapshot> | null;
  lastTtsFailureCount: number;
  lastEvaluatedAt: string | null;
};

const PUBLISH_WINDOW_MIN = 15;
const DLQ_WINDOW_MIN = 10;
const RETRY_WINDOW_MIN = 15;
const TTS_WINDOW_MIN = 15;
const COACH_WINDOW_MIN = 60;

const DEDUPE_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.LISTENING_ALERT_DEDUPE_WINDOW_MS ?? 10 * 60_000),
);
const SUPPRESSION_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.LISTENING_ALERT_SUPPRESSION_WINDOW_MS ?? 15 * 60_000),
);
const AUTO_RESOLVE_HEALTHY_WINDOWS = Math.max(
  1,
  Number(process.env.LISTENING_ALERT_AUTO_RESOLVE_WINDOWS ?? 2),
);
const ALERT_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.LISTENING_ALERT_EVAL_INTERVAL_MS ?? 5 * 60_000),
);
const TTS_FAILURE_THRESHOLD = Math.max(
  1,
  Number(process.env.LISTENING_TTS_ALERT_FAILURE_THRESHOLD ?? 3),
);

const state: AlertEngineState = {
  timer: null,
  intervalMs: null,
  ruleStates: new Map(),
  lastRetrySnapshot: null,
  lastTtsFailureCount: 0,
  lastEvaluatedAt: null,
};

const classifyProviderFromErrorCode = (errorCode: string) => {
  const normalized = String(errorCode).toUpperCase();
  if (normalized.includes("POLLY") || normalized.includes("AWS")) return "polly";
  if (normalized.includes("OPENAI")) return "openai";
  if (normalized.includes("TTS")) return "tts";
  return "unknown";
};

const computeTopFailingProvider = (retrySnapshot: ReturnType<typeof getPrefetchRetryMetricsSnapshot>) => {
  const providerCounts: Record<string, number> = {};
  for (const [code, count] of Object.entries(retrySnapshot.byErrorCode)) {
    const provider = classifyProviderFromErrorCode(code);
    providerCounts[provider] = Number(providerCounts[provider] ?? 0) + Number(count ?? 0);
  }
  return Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

const computeTopFailingStage = async () => {
  const rows = await db
    .select({
      stepName: listeningDeadLetter.stepName,
    })
    .from(listeningDeadLetter)
    .where(isNull(listeningDeadLetter.resolvedAt))
    .orderBy(desc(listeningDeadLetter.createdAt))
    .limit(500);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row.stepName ?? "unknown_stage");
    counts[key] = Number(counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

const getCorrelationSample = async () => {
  const [row] = await db
    .select({
      metadata: listeningQueueMetric.metadata,
    })
    .from(listeningQueueMetric)
    .orderBy(desc(listeningQueueMetric.createdAt))
    .limit(1);
  const metadata = (row?.metadata ?? {}) as Record<string, any>;
  return {
    traceId: metadata.trace_id ?? null,
    requestId: metadata.request_id ?? null,
    sessionId: metadata.correlation_session_id ?? null,
    sectionId: metadata.section_id ?? null,
  };
};

const shouldDispatchForRule = (rule: string, active: boolean, nowMs: number) => {
  const existing = state.ruleStates.get(rule) ?? {
    open: false,
    lastSentAtMs: 0,
    healthyWindows: 0,
    suppressionUntilMs: 0,
  };

  if (active) {
    existing.healthyWindows = 0;
    const dedupeExpired = nowMs - existing.lastSentAtMs >= DEDUPE_WINDOW_MS;
    const suppressionExpired = nowMs >= existing.suppressionUntilMs;
    const shouldDispatch = !existing.open || (dedupeExpired && suppressionExpired);
    if (shouldDispatch) {
      existing.open = true;
      existing.lastSentAtMs = nowMs;
      existing.suppressionUntilMs = nowMs + SUPPRESSION_WINDOW_MS;
    }
    state.ruleStates.set(rule, existing);
    return shouldDispatch;
  }

  if (existing.open) {
    existing.healthyWindows += 1;
    if (existing.healthyWindows >= AUTO_RESOLVE_HEALTHY_WINDOWS) {
      existing.open = false;
      existing.suppressionUntilMs = 0;
      existing.healthyWindows = 0;
    }
    state.ruleStates.set(rule, existing);
  }
  return false;
};

const dispatchAlert = async (alert: ListeningAlert) => {
  console.error("[ListeningAlert][Triggered]", alert);
  const webhook = process.env.LISTENING_ALERT_WEBHOOK_URL;
  if (!webhook) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(alert),
      signal: controller.signal,
    });
  } catch (error: any) {
    console.error("[ListeningAlert][DispatchError]", {
      rule: alert.rule,
      message: error?.message ?? "dispatch_failed",
    });
  } finally {
    clearTimeout(timeout);
  }
};

const buildAlert = async (params: {
  rule: string;
  severity: AlertSeverity;
  observed: number;
  threshold: number;
  windowMinutes: number;
  topFailingStage: string | null;
  topFailingProvider: string | null;
}): Promise<ListeningAlert> => {
  const nowIso = new Date().toISOString();
  const correlation = await getCorrelationSample();
  return {
    signature: `${params.rule}:${params.severity}`,
    rule: params.rule,
    severity: params.severity,
    observed: Number(params.observed.toFixed(6)),
    threshold: Number(params.threshold.toFixed(6)),
    windowMinutes: params.windowMinutes,
    traceId: correlation.traceId,
    requestId: correlation.requestId,
    sessionId: correlation.sessionId,
    sectionId: correlation.sectionId,
    topFailingStage: params.topFailingStage,
    topFailingProvider: params.topFailingProvider,
    dedupeWindowMinutes: Math.round(DEDUPE_WINDOW_MS / 60_000),
    suppressionWindowMinutes: Math.round(SUPPRESSION_WINDOW_MS / 60_000),
    at: nowIso,
  };
};

const sumTtsFailures = (retrySnapshot: ReturnType<typeof getPrefetchRetryMetricsSnapshot>) => {
  return Object.entries(retrySnapshot.byErrorCode).reduce((sum, [code, count]) => {
    const provider = classifyProviderFromErrorCode(code);
    if (provider === "polly" || provider === "tts" || provider === "openai") {
      return sum + Number(count ?? 0);
    }
    return sum;
  }, 0);
};

export const evaluateListeningAlerts = async () => {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const topFailingStage = await computeTopFailingStage();
  const retrySnapshot = getPrefetchRetryMetricsSnapshot();
  const topFailingProvider = computeTopFailingProvider(retrySnapshot);
  const triggered: ListeningAlert[] = [];

  const publishRows = await db
    .select({
      metadata: listeningQueueMetric.metadata,
    })
    .from(listeningQueueMetric)
    .where(
      and(
        eq(listeningQueueMetric.stepName, "span:published"),
        gte(listeningQueueMetric.createdAt, new Date(nowMs - PUBLISH_WINDOW_MIN * 60_000)),
      ),
    )
    .orderBy(desc(listeningQueueMetric.createdAt))
    .limit(2000);
  const publishTotal = publishRows.length;
  const publishFailures = publishRows.filter((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, any>;
    return metadata.success === false;
  }).length;
  const publishFailureRatio = publishTotal > 0 ? publishFailures / publishTotal : 0;
  if (publishTotal > 0 && publishFailureRatio > 0.05) {
    const shouldDispatch = shouldDispatchForRule("publish_failure_spike", true, nowMs);
    if (shouldDispatch) {
      triggered.push(await buildAlert({
        rule: "publish_failure_spike",
        severity: "critical",
        observed: publishFailureRatio,
        threshold: 0.05,
        windowMinutes: PUBLISH_WINDOW_MIN,
        topFailingStage,
        topFailingProvider,
      }));
    }
  } else {
    shouldDispatchForRule("publish_failure_spike", false, nowMs);
  }

  const dlqRows = await db
    .select({ id: listeningDeadLetter.id })
    .from(listeningDeadLetter)
    .where(
      and(
        isNull(listeningDeadLetter.resolvedAt),
        gte(listeningDeadLetter.createdAt, new Date(nowMs - DLQ_WINDOW_MIN * 60_000)),
      ),
    )
    .limit(5000);
  const unresolvedDlqRecent = dlqRows.length;
  if (unresolvedDlqRecent >= 10) {
    const shouldDispatch = shouldDispatchForRule("dlq_growth_spike", true, nowMs);
    if (shouldDispatch) {
      triggered.push(await buildAlert({
        rule: "dlq_growth_spike",
        severity: "critical",
        observed: unresolvedDlqRecent,
        threshold: 10,
        windowMinutes: DLQ_WINDOW_MIN,
        topFailingStage,
        topFailingProvider,
      }));
    }
  } else {
    shouldDispatchForRule("dlq_growth_spike", false, nowMs);
  }

  const retryBaseline = state.lastRetrySnapshot ?? retrySnapshot;
  const exhaustedDelta = Math.max(0, retrySnapshot.exhausted - retryBaseline.exhausted);
  if (exhaustedDelta >= 5) {
    const shouldDispatch = shouldDispatchForRule("retry_exhaustion_spike", true, nowMs);
    if (shouldDispatch) {
      triggered.push(await buildAlert({
        rule: "retry_exhaustion_spike",
        severity: "high",
        observed: exhaustedDelta,
        threshold: 5,
        windowMinutes: RETRY_WINDOW_MIN,
        topFailingStage,
        topFailingProvider,
      }));
    }
  } else {
    shouldDispatchForRule("retry_exhaustion_spike", false, nowMs);
  }
  state.lastRetrySnapshot = retrySnapshot;

  const ttsFailureCount = sumTtsFailures(retrySnapshot);
  const ttsFailureDelta = Math.max(0, ttsFailureCount - state.lastTtsFailureCount);
  if (ttsFailureDelta >= TTS_FAILURE_THRESHOLD) {
    const shouldDispatch = shouldDispatchForRule("tts_failure_spike", true, nowMs);
    if (shouldDispatch) {
      triggered.push(await buildAlert({
        rule: "tts_failure_spike",
        severity: "high",
        observed: ttsFailureDelta,
        threshold: TTS_FAILURE_THRESHOLD,
        windowMinutes: TTS_WINDOW_MIN,
        topFailingStage,
        topFailingProvider,
      }));
    }
  } else {
    shouldDispatchForRule("tts_failure_spike", false, nowMs);
  }
  state.lastTtsFailureCount = ttsFailureCount;

  const coachRows = await db
    .select({
      progressData: taskProgress.progressData,
    })
    .from(taskProgress)
    .where(
      and(
        eq(taskProgress.skill, "listening"),
        eq(taskProgress.status, "completed"),
        gte(taskProgress.updatedAt, new Date(nowMs - COACH_WINDOW_MIN * 60_000)),
      ),
    )
    .limit(5000);
  const coachTotal = coachRows.length;
  const coachMisses = coachRows.filter((row) => {
    const progressData = (row.progressData ?? {}) as Record<string, any>;
    const coach = (progressData.performanceCoach ?? {}) as Record<string, any>;
    return !coach.latest;
  }).length;
  const coachMissRatio = coachTotal > 0 ? coachMisses / coachTotal : 0;
  if (coachTotal > 0 && coachMissRatio > 0.02) {
    const shouldDispatch = shouldDispatchForRule("coach_analysis_miss", true, nowMs);
    if (shouldDispatch) {
      triggered.push(await buildAlert({
        rule: "coach_analysis_miss",
        severity: "high",
        observed: coachMissRatio,
        threshold: 0.02,
        windowMinutes: COACH_WINDOW_MIN,
        topFailingStage,
        topFailingProvider,
      }));
    }
  } else {
    shouldDispatchForRule("coach_analysis_miss", false, nowMs);
  }

  const latestProbeRows = await listRecentListeningSyntheticProbeRuns({ limit: 50 });
  const latestProbeFailures = latestProbeRows.filter((row) => !row.success).length;
  if (latestProbeFailures > 0) {
    const shouldDispatch = shouldDispatchForRule("synthetic_probe_failure", true, nowMs);
    if (shouldDispatch) {
      triggered.push(await buildAlert({
        rule: "synthetic_probe_failure",
        severity: "high",
        observed: latestProbeFailures,
        threshold: 0,
        windowMinutes: 15,
        topFailingStage:
          latestProbeRows.find((row) => !row.success)?.stage ?? topFailingStage,
        topFailingProvider,
      }));
    }
  } else {
    shouldDispatchForRule("synthetic_probe_failure", false, nowMs);
  }

  for (const alert of triggered) {
    await dispatchAlert(alert);
  }
  state.lastEvaluatedAt = nowIso;

  return {
    generatedAt: nowIso,
    triggered,
  };
};

export const startListeningAlertScheduler = () => {
  if (state.timer) return;
  state.intervalMs = ALERT_INTERVAL_MS;
  state.timer = setInterval(() => {
    void evaluateListeningAlerts().catch((error: any) => {
      console.error("[ListeningAlert][SchedulerError]", {
        message: error?.message ?? "unknown",
      });
    });
  }, ALERT_INTERVAL_MS);
  if (typeof state.timer.unref === "function") {
    state.timer.unref();
  }
};

export const stopListeningAlertScheduler = () => {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
  state.intervalMs = null;
};

export const getListeningAlertEngineSnapshot = () => {
  const activeRules = Array.from(state.ruleStates.entries())
    .filter(([, value]) => value.open)
    .map(([rule, value]) => ({
      rule,
      lastSentAt: value.lastSentAtMs ? new Date(value.lastSentAtMs).toISOString() : null,
      suppressionUntil: value.suppressionUntilMs ? new Date(value.suppressionUntilMs).toISOString() : null,
    }));
  return {
    active: Boolean(state.timer),
    intervalMs: state.intervalMs,
    lastEvaluatedAt: state.lastEvaluatedAt,
    dedupeWindowMinutes: Math.round(DEDUPE_WINDOW_MS / 60_000),
    suppressionWindowMinutes: Math.round(SUPPRESSION_WINDOW_MS / 60_000),
    autoResolveHealthyWindows: AUTO_RESOLVE_HEALTHY_WINDOWS,
    severityTiers: ["warning", "high", "critical"] as const,
    activeRules,
  };
};
