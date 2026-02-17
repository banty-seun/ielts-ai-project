import assert from "node:assert/strict";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { buildManifestReadiness } from "../server/services/listeningReadiness";

async function run() {
  const rows = (
    await pool.query("select id from task_progress where lower(skill)='listening' order by created_at desc limit 1")
  ).rows;
  assert.ok(rows.length > 0, "No listening tasks found for release readiness probe");

  const taskId = String(rows[0].id);
  const task = await storage.getTaskWithContent(taskId);
  assert.ok(task, `Missing task row for ${taskId}`);

  const readiness = await buildManifestReadiness(task);
  assert.ok(readiness && typeof readiness === "object", `Readiness probe failed for task ${taskId}`);

  console.log(
    "[ReleaseProbe][Readiness]",
    JSON.stringify({
      taskId,
      manifestStatus: readiness.manifestStatus,
      prefetchStatus: readiness.prefetchStatus,
      prefetchPhase: readiness.prefetchPhase,
    }),
  );

  await pool.end();
}

run().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
