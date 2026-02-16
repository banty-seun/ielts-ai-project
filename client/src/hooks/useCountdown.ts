import { useEffect, useRef } from "react";

interface CountdownOpts {
  progressId?: string | number | null;
  totalMs: number;
  startMs: number | null;
  paused?: boolean;
  onChange?: (remaining: number) => void;
}

export function useCountdownTimer({
  progressId = null,
  totalMs,
  startMs,
  paused = false,
  onChange,
}: CountdownOpts): void {
  const rafId = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);
  const prevRemainingRef = useRef<number>(-1);
  const lastLoggedSecondRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    const prev = pausedRef.current;
    pausedRef.current = paused;
    if (prev !== paused && startMsRef.current) {
      console.log(`[COUNTDOWN] ${paused ? "pause" : "resume"}`, {
        progressId,
        totalMs,
        startMs: startMsRef.current,
        remainingMs: Math.max(0, prevRemainingRef.current),
      });
    }
  }, [paused, progressId, totalMs]);

  useEffect(() => {
    if (startMs == null || !Number.isFinite(startMs) || totalMs <= 0) {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      return;
    }

    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }

    startMsRef.current = startMs;
    prevRemainingRef.current = -1;
    lastLoggedSecondRef.current = null;
    let running = true;

    const loop = () => {
      if (!running) return;

      if (pausedRef.current) {
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      const elapsed = Date.now() - startMsRef.current;
      const next = Math.max(0, totalMs - elapsed);

      if (next !== prevRemainingRef.current) {
        onChange?.(next);
        prevRemainingRef.current = next;
      }

      const nextSecond = Math.floor(next / 1000);
      if (lastLoggedSecondRef.current !== nextSecond) {
        console.log("[COUNTDOWN] tick", {
          progressId,
          totalMs,
          startMs: startMsRef.current,
          remainingMs: next,
        });
        lastLoggedSecondRef.current = nextSecond;
      }

      rafId.current = requestAnimationFrame(loop);
    };

    console.log("[COUNTDOWN] init", {
      progressId,
      totalMs,
      startMs,
      remainingMs: Math.max(0, totalMs - (Date.now() - startMs)),
    });

    rafId.current = requestAnimationFrame(loop);

    const onVisibility = () => {
      lastLoggedSecondRef.current = null;
      prevRemainingRef.current = -1;
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [progressId, totalMs, startMs, onChange]);

  useEffect(() => {
    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, []);
}
