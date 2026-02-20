import assert from "node:assert/strict";
import { test } from "node:test";
import { buildListeningAnalyticsAggregation } from "../listeningAnalyticsAggregation";

const baseSectionResults = [
  {
    sectionId: "s1",
    sectionNo: 1,
    attempted: 3,
    correct: 2,
    incorrect: 1,
    unanswered: 0,
    accuracy: 66.67,
    challengeTags: ["detail"],
    perQuestion: [
      { questionId: "q1", responseTimeMs: 1200, replayCount: 1, answerChangeCount: 0, correct: true },
      { questionId: "q2", responseTimeMs: 2400, replayCount: 0, answerChangeCount: 1, correct: false },
      { questionId: "q3", responseTimeMs: 0, replayCount: 2, answerChangeCount: 0, unanswered: true },
    ],
  },
];

test("analytics aggregation builds deterministic idempotency key and marks rerunnable", () => {
  const run = buildListeningAnalyticsAggregation({
    sectionResults: baseSectionResults,
    schemaVersion: "1.0.0",
    source: "finalize",
  });

  assert.equal(run.analytics.schemaVersion, "1.0.0");
  assert.equal(run.analytics.sections.length, 1);
  assert.equal(run.analytics.session.playback.replayTotal, 3);
  assert.equal(run.analytics.session.timing.count, 2);
  assert.equal(run.aggregation.rerunnable, true);
  assert.match(String(run.aggregation.idempotencyKey), /^listening_analytics:1\.0\.0:[a-f0-9]{16}$/);
  assert.equal(run.aggregation.runCount, 1);
  assert.equal(run.aggregation.lastStatus, "computed");
  assert.equal(run.skipped, false);
});

test("analytics aggregation rerun with same payload is idempotent noop", () => {
  const initial = buildListeningAnalyticsAggregation({
    sectionResults: baseSectionResults,
    schemaVersion: "1.0.0",
    source: "finalize",
  });
  const rerun = buildListeningAnalyticsAggregation({
    sectionResults: baseSectionResults,
    schemaVersion: "1.0.0",
    source: "manual_rebuild",
    previousAggregation: initial.aggregation,
  });

  assert.equal(rerun.aggregation.idempotencyKey, initial.aggregation.idempotencyKey);
  assert.equal(rerun.aggregation.inputDigest, initial.aggregation.inputDigest);
  assert.equal(rerun.aggregation.runCount, initial.aggregation.runCount);
  assert.equal(rerun.aggregation.lastStatus, "noop");
  assert.equal(rerun.skipped, true);
});

test("analytics aggregation changes idempotency key when section payload changes", () => {
  const initial = buildListeningAnalyticsAggregation({
    sectionResults: baseSectionResults,
    schemaVersion: "1.0.0",
    source: "finalize",
  });
  const changed = buildListeningAnalyticsAggregation({
    sectionResults: [
      {
        ...baseSectionResults[0],
        correct: 3,
        accuracy: 100,
      },
    ],
    schemaVersion: "1.0.0",
    source: "manual_rebuild",
    previousAggregation: initial.aggregation,
  });

  assert.notEqual(changed.aggregation.idempotencyKey, initial.aggregation.idempotencyKey);
  assert.equal(changed.aggregation.runCount, initial.aggregation.runCount + 1);
  assert.equal(changed.aggregation.lastStatus, "computed");
  assert.equal(changed.skipped, false);
});
