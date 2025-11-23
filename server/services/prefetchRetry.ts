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
}

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

  // Central retry policy
  const maxRetries = PREFETCH_RETRY_DELAYS.length;
  if (currentRetryCount >= maxRetries) {
    console.error('[Retry][Exhausted]', {
      batchId,
      taskId,
      userId,
      skillType,
      errorCode,
      attempts: currentRetryCount,
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
  });

  // Schedule retry with delay
  setTimeout(() => {
    console.log('[Retry][Executing]', {
      batchId,
      taskId,
      userId,
      skillType,
      attempt: currentRetryCount + 1,
    });

    prefetchFn(taskId, userId).catch((err) => {
      console.error('[Retry][Failed]', {
        batchId,
        taskId,
        userId,
        skillType,
        attempt: currentRetryCount + 1,
        error: err?.message,
        errorCode: err?.code,
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
