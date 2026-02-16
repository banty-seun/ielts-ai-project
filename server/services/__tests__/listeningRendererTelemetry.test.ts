import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRendererTelemetryUpdate,
  normalizeRendererMode,
  summarizeRendererTelemetry,
} from "../listeningRendererTelemetry";

test("normalizes renderer mode values", () => {
  assert.equal(normalizeRendererMode("dual"), "dual");
  assert.equal(normalizeRendererMode("legacy"), "legacy");
  assert.equal(normalizeRendererMode("unknown"), "legacy");
});

test("applies telemetry event and completion updates", () => {
  const initial = {};
  const withEvent = applyRendererTelemetryUpdate(initial, {
    mode: "dual",
    eventType: "unsupported_engine_block",
    error: true,
    taskProgressId: "task-1",
  });
  const withCompletion = applyRendererTelemetryUpdate(withEvent, {
    mode: "dual",
    completionAttempt: true,
    completed: true,
    taskProgressId: "task-1",
  });

  const dual = withCompletion.rendererTelemetry.by_mode.dual;
  assert.equal(dual.events, 1);
  assert.equal(dual.error_events, 1);
  assert.equal(dual.unsupported_engine_events, 1);
  assert.equal(dual.completion_attempts, 1);
  assert.equal(dual.completed_sessions, 1);
  assert.equal(Array.isArray(withCompletion.rendererTelemetry.events), true);
  assert.equal(withCompletion.rendererTelemetry.events.length, 1);
});

test("summarizes renderer telemetry with rates and deltas", () => {
  const summary = summarizeRendererTelemetry([
    {
      rendererTelemetry: {
        by_mode: {
          legacy: {
            events: 10,
            error_events: 3,
            unsupported_engine_events: 1,
            completion_attempts: 5,
            completed_sessions: 4,
          },
          dual: {
            events: 8,
            error_events: 1,
            unsupported_engine_events: 0,
            completion_attempts: 6,
            completed_sessions: 6,
          },
        },
      },
    },
  ]);

  assert.equal(summary.legacy.error_rate, 0.3);
  assert.equal(summary.dual.error_rate, 0.125);
  assert.equal(summary.legacy.completion_rate, 0.8);
  assert.equal(summary.dual.completion_rate, 1);
  assert.equal(summary.deltas.error_rate, -0.175);
  assert.equal(summary.deltas.completion_rate, 0.2);
});

