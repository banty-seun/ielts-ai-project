import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseSessionTimerOptions {
  /**
   * Total duration in milliseconds
   */
  duration: number;
  /**
   * Whether the timer should be running
   */
  isRunning: boolean;
  /**
   * Callback when timer completes
   */
  onComplete?: () => void;
  /**
   * How often to update (in ms). Lower = more accurate but more CPU.
   * Default: 100ms
   */
  updateInterval?: number;
}

export interface UseSessionTimerResult {
  /**
   * Elapsed time in milliseconds
   */
  elapsed: number;
  /**
   * Remaining time in milliseconds
   */
  remaining: number;
  /**
   * Progress as a decimal (0.0 to 1.0)
   */
  progress: number;
  /**
   * Whether the timer has completed
   */
  isComplete: boolean;
  /**
   * Reset the timer to zero
   */
  reset: () => void;
}

/**
 * A drift-resistant timer hook for session management.
 *
 * Uses performance.now() and tracks the actual start time to prevent
 * accumulated drift from setInterval delays.
 *
 * @example
 * const { elapsed, remaining, progress } = useSessionTimer({
 *   duration: 60000, // 60 seconds
 *   isRunning: true,
 *   onComplete: () => console.log('Done!')
 * });
 */
export function useSessionTimer({
  duration,
  isRunning,
  onComplete,
  updateInterval = 100,
}: UseSessionTimerOptions): UseSessionTimerResult {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  const reset = useCallback(() => {
    setElapsed(0);
    accumulatedRef.current = 0;
    startTimeRef.current = null;
    completedRef.current = false;
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isRunning) {
      // Resume: capture the current time as start, accounting for accumulated time
      if (startTimeRef.current === null) {
        startTimeRef.current = performance.now();
      }

      // Clear any existing interval
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = window.setInterval(() => {
        if (startTimeRef.current === null) return;

        const now = performance.now();
        const actualElapsed = now - startTimeRef.current;
        const totalElapsed = accumulatedRef.current + actualElapsed;

        if (totalElapsed >= duration) {
          // Timer complete
          setElapsed(duration);
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          if (!completedRef.current && onComplete) {
            completedRef.current = true;
            onComplete();
          }
        } else {
          setElapsed(totalElapsed);
        }
      }, updateInterval);
    } else {
      // Paused: accumulate elapsed time and clear the interval
      if (startTimeRef.current !== null) {
        const now = performance.now();
        const actualElapsed = now - startTimeRef.current;
        accumulatedRef.current += actualElapsed;
        startTimeRef.current = null;
      }

      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, duration, onComplete, updateInterval]);

  const remaining = Math.max(0, duration - elapsed);
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const isComplete = elapsed >= duration;

  return {
    elapsed,
    remaining,
    progress,
    isComplete,
    reset,
  };
}
