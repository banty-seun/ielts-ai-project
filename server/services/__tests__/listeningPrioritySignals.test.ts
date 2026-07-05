import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveListeningPriority,
  deriveListeningPrioritySignalsFromSource,
  normalizeListeningPrefetchSource,
} from "../listeningPriority";

test("priority source normalization maps expected values", () => {
  assert.equal(normalizeListeningPrefetchSource("dashboard_open"), "dashboard_open");
  assert.equal(normalizeListeningPrefetchSource("dashboard_start_click"), "dashboard_start_click");
  assert.equal(normalizeListeningPrefetchSource("session_open"), "session_open");
  assert.equal(normalizeListeningPrefetchSource("transition_wait"), "transition_wait");
  assert.equal(normalizeListeningPrefetchSource("weird"), "unknown");
});

test("priority source signals boost start and dashboard intent correctly", () => {
  const dashboardOpenSignals = deriveListeningPrioritySignalsFromSource("dashboard_open");
  assert.equal(dashboardOpenSignals.dashboardOpenBoost, true);
  assert.equal(dashboardOpenSignals.startClickBoost, false);

  const dashboardSignals = deriveListeningPrioritySignalsFromSource("dashboard_start_click");
  assert.equal(dashboardSignals.dashboardOpenBoost, true);
  assert.equal(dashboardSignals.startClickBoost, true);

  const sessionSignals = deriveListeningPrioritySignalsFromSource("session_open");
  assert.equal(sessionSignals.dashboardOpenBoost, false);
  assert.equal(sessionSignals.startClickBoost, true);

  const unknownSignals = deriveListeningPrioritySignalsFromSource("unknown");
  assert.equal(unknownSignals.dashboardOpenBoost, false);
  assert.equal(unknownSignals.startClickBoost, false);
});

test("derived priority class increases with source intent boost", () => {
  const now = new Date("2026-02-19T12:00:00.000Z");
  const sessionStartAt = new Date("2026-02-19T12:50:00.000Z");
  const neutral = deriveListeningPriority({
    now,
    sessionStartAt,
    readinessGap: 1,
    dashboardOpenBoost: false,
    startClickBoost: false,
  });
  const boosted = deriveListeningPriority({
    now,
    sessionStartAt,
    readinessGap: 1,
    dashboardOpenBoost: true,
    startClickBoost: true,
  });
  assert.ok(boosted.score > neutral.score);
  assert.equal(boosted.priorityClass, "P1_CURRENT");
});
