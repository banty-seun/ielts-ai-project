/**
 * Centralized Retry Strategy for Prefetch Operations
 *
 * This module provides a unified retry mechanism for all prefetch jobs across different skills.
 * It handles:
 * - Exponential backoff with jitter
 * - Retry limit enforcement
 * - Structured logging for observability
 * - Future extension points for circuit breakers and dead-letter queues
 */

const PREFETCH_RETRY_DELAYS = [5_000, 30_000, 120_000]; // 5s, 30s, 2min

export interface RetryContext {
  taskId: string;
  userId: string;
  batchId: string;
  errorCode?: string;
  currentRetryCount: number;
  skillType?: 'listening' | 'reading' | 'writing' | 'speaking';
  traceId?: string;
  correlationId?: string;
  stage?: string;
}

const retryMetrics = {
  scheduled: 0,
  executed: 0,
  failed: 0,
  exhausted: 0,
  byErrorCode: {} as Record<string, number>,
  byStage: {} as Record<string, number>,
  updatedAt: new Date().toISOString(),
};

const incrementMetric = (key: keyof typeof retryMetrics, value = 1) => {
  if (typeof retryMetrics[key] === "number") {
    (retryMetrics[key] as number) += value;
  }
  retryMetrics.updatedAt = new Date().toISOString();
};

const incrementMapMetric = (target: Record<string, number>, key: string) => {
  target[key] = (target[key] ?? 0) + 1;
  retryMetrics.updatedAt = new Date().toISOString();
};

/**
 * Central retry policy for prefetch jobs
 *
 * @param context - Retry context including taskId, userId, batchId, and error details
 * @param prefetchFn - The prefetch function to retry (e.g., ensureListeningSessionPrefetch)
 * @returns Promise<boolean> - true if retry was scheduled, false if retry limit exceeded
 */
export async function retryPrefetchJob(
  context: RetryContext,
  prefetchFn: (taskId: string, userId: string) => Promise<void>
): Promise<boolean> {
  const { taskId, userId, batchId, errorCode, currentRetryCount, skillType = 'listening' } = context;
  const stage = context.stage ?? "unknown_stage";
  const traceId = context.traceId ?? `trc_retry_${batchId}`;
  const correlationId = context.correlationId ?? batchId;

  // Central retry policy
  const maxRetries = PREFETCH_RETRY_DELAYS.length;
  if (currentRetryCount >= maxRetries) {
    incrementMetric("exhausted");
    incrementMapMetric(retryMetrics.byStage, stage);
    if (errorCode) incrementMapMetric(retryMetrics.byErrorCode, errorCode);
    console.error('[Retry][Exhausted]', {
      batchId,
      taskId,
      userId,
      skillType,
      errorCode,
      attempts: currentRetryCount,
      traceId,
      correlationId,
      stage,
    });
    return false;
  }

  // Exponential backoff with jitter to prevent thundering herd
  const delay = PREFETCH_RETRY_DELAYS[currentRetryCount];
  const jitter = Math.floor(Math.random() * 1000); // 0-1000ms jitter
  const totalDelay = delay + jitter;

  console.log('[Retry][Scheduled]', {
    batchId,
    taskId,
    userId,
    skillType,
    attempt: currentRetryCount + 1,
    maxAttempts: maxRetries,
    delayMs: totalDelay,
    errorCode,
    traceId,
    correlationId,
    stage,
  });
  incrementMetric("scheduled");
  incrementMapMetric(retryMetrics.byStage, stage);
  if (errorCode) incrementMapMetric(retryMetrics.byErrorCode, errorCode);

  // Schedule retry with delay
  setTimeout(() => {
    incrementMetric("executed");
    console.log('[Retry][Executing]', {
      batchId,
      taskId,
      userId,
      skillType,
      attempt: currentRetryCount + 1,
      traceId,
      correlationId,
      stage,
    });

    prefetchFn(taskId, userId).catch((err) => {
      incrementMetric("failed");
      if (err?.code) incrementMapMetric(retryMetrics.byErrorCode, String(err.code));
      console.error('[Retry][Failed]', {
        batchId,
        taskId,
        userId,
        skillType,
        attempt: currentRetryCount + 1,
        error: err?.message,
        errorCode: err?.code,
        traceId,
        correlationId,
        stage,
      });
    });
  }, totalDelay);

  return true;
}

/**
 * Check if a specific error code should trigger a retry
 *
 * This can be extended to implement circuit breaker patterns:
 * - Skip retries for auth errors (POLLY_AUTH, OPENAI_AUTH)
 * - Skip retries for quota exhaustion
 * - Retry transient network errors
 */
export function shouldRetryError(errorCode?: string): boolean {
  const nonRetryableErrors = [
    'POLLY_AUTH', // AWS credentials missing
    'OPENAI_AUTH', // OpenAI API key missing
    'QUOTA_EXHAUSTED', // User quota exceeded
  ];

  if (!errorCode) return true; // Unknown errors are retryable

  return !nonRetryableErrors.includes(errorCode);
}

/**
 * Get the retry delay for a given attempt count
 * Useful for displaying ETA to users
 */
export function getRetryDelay(attemptCount: number): number {
  const index = Math.min(attemptCount, PREFETCH_RETRY_DELAYS.length - 1);
  return PREFETCH_RETRY_DELAYS[index];
}

/**
 * Calculate total time until all retries are exhausted
 * Useful for dead-letter queue timeouts
 */
export function getTotalRetryTime(): number {
  return PREFETCH_RETRY_DELAYS.reduce((sum, delay) => sum + delay, 0);
}

export function getPrefetchRetryMetricsSnapshot() {
  return {
    scheduled: retryMetrics.scheduled,
    executed: retryMetrics.executed,
    failed: retryMetrics.failed,
    exhausted: retryMetrics.exhausted,
    byErrorCode: { ...retryMetrics.byErrorCode },
    byStage: { ...retryMetrics.byStage },
    updatedAt: retryMetrics.updatedAt,
  };
}

export function resetPrefetchRetryMetrics() {
  retryMetrics.scheduled = 0;
  retryMetrics.executed = 0;
  retryMetrics.failed = 0;
  retryMetrics.exhausted = 0;
  retryMetrics.byErrorCode = {};
  retryMetrics.byStage = {};
  retryMetrics.updatedAt = new Date().toISOString();
}
