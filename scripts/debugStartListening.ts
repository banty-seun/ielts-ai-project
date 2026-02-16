#!/usr/bin/env tsx
import 'dotenv/config';
import { storage } from '../server/storage';
import { ensureListeningSegments } from '../server/services/taskFactory';
import { resolveSessionMinutesFromTask } from '../server/services/sessionDuration';
import { DEFAULT_ACCENT, LISTENING_SESSION_MINUTES } from '../shared/constants';

const approxEqual = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[debugStartListening] DATABASE_URL is not set; cannot talk to Postgres.');
    process.exit(1);
  }

  const userId = process.env.DEBUG_USER_ID;
  if (!userId) {
    console.error('[debugStartListening] Set DEBUG_USER_ID to an existing user.id (not Firebase UID).');
    process.exit(1);
  }

  const user = await storage.getUser(userId);
  if (!user) {
    console.error(`[debugStartListening] No user found for id=${userId}`);
    process.exit(1);
  }

  const plans = await storage.getWeeklyStudyPlansByUserId(user.id);
  const listeningPlan =
    plans.find((plan) => plan.skillFocus?.toLowerCase() === 'listening') ?? plans[0];
  if (!listeningPlan) {
    console.error('[debugStartListening] No weekly plan records found for user.');
    process.exit(1);
  }

  const tasks = Array.isArray((listeningPlan.planData as any)?.plan)
    ? ((listeningPlan.planData as any).plan as any[])
    : [];
  const firstListeningTask =
    tasks.find(
      (task) => (task?.skill ?? task?.skillFocus ?? 'listening').toLowerCase() === 'listening',
    ) ?? tasks[0];

  if (!firstListeningTask) {
    console.error('[debugStartListening] Weekly plan has no listening tasks in planData.plan.');
    process.exit(1);
  }

  const dayNumber = Number(firstListeningTask.dayNumber ?? 1);
  const taskTitle = firstListeningTask.title ?? firstListeningTask.originalTitle ?? 'Listening Practice';
  const planProgressData =
    firstListeningTask.progressData && typeof firstListeningTask.progressData === 'object'
      ? (firstListeningTask.progressData as Record<string, any>)
      : undefined;

  const assignmentScope = {
    userId: user.id,
    weeklyPlanId: listeningPlan.id,
    dayNumber,
    taskTitle,
    skill: 'listening',
  };

  let progress =
    (await storage.findTaskProgressByScope(assignmentScope)) ??
    (await storage.createTaskProgress({
      id: undefined,
      userId: user.id,
      weeklyPlanId: listeningPlan.id,
      weekNumber: listeningPlan.weekNumber,
      dayNumber,
      taskTitle,
      skill: 'listening',
      status: 'in-progress',
      progressData: {},
      startedAt: new Date(),
    }));

  const sessionMinutes = resolveSessionMinutesFromTask(
    {
      durationMinutes: firstListeningTask.durationMinutes,
      duration: firstListeningTask.duration,
      progressData: planProgressData,
    } as any,
    LISTENING_SESSION_MINUTES,
  );

  const segments = ensureListeningSegments(
    Array.isArray(planProgressData?.segments) ? planProgressData?.segments : [],
    sessionMinutes,
    {
      baseTitle: taskTitle,
      accent: firstListeningTask.accent ?? DEFAULT_ACCENT,
    },
  );

  const updatedProgressData = {
    ...(progress.progressData ?? {}),
    sessionDurationMinutes: sessionMinutes,
    segments,
  };

  if ((progress.progressData as any)?.segments?.length !== segments.length) {
    progress = await storage.updateTaskProgress(progress.id, {
      duration: sessionMinutes,
      progressData: updatedProgressData,
    });
  } else {
    progress.progressData = updatedProgressData;
    progress.duration = sessionMinutes;
  }

  const totalSeconds = segments.reduce(
    (sum, seg) => sum + Number(seg?.estimatedDurationSec ?? 0),
    0,
  );

  console.log('--- debugStartListening summary ---');
  console.log('progress.id:', progress.id);
  console.log('duration (minutes):', sessionMinutes);
  console.log('segments length:', segments.length);
  segments.forEach((segment, idx) => {
    console.log(
      `  seg[${idx}] -> { id: ${segment.id}, ieltsPart: ${segment.ieltsPart}, estimatedDurationSec: ${segment.estimatedDurationSec}, accent: ${segment.accent} }`,
    );
  });
  console.log('Total segment seconds:', totalSeconds);
  console.log(
    'Matches duration*60:',
    approxEqual(totalSeconds, sessionMinutes * 60, 60) ? 'YES' : 'NO',
  );
}

main().catch((err) => {
  console.error('[debugStartListening] crashed', err);
  process.exit(1);
});
