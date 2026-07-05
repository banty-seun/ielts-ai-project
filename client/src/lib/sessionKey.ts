import { SESSION_START_KEY } from '@shared/constants';

export const makeSessionKey = (userId: string, ymd: string, progressId: string) =>
  SESSION_START_KEY(userId, ymd, progressId);

// Explicit client-side runtime entry states for Roadmap G startup semantics.
// `warming_up` and `ready_not_started` must never consume countdown time.
export type ListeningRuntimeEntryState = 'warming_up' | 'ready_not_started' | 'started' | 'paused';

export const readSessionStart = (key: string): number | null => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(key);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const clearSessionStart = (key: string): void => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  window.localStorage.removeItem(key);
};

// Canonical owner for client countdown start persistence. Call this only when the
// user actually enters a playable session state (e.g. first audio play action).
export const markSessionStarted = (
  userId: string,
  progressId: string,
  options?: { ymd?: string; nowMs?: number },
): { key: string; startMs: number } | null => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  if (!userId || !progressId) {
    return null;
  }
  const ymd = options?.ymd ?? new Date().toISOString().split('T')[0];
  if (!ymd) {
    return null;
  }
  const key = makeSessionKey(userId, ymd, progressId);
  const existing = readSessionStart(key);
  if (existing) {
    return { key, startMs: existing };
  }
  const startMs = Math.max(1, Math.round(options?.nowMs ?? Date.now()));
  window.localStorage.setItem(key, String(startMs));
  return { key, startMs };
};

// Be resilient to midnight rollovers/timezones.
// Try today & yesterday keys; then scan localStorage for any session key ending with :progressId
export function findSessionStartKey(userId: string, progressId: string): { key: string; startMs: number } | null {
  if (typeof window === 'undefined') return null;
  const ls = window.localStorage;
  const iso = (d: Date) => d.toISOString().split('T')[0];
  const today = new Date();
  const ymds = [iso(today), iso(new Date(today.getTime() - 24 * 60 * 60 * 1000))];

  for (const ymd of ymds) {
    const key = makeSessionKey(userId, ymd, progressId);
    const raw = ls.getItem(key);
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return { key, startMs: n };
  }

  const prefix = `session:start:${userId}:`;
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i) ?? '';
    if (k.startsWith(prefix) && k.endsWith(`:${progressId}`)) {
      const n = Number(ls.getItem(k));
      if (Number.isFinite(n) && n > 0) return { key: k, startMs: n };
    }
  }
  return null;
}
