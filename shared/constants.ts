export const DEFAULT_SESSION_MINUTES = 20;
export const LISTENING_SESSION_MINUTES = 30;
export const NEXT_MIN_MS = 6 * 60_000; // 6 minutes (single audio segment)
export const SESSION_START_KEY = (userId: string, ymd: string, scope?: string) =>
  `session:start:${userId}:${scope ? `${scope}:` : ''}${ymd}`;

export const IELTS_PARTS = [1, 2, 3, 4] as const;
export const LISTENING_SEGMENT_TYPES = ['dialogue', 'service', 'academic', 'monologue'] as const;

export type Accent = 'British' | 'Canadian' | 'Australian' | 'American' | 'NewZealand';
export const DEFAULT_ACCENT: Accent = 'British';
export const ACCENT_TO_TTS_VOICE: Record<Accent, string> = {
  British: 'Amy',
  Canadian: 'Joanna',
  Australian: 'Olivia',
  American: 'Matthew',
  NewZealand: 'Aria',
};

/**
 * Helper: Convert milliseconds to MM:SS format
 */
export const msToMMSS = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
};
