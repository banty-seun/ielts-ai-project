import type { TaskProgress as TaskProgressRecord } from "@shared/schema";
import { DEFAULT_SESSION_MINUTES } from "../../shared/constants";

type TaskLike = Pick<TaskProgressRecord, "duration" | "progressData"> & {
  progressData?: unknown;
  duration?: number | null;
  durationMinutes?: number | null;
};

const normalizeMinutes = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  // Values greater than 300 are almost always seconds; convert down.
  if (parsed > 300) {
    return Math.round(parsed / 60);
  }

  return Math.round(parsed);
};

export const resolveSessionMinutesFromTask = (
  task?: TaskLike | null,
  fallbackMinutes: number = DEFAULT_SESSION_MINUTES,
): number => {
  if (!task) {
    return fallbackMinutes;
  }

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const fromProgress = normalizeMinutes(progressData.sessionDurationMinutes);
  if (fromProgress) {
    return fromProgress;
  }

  const fromPrefetch = normalizeMinutes(progressData.sessionPrefetch?.sessionMinutes);
  if (fromPrefetch) {
    return fromPrefetch;
  }

  const fromPlanMinutes = normalizeMinutes(task.durationMinutes);
  if (fromPlanMinutes) {
    return fromPlanMinutes;
  }

  const fromTaskField = normalizeMinutes(task.duration);
  if (fromTaskField) {
    return fromTaskField;
  }

  return fallbackMinutes;
};
