import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSectionAndSessionAnalytics,
  resolveListeningStartupGateModeForTask,
  resolveListeningStartupGateStrategy,
  resolveStartupGateReadyForMode,
  summarizeStartupGateTelemetry,
} from "../listeningRoadmapGRuntime";

test("startup gate strategy parser supports cohort aliases", () => {
  assert.equal(resolveListeningStartupGateStrategy("legacy"), "legacy");
  assert.equal(resolveListeningStartupGateStrategy("cohort"), "cohort");
  assert.equal(resolveListeningStartupGateStrategy("mixed"), "cohort");
  assert.equal(resolveListeningStartupGateStrategy("unknown"), "section_ready");
});

test("startup gate cohort mode is deterministic and respects boundaries", () => {
  const cohortConfig = {
    strategy: "cohort" as const,
    cohortPercent: 50,
    cohortSeed: "roadmap-g-test",
  };
  const first = resolveListeningStartupGateModeForTask(cohortConfig, {
    taskProgressId: "task-123",
    userId: "user-42",
  });
  const second = resolveListeningStartupGateModeForTask(cohortConfig, {
    taskProgressId: "task-123",
    userId: "user-42",
  });
  assert.equal(first, second);

  assert.equal(
    resolveListeningStartupGateModeForTask(
      { ...cohortConfig, cohortPercent: 0 },
      { taskProgressId: "task-123", userId: "user-42" },
    ),
    "legacy",
  );
  assert.equal(
    resolveListeningStartupGateModeForTask(
      { ...cohortConfig, cohortPercent: 100 },
      { taskProgressId: "task-123", userId: "user-42" },
    ),
    "section_ready",
  );
});

test("startup readiness gate keeps legacy fallback behavior only in legacy mode", () => {
  assert.equal(
    resolveStartupGateReadyForMode({
      mode: "section_ready",
      partReady: false,
      prefetchStatus: "ready",
      hasAudio: true,
    }),
    false,
  );

  assert.equal(
    resolveStartupGateReadyForMode({
      mode: "legacy",
      partReady: false,
      prefetchStatus: "ready_partial",
      hasAudio: true,
    }),
    true,
  );

  assert.equal(
    resolveStartupGateReadyForMode({
      mode: "legacy",
      partReady: false,
      prefetchStatus: "queued",
      hasAudio: false,
    }),
    false,
  );
});

test("section/session analytics include playback and timing aggregates", () => {
  const analytics = buildSectionAndSessionAnalytics(
    [
      {
        sectionId: "s1",
        sectionNo: 1,
        attempted: 3,
        correct: 2,
        incorrect: 1,
        unanswered: 0,
        accuracy: 66.7,
        challengeTags: ["detail"],
        perQuestion: [
          { questionId: "q1", responseTimeMs: 1200, replayCount: 1, answerChangeCount: 0, correct: true },
          { questionId: "q2", responseTimeMs: 2400, replayCount: 0, answerChangeCount: 1, correct: false },
          { questionId: "q3", responseTimeMs: 0, replayCount: 2, answerChangeCount: 0, unanswered: true },
        ],
      },
      {
        sectionId: "s2",
        sectionNo: 2,
        attempted: 2,
        correct: 2,
        incorrect: 0,
        unanswered: 1,
        accuracy: 100,
        challengeTags: [],
        perQuestion: [
          { questionId: "q4", responseTimeMs: 3100, replayCount: 0, answerChangeCount: 0, correct: true },
        ],
      },
    ],
    "1.0.0",
  );

  assert.equal(analytics.schemaVersion, "1.0.0");
  assert.equal(analytics.sections.length, 2);
  assert.equal(analytics.sections[0].playback.replayTotal, 3);
  assert.equal(analytics.sections[0].playback.answerChangeTotal, 1);
  assert.equal(analytics.sections[0].timing.count, 2);
  assert.equal(analytics.session.totalSections, 2);
  assert.equal(analytics.session.playback.replayTotal, 3);
  assert.equal(analytics.session.playback.answerChangeTotal, 1);
  assert.equal(analytics.session.timing.count, 3);
});

test("boost effectiveness summary reports wait and success metrics", () => {
  const summary = summarizeStartupGateTelemetry({
    version: "1.0.0",
    mode: "section_ready",
    boostCount: 4,
    successfulBoostCount: 3,
    boostBySource: {
      session_open: 2,
      transition_wait: 2,
    },
    waitingStartedAt: "2026-02-11T00:00:00.000Z",
    waits: [
      { startedAt: "2026-02-11T00:00:00.000Z", readyAt: "2026-02-11T00:00:15.000Z" },
      { waitMs: 5000 },
    ],
  }, Date.parse("2026-02-11T00:01:00.000Z"));

  assert.equal(summary.mode, "section_ready");
  assert.equal(summary.boostCount, 4);
  assert.equal(summary.successfulBoostCount, 3);
  assert.equal(summary.boostSuccessRate, 0.75);
  assert.equal(summary.waitStats.count, 2);
  assert.equal(summary.waitStats.minMs, 5000);
  assert.equal(summary.waitStats.maxMs, 15000);
  assert.equal(summary.waitStats.totalMs, 20000);
  assert.equal(summary.inFlightWaitMs, 60000);
});
