/**
 * Backfill Script: Normalize Weekly Plan Durations
 *
 * This script updates existing weekly_study_plans.plan_data.plan[*] to use normalized durations:
 * - Ensures `durationMinutes` is numeric and represents session preference
 * - Forces `duration` to be `"${durationMinutes} min"`
 * - Removes legacy `durationLabel` and top-level `estimatedDurationSec`
 * - Moves `estimatedDurationSec` into `audio` nested object
 *
 * Usage:
 *   tsx server/scripts/backfillWeeklyPlans.ts [--dry-run]
 *
 * Options:
 *   --dry-run: Preview changes without writing to database
 */

import { db } from '../db';
import { weeklyStudyPlans } from '../../shared/schema';
import { eq } from 'drizzle-orm';

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');

interface WeeklyPlanRecord {
  id: string;
  userId: string;
  weekNumber: number;
  skillFocus: string;
  planData: any;
}

/**
 * Normalize a single task within plan data
 */
function normalizeTask(task: any): any {
  // Skip if already normalized (has audio.estimatedDurationSec and no top-level estimatedDurationSec)
  if (task.audio?.estimatedDurationSec && !task.estimatedDurationSec && !task.durationLabel) {
    return task;
  }

  const normalized = { ...task };

  // Ensure durationMinutes is numeric
  if (typeof normalized.durationMinutes === 'number' && normalized.durationMinutes > 0) {
    // Force correct duration label
    normalized.duration = `${normalized.durationMinutes} min`;
  } else if (typeof normalized.duration === 'string') {
    // Try to extract numeric minutes from duration string
    const match = normalized.duration.match(/(\d+)/);
    if (match) {
      normalized.durationMinutes = parseInt(match[1], 10);
      normalized.duration = `${normalized.durationMinutes} min`;
    }
  }

  // Remove legacy fields
  if (normalized.estimatedDurationSec) {
    // Move to audio object
    normalized.audio = {
      ...(normalized.audio || {}),
      estimatedDurationSec: normalized.estimatedDurationSec,
    };
    delete normalized.estimatedDurationSec;
  }

  if (normalized.durationLabel) {
    delete normalized.durationLabel;
  }

  return normalized;
}

/**
 * Main backfill function
 */
async function backfillWeeklyPlans() {
  console.log('[Backfill][Start]', {
    dryRun: DRY_RUN,
    timestamp: new Date().toISOString(),
  });

  try {
    // Query all weekly study plans
    const plans = (await db
      .select({
        id: weeklyStudyPlans.id,
        userId: weeklyStudyPlans.userId,
        weekNumber: weeklyStudyPlans.weekNumber,
        skillFocus: weeklyStudyPlans.skillFocus,
        planData: weeklyStudyPlans.planData,
      })
      .from(weeklyStudyPlans)) as WeeklyPlanRecord[];

    console.log(`[Backfill][Found] ${plans.length} weekly plans to process`);

    if (plans.length === 0) {
      console.log('[Backfill][Complete] No plans to update');
      return;
    }

    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalTasksNormalized = 0;

    for (const plan of plans) {
      const planData = plan.planData as any;

      // Check if plan has tasks to normalize
      if (!planData?.plan || !Array.isArray(planData.plan)) {
        console.log(`[Backfill][Skip] Plan ${plan.id} has no tasks array`);
        totalSkipped++;
        continue;
      }

      // Normalize all tasks
      let modified = false;
      const normalizedTasks = planData.plan.map((task: any, index: number) => {
        const before = JSON.stringify(task);
        const normalized = normalizeTask(task);
        const after = JSON.stringify(normalized);

        if (before !== after) {
          modified = true;
          totalTasksNormalized++;

          if (DRY_RUN) {
            console.log(`[Backfill][DryRun] Would normalize task ${index + 1} in plan ${plan.id}:`, {
              skill: plan.skillFocus,
              week: plan.weekNumber,
              taskTitle: task.title || task.taskTitle,
              oldDuration: task.duration,
              newDuration: normalized.duration,
              oldDurationMinutes: task.durationMinutes,
              newDurationMinutes: normalized.durationMinutes,
              hadTopLevelEstimatedDuration: Boolean(task.estimatedDurationSec),
              hasAudioEstimatedDuration: Boolean(normalized.audio?.estimatedDurationSec),
            });
          }
        }

        return normalized;
      });

      if (!modified) {
        console.log(`[Backfill][Skip] Plan ${plan.id} already normalized`);
        totalSkipped++;
        continue;
      }

      const updatedPlanData = {
        ...planData,
        plan: normalizedTasks,
      };

      if (DRY_RUN) {
        console.log(`[Backfill][DryRun] Would update plan ${plan.id} (${plan.skillFocus}, week ${plan.weekNumber})`);
      } else {
        await db
          .update(weeklyStudyPlans)
          .set({
            planData: updatedPlanData,
          })
          .where(eq(weeklyStudyPlans.id, plan.id));

        console.log(`[Backfill][Updated] Plan ${plan.id} (${plan.skillFocus}, week ${plan.weekNumber}) - ${normalizedTasks.length} tasks`);
      }

      totalUpdated++;
    }

    console.log('[Backfill][Complete]', {
      totalPlans: plans.length,
      updated: totalUpdated,
      skipped: totalSkipped,
      tasksNormalized: totalTasksNormalized,
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
backfillWeeklyPlans()
  .then(() => {
    console.log('[Backfill][Exit] Success');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Backfill][Exit] Fatal error:', error);
    process.exit(1);
  });
