import type { TaskProgress as TaskProgressRecord } from "@shared/schema";
import { LISTENING_SESSION_MINUTES, DEFAULT_ACCENT } from "../../shared/constants";
import { normalizeAccent } from "../utils/audio.ts";
import { ensureListeningSegments } from "./taskFactory";
import { resolveSessionMinutesFromTask } from "./sessionDuration";
import { storage } from "../storage";

const LISTENING_SKILL = "listening";

type MaybeTask = TaskProgressRecord | null | undefined;

const needsSegmentBackfill = (segments: any[]): boolean => {
  if (segments.length !== 4) {
    return true;
  }
  return segments.some(
    (segment) =>
      !segment ||
      typeof segment.estimatedDurationSec !== "number" ||
      !segment.accent ||
      !segment.voiceId,
  );
};

export const ensureSegmentsForTaskProgress = async <T extends MaybeTask>(
  task: T,
): Promise<T> => {
  if (!task || (task.skill && task.skill !== LISTENING_SKILL)) {
    return task;
  }

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const existingSegments = Array.isArray(progressData.segments) ? progressData.segments : [];

  if (!needsSegmentBackfill(existingSegments)) {
    return task;
  }

  const minutes = resolveSessionMinutesFromTask(task, LISTENING_SESSION_MINUTES);
  const accentCandidate =
    progressData.accent ??
    existingSegments.find((seg) => typeof seg?.accent === "string")?.accent ??
    task.accent ??
    DEFAULT_ACCENT;

  const enrichedSegments = ensureListeningSegments(existingSegments, minutes, {
    baseTitle: task.taskTitle,
    accent: normalizeAccent(accentCandidate),
  });

  const updatedProgressData = {
    ...progressData,
    sessionDurationMinutes: minutes,
    segments: enrichedSegments,
  };

  await storage.updateTaskProgress(task.id, {
    duration: minutes,
    progressData: updatedProgressData,
  });

  task.progressData = updatedProgressData;
  task.duration = minutes;
  task.accent = task.accent ?? normalizeAccent(accentCandidate);

  return task;
};

export const ensureSegmentsForTasks = async (
  tasks: TaskProgressRecord[],
): Promise<TaskProgressRecord[]> => {
  const ensured: TaskProgressRecord[] = [];
  for (const task of tasks) {
    ensured.push((await ensureSegmentsForTaskProgress(task)) as TaskProgressRecord);
  }
  return ensured;
};
