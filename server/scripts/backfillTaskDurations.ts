/**
 * Backfill Script: Normalize Task Durations
 *
 * This script updates existing tasks in the database to use the normalized duration structure:
 * - Sets `durationMinutes` based on weekday/weekend preference
 * - Sets `duration` as a string label (e.g., "60 min")
 * - Moves `estimatedDurationSec` into the `audio` nested object within progressData
 * - Preserves existing audio generation metadata
 *
 * Usage:
 *   tsx server/scripts/backfillTaskDurations.ts [--dry-run] [--user-id=UUID]
 *
 * Options:
 *   --dry-run: Preview changes without writing to database
 *   --user-id: Only process tasks for a specific user
 */

import { db } from '../db';
import { taskProgress } from '@shared/schema';
import { eq, sql, and, isNotNull } from 'drizzle-orm';

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const USER_ID_ARG = process.argv.find(arg => arg.startsWith('--user-id='));
const TARGET_USER_ID = USER_ID_ARG ? USER_ID_ARG.split('=')[1] : null;

// Feature flag (match server/routes.ts)
const NORMALIZE_TASK_DURATION = process.env.NORMALIZE_TASK_DURATION !== 'false';

if (!NORMALIZE_TASK_DURATION) {
  console.warn('[Backfill][Skipped] NORMALIZE_TASK_DURATION is disabled');
  process.exit(0);
}

interface TaskRecord {
  id: string;
  userId: string;
  weekNumber: number;
  dayNumber: number;
  taskTitle: string;
  duration: number | null;
  estimatedDurationSec: number | null;
  progressData: Record<string, any> | null;
}

/**
 * Determine if a day is a weekend based on dayNumber
 * Assumes dayNumber 1-7 where 1=Monday, 6=Saturday, 7=Sunday
 */
function isWeekend(dayNumber: number): boolean {
  const normalizedDay = ((dayNumber - 1) % 7) + 1;
  return normalizedDay === 6 || normalizedDay === 7;
}

/**
 * Get user's preferred session durations
 * Falls back to 60 minutes if not found
 */
async function getUserSessionDurations(userId: string): Promise<{ weekday: number; weekend: number }> {
  const { studyPlans } = await import('@shared/schema');

  // Get the most recent study plan for the user
  const plans = await db
    .select()
    .from(studyPlans)
    .where(eq(studyPlans.userId, userId))
    .limit(1);

  if (!plans.length || !plans[0].studyPreferences) {
    console.log(`[Backfill][User:${userId}] No study preferences, using default 60 min`);
    return { weekday: 60, weekend: 60 };
  }

  const studyPrefs = plans[0].studyPreferences as any;

  // Check for explicit listeningDurations
  const listeningDurations = studyPrefs.listeningDurations || {};
  const weekday = typeof listeningDurations.weekday === 'number' ? listeningDurations.weekday : 60;
  const weekend = typeof listeningDurations.weekend === 'number' ? listeningDurations.weekend : 60;

  console.log(`[Backfill][User:${userId}] Session durations: weekday=${weekday}, weekend=${weekend}`);
  return { weekday, weekend };
}

/**
 * Normalize a single task record
 */
function normalizeTaskRecord(
  task: TaskRecord,
  sessionDurations: { weekday: number; weekend: number }
): { duration: number; progressData: any } {
  const isWeekendTask = isWeekend(task.dayNumber);
  const durationMinutes = isWeekendTask ? sessionDurations.weekend : sessionDurations.weekday;

  const existingProgressData = task.progressData || {};

  // Build new progressData with audio object
  const newProgressData = {
    ...existingProgressData,
    audio: {
      ...(existingProgressData.audio || {}),
      estimatedDurationSec: task.estimatedDurationSec ?? 360, // Default to 6 min if missing
      accent: existingProgressData.accent || (existingProgressData.sessionPrefetch as any)?.accent,
    },
  };

  return {
    duration: durationMinutes,
    progressData: newProgressData,
  };
}

/**
 * Main backfill function
 */
async function backfillTaskDurations() {
  console.log('[Backfill][Start]', {
    dryRun: DRY_RUN,
    targetUserId: TARGET_USER_ID || 'all',
    timestamp: new Date().toISOString(),
  });

  try {
    // Query all listening tasks that have estimatedDurationSec but haven't been normalized
    const whereConditions = [
      eq(taskProgress.skill, 'listening'),
      isNotNull(taskProgress.estimatedDurationSec),
    ];

    if (TARGET_USER_ID) {
      whereConditions.push(eq(taskProgress.userId, TARGET_USER_ID));
    }

    const tasksToUpdate = (await db
      .select({
        id: taskProgress.id,
        userId: taskProgress.userId,
        weekNumber: taskProgress.weekNumber,
        dayNumber: taskProgress.dayNumber,
        taskTitle: taskProgress.taskTitle,
        duration: taskProgress.duration,
        estimatedDurationSec: taskProgress.estimatedDurationSec,
        progressData: taskProgress.progressData,
      })
      .from(taskProgress)
      .where(and(...whereConditions))) as TaskRecord[];

    console.log(`[Backfill][Found] ${tasksToUpdate.length} tasks to process`);

    if (tasksToUpdate.length === 0) {
      console.log('[Backfill][Complete] No tasks to update');
      return;
    }

    // Group tasks by userId for efficient session duration lookup
    const tasksByUser = new Map<string, TaskRecord[]>();
    for (const task of tasksToUpdate) {
      if (!tasksByUser.has(task.userId)) {
        tasksByUser.set(task.userId, []);
      }
      tasksByUser.get(task.userId)!.push(task);
    }

    let totalUpdated = 0;
    let totalSkipped = 0;

    // Process each user's tasks
    for (const [userId, userTasks] of tasksByUser.entries()) {
      console.log(`[Backfill][User:${userId}] Processing ${userTasks.length} tasks`);

      const sessionDurations = await getUserSessionDurations(userId);

      for (const task of userTasks) {
        // Check if already normalized (has audio object in progressData)
        const hasAudioObject = task.progressData && (task.progressData as any).audio;
        if (hasAudioObject) {
          console.log(`[Backfill][Skip] Task ${task.id} already normalized`);
          totalSkipped++;
          continue;
        }

        const normalized = normalizeTaskRecord(task, sessionDurations);

        if (DRY_RUN) {
          console.log(`[Backfill][DryRun] Would update task ${task.id}:`, {
            taskTitle: task.taskTitle,
            weekNumber: task.weekNumber,
            dayNumber: task.dayNumber,
            oldDuration: task.duration,
            newDuration: normalized.duration,
            oldEstimatedDurationSec: task.estimatedDurationSec,
            newAudioEstimatedDurationSec: normalized.progressData.audio.estimatedDurationSec,
          });
        } else {
          await db
            .update(taskProgress)
            .set({
              duration: normalized.duration,
              progressData: normalized.progressData,
            })
            .where(eq(taskProgress.id, task.id));

          console.log(`[Backfill][Updated] Task ${task.id} (week ${task.weekNumber}, day ${task.dayNumber})`);
        }

        totalUpdated++;
      }
    }

    console.log('[Backfill][Complete]', {
      totalProcessed: tasksToUpdate.length,
      updated: totalUpdated,
      skipped: totalSkipped,
      dryRun: DRY_RUN,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Backfill][Error]', {
      message: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  }
}

// Run the script
backfillTaskDurations()
  .then(() => {
    console.log('[Backfill][Exit] Success');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Backfill][Exit] Fatal error:', error);
    process.exit(1);
  });
