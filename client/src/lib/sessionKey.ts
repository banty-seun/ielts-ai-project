import { SESSION_START_KEY } from '@shared/constants';

export const makeSessionKey = (userId: string, ymd: string, progressId: string) =>
  SESSION_START_KEY(userId, ymd, progressId);

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
