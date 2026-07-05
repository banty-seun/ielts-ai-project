export type ListeningWarmupPhase = 'idle' | 'queued' | 'warming' | 'running' | 'error' | 'ready';

export type ListeningWarmupUiState = 'queued' | 'preparing' | 'retrying' | 'ready_to_start';

export type ListeningWarmupSessionInfo = {
  status: string;
  retryCount: number;
  message: string;
  errorCode?: string | null;
} | null;

export const normalizeListeningWarmupPhase = (value: unknown): ListeningWarmupPhase => {
  if (
    value === 'idle' ||
    value === 'queued' ||
    value === 'warming' ||
    value === 'running' ||
    value === 'error' ||
    value === 'ready'
  ) {
    return value;
  }
  return 'queued';
};

export const deriveListeningWarmupUiState = (params: {
  ready?: boolean;
  phase?: ListeningWarmupPhase | string | null;
  sessionInfo?: ListeningWarmupSessionInfo;
}) : ListeningWarmupUiState => {
  if (params.ready || params.phase === 'ready') {
    return 'ready_to_start';
  }
  if (params.phase === 'error' || String(params.sessionInfo?.status ?? '').toLowerCase() === 'error') {
    return 'retrying';
  }
  if (params.phase === 'queued' || params.phase === 'idle') {
    return 'queued';
  }
  return 'preparing';
};

export const formatListeningWarmupEta = (etaSecs?: number | null) => {
  if (typeof etaSecs !== 'number' || !Number.isFinite(etaSecs) || etaSecs <= 0) {
    return 'ETA unavailable';
  }
  if (etaSecs < 60) {
    return `~${Math.round(etaSecs)}s`;
  }
  const mins = Math.round(etaSecs / 60);
  return `~${mins} min`;
};

export const formatListeningWarmupLastUpdated = (iso?: string | null) => {
  if (!iso) return 'Awaiting first status update';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Status updated recently';
  const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaSec < 5) return 'Updated just now';
  if (deltaSec < 60) return `Updated ${deltaSec}s ago`;
  const mins = Math.floor(deltaSec / 60);
  const secs = deltaSec % 60;
  return `Updated ${mins}m ${secs}s ago`;
};

export const getListeningWarmupGuidance = (uiState: ListeningWarmupUiState) => {
  if (uiState === 'ready_to_start') {
    return 'Part 1 is ready. You can start immediately.';
  }
  if (uiState === 'retrying') {
    return "We're still preparing in the background. You can leave and come back later without losing time.";
  }
  return "We'll keep preparing in the background. You can leave and come back later without losing time.";
};
