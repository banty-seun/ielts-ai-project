export const DEFAULT_SESSION_MINUTES = 20;
export const NEXT_MIN_MS = 5 * 60_000; // 5 minutes
export const SESSION_START_KEY = (userId: string, ymd: string) => `session:start:${userId}:${ymd}`;

/**
 * Helper: Convert milliseconds to MM:SS format
 */
export const msToMMSS = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
};