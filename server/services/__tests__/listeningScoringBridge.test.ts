import test from "node:test";
import assert from "node:assert/strict";
import { scoreMixedEngineAttempt } from "../listeningScoringBridge";
import type { AnswerKey } from "@shared/listening";

test("scores mixed-engine section with standardized outcomes and histogram", () => {
  const answerKey: AnswerKey = {
    version: "1.0.0",
    section_id: "section-mixed-1",
    entries: [
      {
        kind: "single_choice",
        question_id: "q1",
        accepted_option_ids: ["B"],
        tags: ["detail"],
      },
      {
        kind: "text",
        question_id: "q2",
        accepted_texts: ["12,500"],
        normalization: {
          mode: "lenient",
          numeric_handling: "normalize",
        },
        tags: ["numbers", "spelling_capture"],
      },
      {
        kind: "matching",
        question_id: "q3",
        accepted_pairs: [
          { left: "1", right: "C" },
          { left: "2", right: "A" },
        ],
        ordered: false,
        tags: ["matching_pair_confusion"],
      },
    ],
  };

  const result = scoreMixedEngineAttempt({
    answerKey,
    answers: [
      { question_id: "q1", value: "B" },
      { question_id: "q2", value: "12 500" },
      {
        question_id: "q3",
        value: [
          { left: "1", right: "C" },
          { left: "2", right: "D" },
        ],
      },
    ],
  });

  assert.equal(result.correct, 2);
  assert.equal(result.total, 3);
  assert.equal(result.percent, 67);
  assert.equal(result.outcomes.length, 3);
  assert.equal(result.outcomes[0]?.questionId, "q1");
  assert.equal(result.outcomes[0]?.isCorrect, true);
  assert.equal(result.outcomes[1]?.normalizationAudit?.mode, "lenient");
  assert.equal(result.outcomes[1]?.normalizationAudit?.numericHandling, "normalize");
  assert.ok(Array.isArray(result.outcomes[1]?.normalizationAudit?.accepted));
  assert.equal(result.outcomes[2]?.questionId, "q3");
  assert.equal(result.outcomes[2]?.isCorrect, false);

  assert.deepEqual(result.histogram.detail, { correct: 1, total: 1 });
  assert.deepEqual(result.histogram.numbers, { correct: 1, total: 1 });
  assert.deepEqual(result.histogram.matching_pair_confusion, { correct: 0, total: 1 });
  assert.equal(result.sessionFeedback.trend, "flat");
  assert.ok(result.sessionFeedback.strengths.length > 0);
  assert.ok(result.sessionFeedback.focusNext.length > 0);
});
