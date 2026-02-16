import test from "node:test";
import assert from "node:assert/strict";
import { createQuestionBlockPlan } from "../listeningQuestionPlanner";
import { buildQuestionRangesFromDistribution } from "../segmentOrder";

test("planner builds deterministic 3+3+4 block plan", () => {
  const plan = createQuestionBlockPlan({
    sectionNo: 1,
    contextType: "everyday_social_conversation",
    distribution: [3, 3, 4],
    buildId: "plan-334",
  });

  assert.equal(plan.build_id, "plan-334");
  assert.equal(plan.plans.length, 3);
  assert.deepEqual(
    plan.plans.map((p) => p.question_range),
    [
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 10 },
    ],
  );
  assert.deepEqual(
    plan.plans.map((p) => p.segment_no),
    [1, 2, 3],
  );
});

test("planner builds deterministic 4+3+3 block plan", () => {
  const plan = createQuestionBlockPlan({
    sectionNo: 2,
    contextType: "everyday_social_monologue",
    distribution: [4, 3, 3],
    buildId: "plan-433",
  });

  assert.equal(plan.build_id, "plan-433");
  assert.deepEqual(
    plan.plans.map((p) => p.question_range),
    [
      { from: 1, to: 4 },
      { from: 5, to: 7 },
      { from: 8, to: 10 },
    ],
  );
});

test("segment-order distribution utility throws on incomplete question coverage", () => {
  assert.throws(
    () => buildQuestionRangesFromDistribution([3, 3, 3], 10),
    /QUESTION_BLOCK_COVERAGE_INCOMPLETE/,
  );
});

test("planner uses context-aware default engine mix", () => {
  const plan = createQuestionBlockPlan({
    sectionNo: 4,
    contextType: "educational_lecture",
    distribution: [3, 3, 4],
    buildId: "plan-context-default",
  });

  assert.deepEqual(
    plan.plans.map((p) => p.engine_type),
    ["sentence_or_note_completion", "map_or_diagram_labeling", "mcq_single"],
  );
});

test("planner rejects context-incompatible engine combinations", () => {
  assert.throws(
    () =>
      createQuestionBlockPlan({
        sectionNo: 4,
        contextType: "educational_lecture",
        distribution: [3, 3, 4],
        engineMix: ["form_or_table_completion", "matching_letters", "mcq_single"],
        buildId: "plan-context-invalid",
      }),
    /INCOMPATIBLE_ENGINE_FOR_CONTEXT:educational_lecture:/,
  );
});
