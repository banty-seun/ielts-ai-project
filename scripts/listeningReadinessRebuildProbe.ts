import assert from "node:assert/strict";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { rebuildListeningReadinessFromOutbox } from "../server/services/listeningReadinessReplay";
import { buildManifestReadiness } from "../server/services/listeningReadiness";

async function run() {
  const rows = (
    await pool.query("select id from task_progress where lower(skill)='listening' order by created_at desc limit 3")
  ).rows;
  assert.ok(rows.length > 0, "No listening tasks available for readiness rebuild probe");

  const report = [];
  for (const row of rows) {
    const taskId = String(row.id);
    const rebuilt = await rebuildListeningReadinessFromOutbox(taskId);
    assert.equal(rebuilt.ok, true, `Readiness rebuild failed for task ${taskId}`);
    const task = await storage.getTaskWithContent(taskId);
    assert.ok(task, `Missing task row for ${taskId}`);
    const readiness = await buildManifestReadiness(task);
    report.push({
      taskId,
      totalOutboxEvents: rebuilt.ok ? rebuilt.totalOutboxEvents : 0,
      applied: rebuilt.ok ? rebuilt.applied : 0,
      errors: rebuilt.ok ? rebuilt.errors.length : 0,
      manifestStatus: readiness.manifestStatus,
      partReady: readiness.partReady,
    });
  }

  console.log("[ReleaseProbe][ReadinessRebuild]", JSON.stringify(report));
  await pool.end();
  process.exit(0);
}

run().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
