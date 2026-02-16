import test from "node:test";
import assert from "node:assert/strict";
import { listeningEngineAdapters } from "../listeningQuestionAdapters";
import type { QuestionBlockPlanSet } from "@shared/listening";

test("non-mcq adapter generate returns structured not-implemented error", async () => {
  const emptyPlan: QuestionBlockPlanSet = {
    build_id: "plan-0",
    section_no: 1,
    context_type: "everyday_social_conversation",
    plans: [
      {
        section_no: 1,
        block_no: 1,
        segment_no: 1,
        question_range: { from: 1, to: 3 },
        engine_type: "mcq_single",
        instructions: "Choose one correct answer.",
      },
      {
        section_no: 1,
        block_no: 2,
        segment_no: 2,
        question_range: { from: 4, to: 6 },
        engine_type: "mcq_single",
        instructions: "Choose one correct answer.",
      },
      {
        section_no: 1,
        block_no: 3,
        segment_no: 3,
        question_range: { from: 7, to: 10 },
        engine_type: "mcq_single",
        instructions: "Choose one correct answer.",
      },
    ],
  };

  const blocks = await listeningEngineAdapters.multi_select.generate({
    sectionId: "section-1",
    sectionNo: 1,
    plan: emptyPlan,
    scriptText: "sample script",
  });
  assert.equal(blocks.length, 0);
});

test("non-mcq adapter generate builds block payload from plan", async () => {
  const plan: QuestionBlockPlanSet = {
    build_id: "plan-1",
    section_no: 1,
    context_type: "everyday_social_conversation",
    plans: [
      {
        section_no: 1,
        block_no: 1,
        segment_no: 1,
        question_range: { from: 1, to: 3 },
        engine_type: "multi_select",
        instructions: "Select two answers.",
      },
      {
        section_no: 1,
        block_no: 2,
        segment_no: 2,
        question_range: { from: 4, to: 6 },
        engine_type: "mcq_single",
        instructions: "Choose one correct answer.",
      },
      {
        section_no: 1,
        block_no: 3,
        segment_no: 3,
        question_range: { from: 7, to: 10 },
        engine_type: "mcq_single",
        instructions: "Choose one correct answer.",
      },
    ],
  };

  const blocks = await listeningEngineAdapters.multi_select.generate({
    sectionId: "section-1",
    sectionNo: 1,
    plan,
    scriptText: "The speaker explains requirements. Choose the right options.",
  });

  assert.equal(blocks.length, 1);
  const block = blocks[0] as any;
  assert.equal(block.engine, "multi_select");
  assert.equal(block.questions.length, 3);
  assert.ok(Array.isArray(block.questions[0].options));
  assert.equal(block.questions[0].answer_key, "A,C");
});
