import { useState, useEffect, useCallback, useRef } from 'react';
import { SessionState, SessionStatus, AdvisorFeedback } from '../../../shared/schema';
import { useSessionTimer } from './useSessionTimer';

interface UseListeningSessionOptions {
  /**
   * Task progress ID
   */
  taskId: string;
  /**
   * Initial session state from server
   */
  initialState: SessionState;
  /**
   * Callback when session completes naturally
   */
  onComplete?: () => void;
  /**
   * Callback when session expires (time runs out)
   */
  onExpire?: () => void;
  /**
   * Auto-sync interval in ms (default: 30s)
   */
  syncIntervalMs?: number;
}

interface UseListeningSessionResult {
  // Session state
  sessionState: SessionState;
  isRunning: boolean;
  isPaused: boolean;
  isComplete: boolean;

  // Timer info
  elapsed: number;
  remaining: number;
  progress: number;

  // Actions
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  submitAudio: (answers: any[], audioIndex: number) => Promise<{ feedback?: AdvisorFeedback; nextAudio?: any }>;

  // Auto-advance
  canAutoAdvance: boolean;
  requestNextAudio: () => Promise<{
    ok: boolean;
    audio?: any;
    progressId?: string;
    phase?: string;
    reason?: string;
    startupGateMode?: string;
  }>;

  // Error state
  error: string | null;
}

/**
 * Comprehensive hook for managing a listening practice session.
 *
 * Handles:
 * - Session timing with drift prevention
 * - Pause/resume with server sync
 * - Auto-advance to next audio
 * - Session completion/expiry
 * - AI advisor feedback
 */
export function useListeningSession({
  taskId,
  initialState,
  onComplete,
  onExpire,
  syncIntervalMs = 30000,
}: UseListeningSessionOptions): UseListeningSessionResult {
  const [sessionState, setSessionState] = useState<SessionState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const lastSyncRef = useRef<number>(Date.now());

  // Determine if session is running
  const isRunning = sessionState.status === 'running';
  const isPaused = sessionState.status === 'paused';
  const isComplete = sessionState.status === 'completed' || sessionState.status === 'expired';

  // Use session timer for drift-free timing
  const { elapsed, remaining, progress } = useSessionTimer({
    duration: sessionState.durationMinutes * 60 * 1000,
    isRunning,
    onComplete: () => {
      // Time expired - mark session as expired
      handleExpiry();
    },
  });

  /**
   * Sync with server
   */
  const syncWithServer = useCallback(async (consumedMs: number, status: SessionStatus) => {
    try {
      const response = await fetch('/api/session/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          consumedMs,
          status,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to sync with server');
      }

      const data = await response.json();

      if (data.success && data.sessionState) {
        setSessionState(data.sessionState);
        lastSyncRef.current = Date.now();
      }
    } catch (err: any) {
      console.error('[useListeningSession] Sync error:', err);
      setError(err.message || 'Failed to sync session');
    }
  }, [taskId]);

  /**
   * Pause the session
   */
  const pause = useCallback(async () => {
    if (!isRunning) return;

    const consumedMs = sessionState.consumedMs + elapsed;
    await syncWithServer(consumedMs, 'paused');
  }, [isRunning, elapsed, sessionState.consumedMs, syncWithServer]);

  /**
   * Resume the session
   */
  const resume = useCallback(async () => {
    if (!isPaused) return;

    await syncWithServer(sessionState.consumedMs, 'running');
  }, [isPaused, sessionState.consumedMs, syncWithServer]);

  /**
   * Handle session expiry (time runs out)
   */
  const handleExpiry = useCallback(async () => {
    const consumedMs = sessionState.durationMinutes * 60 * 1000; // Full duration
    await syncWithServer(consumedMs, 'expired');

    if (onExpire) {
      onExpire();
    }
  }, [sessionState.durationMinutes, syncWithServer, onExpire]);

  /**
   * Submit audio answers and get feedback
   */
  const submitAudio = useCallback(async (answers: any[], audioIndex: number) => {
    try {
      // Get AI feedback
      const feedbackResponse = await fetch('/api/session/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioIndex,
          questions: answers,
        }),
      });

      if (!feedbackResponse.ok) {
        throw new Error('Failed to get advisor feedback');
      }

      const feedback: AdvisorFeedback = await feedbackResponse.json();

      // Move to next audio
      const nextAudioIndex = audioIndex + 1;
      if (sessionState.prefetchedAudios && nextAudioIndex < sessionState.prefetchedAudios.length) {
        // Next audio is already prefetched
        setSessionState(prev => ({
          ...prev,
          currentAudioIndex: nextAudioIndex,
        }));

        return {
          feedback,
          nextAudio: sessionState.prefetchedAudios[nextAudioIndex],
        };
      } else {
        // No more prefetched audios - session might be complete or need top-up
        const consumedMs = sessionState.consumedMs + elapsed;
        const remainingMs = (sessionState.durationMinutes * 60 * 1000) - consumedMs;

        if (remainingMs <= 0) {
          // Session complete
          await syncWithServer(consumedMs, 'completed');
          if (onComplete) {
            onComplete();
          }
        }

        return { feedback };
      }
    } catch (err: any) {
      console.error('[useListeningSession] Submit error:', err);
      setError(err.message || 'Failed to submit audio');
      return {};
    }
  }, [sessionState, elapsed, syncWithServer, onComplete]);

  /**
   * Request next audio (top-up generation)
   */
  const requestNextAudio = useCallback(async () => {
    try {
      const maxStatusPollAttempts = 4;
      for (let attempt = 0; attempt < maxStatusPollAttempts; attempt += 1) {
        try {
          const statusResponse = await fetch(`/api/session/next-part-status/${encodeURIComponent(taskId)}`);
          if (!statusResponse.ok) {
            throw new Error(`Failed to load next-part status (${statusResponse.status})`);
          }
          const statusData = await statusResponse.json();

          if (statusData?.status === 'ready' && statusData?.progressId) {
            return {
              ok: true,
              progressId: statusData.progressId,
              phase: statusData.phase,
              startupGateMode: statusData.startup_gate_mode,
            };
          }

          if (statusData?.status === 'none' && statusData?.final) {
            return {
              ok: false,
              reason: 'final',
              phase: statusData.phase,
              startupGateMode: statusData.startup_gate_mode,
            };
          }

          // Back off when next part is still warming/queued/error and try fallback create later.
          if (statusData?.status === 'warming' || statusData?.status === 'queued' || statusData?.status === 'error') {
            const delay = Math.min(12000, 1000 * (2 ** attempt));
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        } catch (_statusError) {
          const delay = Math.min(12000, 1000 * (2 ** attempt));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const response = await fetch('/api/session/next-listening-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progressId: taskId,
          taskId,
          remainingMs: remaining,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to request next section');
      }

      const data = await response.json();

      if (data.ok && data.audio) {
        setSessionState(prev => ({
          ...prev,
          prefetchedAudios: [...(prev.prefetchedAudios || []), data.audio],
        }));
        return {
          ok: true,
          audio: data.audio,
          phase: data.phase,
          startupGateMode: data.startup_gate_mode,
        };
      }

      if (data.ok && data.progressId) {
        return {
          ok: true,
          progressId: data.progressId,
          phase: data.phase,
          startupGateMode: data.startup_gate_mode,
        };
      }

      return {
        ok: false,
        reason: data.reason || 'Unknown error',
        phase: data.phase,
        startupGateMode: data.startup_gate_mode,
      };
    } catch (err: any) {
      console.error('[useListeningSession] Request next audio error:', err);
      setError(err.message || 'Failed to request next audio');
      return { ok: false, reason: err.message };
    }
  }, [taskId, remaining]);

  /**
   * Can we auto-advance to next audio?
   */
  const canAutoAdvance = remaining > 5 * 60 * 1000; // Need at least 5 minutes remaining

  /**
   * Auto-sync with server periodically
   */
  useEffect(() => {
    if (!isRunning) {
      if (syncTimerRef.current !== null) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      return;
    }

    // Set up periodic sync
    syncTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const timeSinceSync = now - lastSyncRef.current;

      if (timeSinceSync >= syncIntervalMs) {
        const consumedMs = sessionState.consumedMs + elapsed;
        syncWithServer(consumedMs, 'running');
      }
    }, syncIntervalMs);

    return () => {
      if (syncTimerRef.current !== null) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [isRunning, syncIntervalMs, elapsed, sessionState.consumedMs, syncWithServer]);

  /**
   * Cleanup on unmount - sync one last time if running
   */
  useEffect(() => {
    return () => {
      if (isRunning) {
        const consumedMs = sessionState.consumedMs + elapsed;
        syncWithServer(consumedMs, 'paused');
      }
    };
  }, []); // Only run on unmount

  return {
    sessionState,
    isRunning,
    isPaused,
    isComplete,
    elapsed,
    remaining,
    progress,
    pause,
    resume,
    submitAudio,
    canAutoAdvance,
    requestNextAudio,
    error,
  };
}
