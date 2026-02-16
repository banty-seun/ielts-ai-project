export type RendererMode = "legacy" | "dual";

export interface RendererTelemetryBucket {
  events: number;
  error_events: number;
  unsupported_engine_events: number;
  completion_attempts: number;
  completed_sessions: number;
}

export interface RendererTelemetryState {
  version: string;
  by_mode: Record<RendererMode, RendererTelemetryBucket>;
  events: Array<{
    at: string;
    task_progress_id: string | null;
    mode: RendererMode;
    event_type: string;
    error: boolean;
    details: Record<string, any> | null;
  }>;
}

const BASE_BUCKET: RendererTelemetryBucket = {
  events: 0,
  error_events: 0,
  unsupported_engine_events: 0,
  completion_attempts: 0,
  completed_sessions: 0,
};

export const normalizeRendererMode = (value: unknown): RendererMode => (value === "dual" ? "dual" : "legacy");

export const ensureRendererTelemetry = (progressData: Record<string, any>): RendererTelemetryState => {
  const current = (progressData.rendererTelemetry ?? {}) as Record<string, any>;
  const byMode = (current.by_mode ?? {}) as Record<string, any>;
  return {
    version: "1.0.0",
    by_mode: {
      legacy: { ...BASE_BUCKET, ...(byMode.legacy ?? {}) },
      dual: { ...BASE_BUCKET, ...(byMode.dual ?? {}) },
    },
    events: Array.isArray(current.events) ? current.events : [],
  };
};

export const applyRendererTelemetryUpdate = (
  progressData: Record<string, any>,
  update: {
    mode: RendererMode;
    eventType?: string;
    error?: boolean;
    completionAttempt?: boolean;
    completed?: boolean;
    taskProgressId?: string;
    details?: Record<string, any>;
  },
) => {
  const telemetry = ensureRendererTelemetry(progressData);
  const bucket = telemetry.by_mode[update.mode];
  if (update.eventType) {
    bucket.events += 1;
    if (update.error) {
      bucket.error_events += 1;
    }
    if (update.eventType === "unsupported_engine_block") {
      bucket.unsupported_engine_events += 1;
    }
    telemetry.events.push({
      at: new Date().toISOString(),
      task_progress_id: update.taskProgressId ?? null,
      mode: update.mode,
      event_type: update.eventType,
      error: Boolean(update.error),
      details: update.details ?? null,
    });
    telemetry.events = telemetry.events.slice(-200);
  }
  if (update.completionAttempt) {
    bucket.completion_attempts += 1;
  }
  if (update.completed) {
    bucket.completed_sessions += 1;
  }
  return {
    ...progressData,
    rendererTelemetry: telemetry,
  };
};

export const summarizeRendererTelemetry = (
  states: Array<Record<string, any>>,
): {
  legacy: RendererTelemetryBucket & { error_rate: number; completion_rate: number };
  dual: RendererTelemetryBucket & { error_rate: number; completion_rate: number };
  deltas: { error_rate: number; completion_rate: number };
} => {
  const aggregate: Record<RendererMode, RendererTelemetryBucket> = {
    legacy: { ...BASE_BUCKET },
    dual: { ...BASE_BUCKET },
  };

  states.forEach((state) => {
    const telemetry = ensureRendererTelemetry(state);
    (["legacy", "dual"] as const).forEach((mode) => {
      const source = telemetry.by_mode?.[mode] ?? BASE_BUCKET;
      aggregate[mode].events += Number(source.events ?? 0);
      aggregate[mode].error_events += Number(source.error_events ?? 0);
      aggregate[mode].unsupported_engine_events += Number(source.unsupported_engine_events ?? 0);
      aggregate[mode].completion_attempts += Number(source.completion_attempts ?? 0);
      aggregate[mode].completed_sessions += Number(source.completed_sessions ?? 0);
    });
  });

  const roundRate = (value: number) => Number(value.toFixed(6));
  const withRates = (bucket: RendererTelemetryBucket) => ({
    ...bucket,
    error_rate: roundRate(bucket.events > 0 ? bucket.error_events / bucket.events : 0),
    completion_rate: roundRate(
      bucket.completion_attempts > 0 ? bucket.completed_sessions / bucket.completion_attempts : 0,
    ),
  });

  const legacy = withRates(aggregate.legacy);
  const dual = withRates(aggregate.dual);
  return {
    legacy,
    dual,
    deltas: {
      error_rate: roundRate(dual.error_rate - legacy.error_rate),
      completion_rate: roundRate(dual.completion_rate - legacy.completion_rate),
    },
  };
};
