import test from "node:test";
import assert from "node:assert/strict";
import { resolveListeningQuestionContract } from "../listeningQuestionContractState";

test("preserves existing question order for stable numbering", () => {
  const task = {
    id: "task-1",
    ieltsPart: 1,
    contextLabel: "everyday social conversation",
    questions: [
      {
        id: "q1",
        question: "First question",
        options: [
          { id: "A", text: "A1" },
          { id: "B", text: "B1" },
          { id: "C", text: "C1" },
          { id: "D", text: "D1" },
        ],
        correctAnswer: "A",
        tags: ["detail"],
      },
      {
        id: "q2",
        question: "Second question",
        options: [
          { id: "A", text: "A2" },
          { id: "B", text: "B2" },
          { id: "C", text: "C2" },
          { id: "D", text: "D2" },
        ],
        correctAnswer: "B",
        tags: ["detail"],
      },
    ],
    progressData: {
      sessionOrder: 1,
      listeningQuestionContract: {
        section_version: 1,
        published: false,
        section_no: 1,
        build_id: "blockplan_task-1",
        block_plan: {
          build_id: "blockplan_task-1",
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
              engine_type: "multi_select",
              instructions: "Choose all correct answers as instructed.",
            },
            {
              section_no: 1,
              block_no: 3,
              segment_no: 3,
              question_range: { from: 7, to: 10 },
              engine_type: "form_or_table_completion",
              instructions: "Complete the form or table with words from the audio.",
            },
          ],
        },
        question_order: ["q2", "q1"],
        question_number_map: { q2: 1, q1: 2 },
        question_count: 2,
      },
    },
  } as any;

  const result = resolveListeningQuestionContract(task);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.stableQuestions.map((q) => q.id), ["q2", "q1"]);
  assert.equal(result.blockPlan.build_id, "blockplan_task-1");
  assert.equal(result.changed, false);
});

test("appends new questions without renumbering existing ones", () => {
  const task = {
    id: "task-2",
    ieltsPart: 1,
    questions: [
      {
        id: "q1",
        question: "One",
        options: [
          { id: "A", text: "A1" },
          { id: "B", text: "B1" },
          { id: "C", text: "C1" },
          { id: "D", text: "D1" },
        ],
        correctAnswer: "A",
        tags: ["detail"],
      },
      {
        id: "q2",
        question: "Two",
        options: [
          { id: "A", text: "A2" },
          { id: "B", text: "B2" },
          { id: "C", text: "C2" },
          { id: "D", text: "D2" },
        ],
        correctAnswer: "B",
        tags: ["detail"],
      },
      {
        id: "q3",
        question: "Three",
        options: [
          { id: "A", text: "A3" },
          { id: "B", text: "B3" },
          { id: "C", text: "C3" },
          { id: "D", text: "D3" },
        ],
        correctAnswer: "C",
        tags: ["detail"],
      },
    ],
    progressData: {
      sessionOrder: 1,
      listeningQuestionContract: {
        section_version: 1,
        published: false,
        section_no: 1,
        build_id: "blockplan_task-2",
        question_order: ["q2", "q1"],
      },
    },
  } as any;

  const result = resolveListeningQuestionContract(task);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.stableQuestions.map((q) => q.id), ["q2", "q1", "q3"]);
  assert.equal(result.nextProgressData.listeningQuestionContract.question_number_map.q2, 1);
  assert.equal(result.nextProgressData.listeningQuestionContract.question_number_map.q1, 2);
  assert.equal(result.nextProgressData.listeningQuestionContract.question_number_map.q3, 3);
});

test("requires section version bump for published contract when question ids are removed", () => {
  const task = {
    id: "task-3",
    ieltsPart: 1,
    questions: [
      {
        id: "q1",
        question: "Only one remains",
        options: [
          { id: "A", text: "A1" },
          { id: "B", text: "B1" },
          { id: "C", text: "C1" },
          { id: "D", text: "D1" },
        ],
        correctAnswer: "A",
        tags: ["detail"],
      },
    ],
    progressData: {
      sessionOrder: 1,
      listeningQuestionContract: {
        section_no: 1,
        section_version: 1,
        published: true,
        build_id: "blockplan_task-3",
        question_order: ["q1", "q2"],
      },
    },
  } as any;

  const result = resolveListeningQuestionContract(task);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "QUESTION_CONTRACT_VERSION_BUMP_REQUIRED");
});

test("allows published contract question removals with explicit section version bump", () => {
  const task = {
    id: "task-4",
    ieltsPart: 1,
    questions: [
      {
        id: "q1",
        question: "Only one remains",
        options: [
          { id: "A", text: "A1" },
          { id: "B", text: "B1" },
          { id: "C", text: "C1" },
          { id: "D", text: "D1" },
        ],
        correctAnswer: "A",
        tags: ["detail"],
      },
    ],
    progressData: {
      sessionOrder: 1,
      listeningQuestionContractRequest: {
        section_version: 2,
      },
      listeningQuestionContract: {
        section_no: 1,
        section_version: 1,
        published: true,
        build_id: "blockplan_task-4",
        question_order: ["q1", "q2"],
      },
    },
  } as any;

  const result = resolveListeningQuestionContract(task);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.nextProgressData.listeningQuestionContract.section_version, 2);
});

test("preserves existing session artifacts when contract state is recalculated", () => {
  const task = {
    id: "task-5",
    ieltsPart: 1,
    questions: [
      {
        id: "q1",
        question: "Question one",
        options: [
          { id: "A", text: "A1" },
          { id: "B", text: "B1" },
          { id: "C", text: "C1" },
          { id: "D", text: "D1" },
        ],
        correctAnswer: "A",
        tags: ["detail"],
      },
    ],
    progressData: {
      sessionOrder: 1,
      sessionSummary: {
        scorePercent: 75,
        strengths: ["Solid on detail"],
      },
      mixedEngineOutcomes: [
        {
          questionId: "q1",
          isCorrect: true,
          normalizationAudit: {
            mode: "lenient",
            numericHandling: "normalize",
            submitted: "12 500",
            accepted: ["12 500"],
          },
        },
      ],
      listeningQuestionContract: {
        section_no: 1,
        section_version: 1,
        published: false,
        build_id: "blockplan_task-5",
        question_order: ["q1"],
      },
    },
  } as any;

  const result = resolveListeningQuestionContract(task);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.nextProgressData.sessionSummary, task.progressData.sessionSummary);
  assert.deepEqual(result.nextProgressData.mixedEngineOutcomes, task.progressData.mixedEngineOutcomes);
});
