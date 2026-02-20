import test from "node:test";
import assert from "node:assert/strict";
import { LISTENING_EVENT_TOPICS } from "@shared/listening";
import {
  consumeListeningEvent,
  publishListeningEvent,
  publishListeningEventDurably,
} from "../listeningEvents";

test("durable event publisher retries outbox persistence and succeeds", async () => {
  let attempts = 0;
  const result = await publishListeningEventDurably({
    topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
    eventType: "listening.section.state.changed",
    eventVersion: "1.0.0",
    producer: "test",
    traceId: "trc-1",
    correlationId: "cor-1",
    idempotencyKey: "session:1:state:v1",
    userId: "user-1",
    taskProgressId: "task-1",
    payload: {
      section_id: "task-1:section-1",
      section_no: 1,
      state: "PLANNED",
      attempt: 0,
      occurred_at: new Date().toISOString(),
    },
    maxOutboxAttempts: 3,
    outboxRetryDelayMs: 1,
    persistOutboxFn: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("temporary write failure");
      }
    },
  });

  assert.equal(attempts, 3);
  assert.equal(result.outboxPersisted, true);
  assert.ok(result.event?.event_id);
});

test("durable event publisher never throws when outbox persistence keeps failing", async () => {
  let attempts = 0;
  const result = await publishListeningEventDurably({
    topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
    eventType: "listening.section.state.changed",
    eventVersion: "1.0.0",
    producer: "test",
    traceId: "trc-2",
    correlationId: "cor-2",
    idempotencyKey: "session:1:state:v2",
    userId: "user-1",
    taskProgressId: "task-1",
    payload: {
      section_id: "task-1:section-1",
      section_no: 1,
      state: "PLANNED",
      attempt: 0,
      occurred_at: new Date().toISOString(),
    },
    maxOutboxAttempts: 2,
    outboxRetryDelayMs: 1,
    persistOutboxFn: async () => {
      attempts += 1;
      throw new Error("permanent write failure");
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.outboxPersisted, false);
  assert.ok(result.event?.event_id);
});

test("at-least-once delivery with same idempotency key is deduped", async () => {
  const event = publishListeningEvent({
    topic: LISTENING_EVENT_TOPICS.SECTION_COMMANDS,
    eventType: "listening.section.build.requested",
    eventVersion: "1.0.0",
    producer: "test",
    traceId: "trc-3",
    correlationId: "cor-3",
    idempotencyKey: "session:1:build_requested:v1",
    userId: "user-1",
    payload: {
      task_id: "task-1",
      section_id: "task-1:section-1",
      section_no: 1,
    },
  });

  let consumedCount = 0;
  await consumeListeningEvent({
    topic: LISTENING_EVENT_TOPICS.SECTION_COMMANDS,
    rawEvent: event,
    onConsume: async () => {
      consumedCount += 1;
    },
  });
  await consumeListeningEvent({
    topic: LISTENING_EVENT_TOPICS.SECTION_COMMANDS,
    rawEvent: event,
    onConsume: async () => {
      consumedCount += 1;
    },
  });

  assert.equal(consumedCount, 1);
});
