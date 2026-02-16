import { shouldRetryError as shouldRetryPrefetchError } from "./prefetchRetry";

export type ListeningStepName = "script" | "questions" | "tts" | "validation" | "publish" | "bootstrap" | "build_requested";
export type RetryDisposition = "retryable" | "non_retryable";

const STEP_BASE_DELAYS_MS: Record<ListeningStepName, number[]> = {
  script: [3_000, 10_000, 30_000],
  questions: [3_000, 10_000, 30_000],
  tts: [5_000, 30_000, 120_000],
  validation: [2_000, 8_000, 20_000],
  publish: [2_000, 8_000, 20_000],
  bootstrap: [2_000, 8_000, 20_000],
  build_requested: [2_000, 8_000, 20_000],
};

const NON_RETRYABLE_CODES = new Set(["AUTH_ERROR", "SCHEMA_INVALID", "POLLY_AUTH", "OPENAI_AUTH", "QUOTA_EXHAUSTED"]);

export const canonicalizeListeningErrorCode = (error: unknown): string => {
  const rawCode = typeof (error as any)?.code === "string" ? (error as any).code : "";
  if (rawCode) return rawCode;
  const message = String((error as any)?.message ?? "").toUpperCase();
  if (message.includes("TIMEOUT")) return "TTS_TIMEOUT";
  if (message.includes("SCHEMA")) return "SCHEMA_INVALID";
  if (message.includes("AUTH")) return "AUTH_ERROR";
  return "UNKNOWN";
};

export const classifyListeningRetry = (params: {
  step: ListeningStepName;
  errorCode?: string;
}): { disposition: RetryDisposition; errorCode: string } => {
  const errorCode = params.errorCode ?? "UNKNOWN";
  if (NON_RETRYABLE_CODES.has(errorCode)) {
    return { disposition: "non_retryable", errorCode };
  }
  if (!shouldRetryPrefetchError(errorCode)) {
    return { disposition: "non_retryable", errorCode };
  }
  return { disposition: "retryable", errorCode };
};

export const getListeningRetryDelayMs = (step: ListeningStepName, attempt: number): number => {
  const delays = STEP_BASE_DELAYS_MS[step];
  const index = Math.max(0, Math.min(attempt, delays.length - 1));
  return delays[index];
};
