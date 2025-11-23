import 'dotenv/config';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../server/db';

async function main() {
  const userId = process.env.DEBUG_USER_ID || null;
  const filters = [eq(schema.taskProgress.skill, 'listening')];
  if (userId) {
    filters.push(eq(schema.taskProgress.userId, userId));
  }

  const where = filters.length === 1 ? filters[0] : and(...filters);

  const tasks = await db
    .select()
    .from(schema.taskProgress)
    .where(where)
    .orderBy(desc(schema.taskProgress.updatedAt ?? schema.taskProgress.createdAt))
    .limit(1);

  const task = tasks[0];
  if (!task) {
    console.log('No listening task_progress rows found');
    return;
  }

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
  const totalSec = segments.reduce((sum, seg) => sum + Number(seg?.estimatedDurationSec ?? 0), 0);

  console.log('task_progress id:', task.id);
  console.log('user:', task.userId);
  console.log('duration (minutes):', task.duration);
  console.log('segments length:', segments.length);
  segments.forEach((seg, index) => {
    console.log(`  Segment ${index + 1}:`, {
      id: seg?.id,
      ieltsPart: seg?.ieltsPart,
      estimatedDurationSec: seg?.estimatedDurationSec,
    });
  });
  console.log('Total segment seconds:', totalSec);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
