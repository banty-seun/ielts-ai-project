import assert from "node:assert/strict";
import { LISTENING_EVENT_TOPICS, LISTENING_EVENT_TYPES } from "@shared/listening";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { publishListeningEventDurably } from "../server/services/listeningEvents";
import { rebuildListeningReadinessFromOutbox } from "../server/services/listeningReadinessReplay";

async function run() {
  const rows = (
    await pool.query("select id, user_id from task_progress where lower(skill)='listening' order by created_at desc limit 1")
  ).rows;
  assert.ok(rows.length > 0, "No listening tasks available for replay determinism probe");
  const taskId = String(rows[0].id);
  const userId = String(rows[0].user_id);

  const sectionNo = 99;
  const sectionId = `${taskId}:section-${sectionNo}`;
  const idempotencyKey = `${taskId}:${sectionNo}:probe_section_state:v1`;
  const emitted = await publishListeningEventDurably({
    topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
    eventType: LISTENING_EVENT_TYPES.SECTION_STATE_CHANGED,
    eventVersion: "1.0.0",
    producer: "release-probe",
    traceId: `trc-probe-${Date.now()}`,
    correlationId: taskId,
    idempotencyKey,
    userId,
    taskProgressId: taskId,
    payload: {
      section_id: sectionId,
      section_no: sectionNo,
      previous_state: null,
      state: "PUBLISHED",
      attempt: 0,
      occurred_at: new Date().toISOString(),
      metadata: {
        source: "readiness_replay_determinism_probe",
      },
    },
  });
  assert.ok(emitted.event?.event_id, "Event emission failed in replay determinism probe");
  assert.equal(emitted.outboxPersisted, true, "Event was not persisted to outbox");

  const rebuilt = await rebuildListeningReadinessFromOutbox(taskId);
  assert.equal(rebuilt.ok, true, "Outbox readiness rebuild failed");
  assert.ok(rebuilt.applied > 0, "Outbox rebuild did not apply any event");

  const projected = await storage.getListeningReadinessModel(taskId, sectionId);
  assert.ok(projected, "Projected readiness row not found for synthetic replay section");
  assert.equal(projected?.partReady, true);
  assert.equal(projected?.manifestStatus, "ready");

  console.log(
    "[ReleaseProbe][ReadinessReplayDeterminism]",
    JSON.stringify({
      taskId,
      sectionId,
      applied: rebuilt.applied,
      outboxPersisted: emitted.outboxPersisted,
      readinessState: projected?.state ?? null,
      manifestStatus: projected?.manifestStatus ?? null,
    }),
  );

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
