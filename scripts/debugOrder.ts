#!/usr/bin/env tsx
import 'dotenv/config';
import { storage } from '../server/storage';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[debugOrder] DATABASE_URL is not set; cannot talk to Postgres.');
    process.exit(1);
  }

  const progressId = process.env.DEBUG_PROGRESS_ID ?? process.argv[2];
  if (!progressId) {
    console.error('[debugOrder] Provide a task progress id via DEBUG_PROGRESS_ID or argv[2].');
    process.exit(1);
  }

  const progress = await storage.getTaskProgress(progressId);
  if (!progress) {
    console.error(`[debugOrder] No task_progress row for id=${progressId}`);
    process.exit(1);
  }

  const progressData = (progress.progressData ?? {}) as Record<string, any>;
  const segmentOrder = (progressData.segmentOrder ?? {}) as Record<string, string[]>;
  const assignments = (progressData.segmentAssignments ?? {}) as Record<string, string[]>;
  const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
  const rawQuestions = Array.isArray(progress.questions) ? progress.questions : [];
  const defaultQuestionIds = rawQuestions.map((q: any, idx: number) => q?.id ?? `q${idx + 1}`);

  console.log('--- debugOrder summary ---');
  console.log('progress.id:', progressId);
  console.log('questions in stored order:', defaultQuestionIds);
  console.log('segment ids:', segments.map((seg: any) => seg?.id));

  if (!Object.keys(segmentOrder).length) {
    console.warn('[debugOrder] segmentOrder MISSING on progress_data.');
    return;
  }

  Object.entries(segmentOrder).forEach(([segmentId, order]) => {
    const humanLabel =
      segments.find((seg: any) => seg?.id === segmentId)?.ieltsPart ??
      segments.findIndex((seg: any) => seg?.id === segmentId) + 1;
    console.log(
      `segment ${segmentId} (IELTS part ${humanLabel || '?'}) order (${order.length} questions):`,
      order,
    );
    const assignment = assignments[segmentId];
    if (assignment) {
      const chronological = assignment.join(', ');
      const randomized = order.join(', ');
      console.log(`  original assignment: [${chronological}]`);
      console.log(`  randomized order:  [${randomized}]`);
    }
  });
}

main().catch((err) => {
  console.error('[debugOrder] crashed', err);
  process.exit(1);
});
