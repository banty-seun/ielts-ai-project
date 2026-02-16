import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSectionManifestFromTask, buildTaskManifestReferences } from "../listeningManifest";

test("manifest references include anchor version when anchors exist", () => {
  const refs = buildTaskManifestReferences({
    id: "task-1",
    progressData: {
      listeningAnchors: {
        updated_at: "2026-02-10T10:00:00.000Z",
      },
    },
  } as any);

  assert.ok(refs.anchors_url.includes("/api/listening/sections/task-1/anchors.json"));
  assert.ok(refs.anchors_url.includes("v="));
});

test("manifest build metadata uses persisted question-contract build id", () => {
  const manifest = buildSectionManifestFromTask({
    id: "task-2",
    accent: "British",
    audioUrl: "https://example.com/audio.mp3",
    duration: 120,
    questions: [
      {
        id: "q1",
        question: "What is the answer?",
        options: [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
          { id: "C", text: "C" },
          { id: "D", text: "D" },
        ],
        correctAnswer: "A",
        tags: ["detail"],
      },
    ],
    progressData: {
      sessionOrder: 1,
      listeningQuestionContract: {
        build_id: "qbp_persisted_1",
        section_no: 1,
        block_plan: {
          build_id: "qbp_persisted_1",
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
        question_order: ["q1"],
        question_number_map: { q1: 1 },
        question_count: 1,
      },
    },
  } as any);

  assert.equal(manifest.build_metadata.build_id, "qbp_persisted_1");
});
