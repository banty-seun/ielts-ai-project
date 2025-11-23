import "dotenv/config";
import { db, schema } from "../server/db";
import { ensureListeningSegments } from "../server/services/taskFactory";
import { resolveSessionMinutesFromTask } from "../server/services/sessionDuration";
import { normalizeAccent } from "../server/utils/audio.ts";
import { LISTENING_SESSION_MINUTES, DEFAULT_ACCENT } from "../shared/constants";
import { eq } from "drizzle-orm";

async function backfillListeningSegments() {
  console.log("[Backfill][ListeningSegments] Starting pass");

  const listeningTasks = await db
    .select()
    .from(schema.taskProgress)
    .where(eq(schema.taskProgress.skill, "listening"));

  console.log(`[Backfill][ListeningSegments] Found ${listeningTasks.length} listening tasks`);

  for (const task of listeningTasks) {
    const progress = (task.progressData ?? {}) as Record<string, any>;
    const segments = Array.isArray(progress.segments) ? progress.segments : [];
    const hasCompleteSegments =
      segments.length === 4 &&
      segments.every(
        (segment) =>
          segment &&
          typeof segment.estimatedDurationSec === "number" &&
          segment.accent &&
          segment.voiceId,
      );

    if (hasCompleteSegments) {
      continue;
    }

    const minutes = resolveSessionMinutesFromTask(task, LISTENING_SESSION_MINUTES);
    const accentSource =
      progress.accent ??
      segments.find((segment) => typeof segment?.accent === "string")?.accent ??
      task.accent ??
      DEFAULT_ACCENT;
    const enrichedSegments = ensureListeningSegments(segments, minutes, {
      baseTitle: task.taskTitle,
      accent: normalizeAccent(accentSource),
    });

    const updatedProgress = {
      ...progress,
      sessionDurationMinutes: minutes,
      segments: enrichedSegments,
    };

    await db
      .update(schema.taskProgress)
      .set({
        duration: minutes,
        progressData: updatedProgress,
      })
      .where(eq(schema.taskProgress.id, task.id));

    console.log(`[Backfill][ListeningSegments] Backfilled ${task.id}`);
  }

  console.log("[Backfill][ListeningSegments] Complete");
}

backfillListeningSegments()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[Backfill][ListeningSegments] Failed", error);
    process.exit(1);
  });
