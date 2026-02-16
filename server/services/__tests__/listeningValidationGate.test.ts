import test from "node:test";
import assert from "node:assert/strict";
import { runListeningValidationGate } from "../listeningValidationGate";

const buildTask = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "task_1",
    userId: "user_1",
    weeklyPlanId: "plan_1",
    weekNumber: 1,
    dayNumber: 1,
    taskTitle: "Listening Practice",
    skill: "listening",
    status: "in-progress",
    scriptText: "This is a sufficiently long transcript text for validation gate checks. ".repeat(25),
    audioUrl: "https://example.com/audio.mp3",
    duration: 120,
    accent: "British",
    questions: Array.from({ length: 10 }, (_, idx) => ({
      id: `q${idx + 1}`,
      question: `Question ${idx + 1}`,
      options: [
        { id: "A", text: "A" },
        { id: "B", text: "B" },
        { id: "C", text: "C" },
        { id: "D", text: "D" },
      ],
      correctAnswer: "A",
      tags: ["general"],
    })),
    progressData: {
      sessionOrder: 1,
      sectionAudioAssets: [
        {
          segment_no: 1,
          url: "https://example.com/audio.mp3",
          duration_seconds: 120,
          retrieval_verified: true,
          status: "success",
        },
      ],
      segments: [
        {
          id: "seg_1",
          ieltsPart: 1,
          estimatedDurationSec: 120,
          transcript: "Segment transcript",
          audioUrl: "https://example.com/audio.mp3",
        },
      ],
      segmentAssignments: {
        seg_1: Array.from({ length: 10 }, (_, idx) => `q${idx + 1}`),
      },
      listeningQuestionContractState: {
        schema_version: "1.0.0",
        section_id: "task_1",
        section_no: 1,
        renderer_payload: {
          renderer_schema_version: "1.0.0",
          section_id: "task_1",
          section_no: 1,
          blocks: [
            {
              block_id: "task_1-block-1",
              block_title: "Questions 1-10",
              instructions: "Choose one answer.",
              question_range: { from: 1, to: 10 },
              segment_no: 1,
              engine: "legacy_mcq",
              questions: Array.from({ length: 10 }, (_, idx) => ({
                question_id: `q${idx + 1}`,
                prompt: `Question ${idx + 1}`,
                options: [
                  { id: "A", label: "A" },
                  { id: "B", label: "B" },
                  { id: "C", label: "C" },
                  { id: "D", label: "D" },
                ],
                answer_key: "A",
                tags: ["general"],
              })),
              render_hints: {},
            },
          ],
        },
        answer_key: {
          section_id: "task_1",
          section_no: 1,
          entries: Array.from({ length: 10 }, (_, idx) => ({
            question_id: `q${idx + 1}`,
            answers: ["A"],
          })),
        },
        block_plan: {
          build_id: "bp_1",
          section_no: 1,
          context_type: "everyday_social_conversation",
          plans: [],
        },
        issues: [],
        published: false,
      },
      listeningSegments: {
        prompt: {
          prompt_id: "listening.segment.generation",
          version: "1.0.0",
          prompt_registry_id: "listening.segment.generation@1.0.0",
          status: "approved",
          owner: "platform_ai",
          approved_at: "2026-01-01T00:00:00.000Z",
          model_id: "gpt-4o-mini",
        },
      },
    },
    ...overrides,
  }) as any;

test("validation gate passes baseline valid section payload", () => {
  const result = runListeningValidationGate({
    task: buildTask(),
    sectionNo: 1,
  });
  assert.equal(result.report.verdict, "PASS");
});

test("validation gate fails with ASSET_UNREACHABLE when asset verification fails", () => {
  const task = buildTask({
    progressData: {
      ...buildTask().progressData,
      sectionAudioAssets: [
        {
          segment_no: 1,
          url: "https://example.com/audio.mp3",
          duration_seconds: 120,
          retrieval_verified: false,
          status: "success",
        },
      ],
    },
  });
  const result = runListeningValidationGate({
    task,
    sectionNo: 1,
  });
  assert.equal(result.report.verdict, "FAIL");
  const failing = result.report.gates.find((gate) => gate.error_code === "ASSET_UNREACHABLE");
  assert.equal(Boolean(failing), true);
});

test("validation gate fails question coverage when segment order references unknown question", () => {
  const task = buildTask({
    progressData: {
      ...buildTask().progressData,
      segmentOrder: {
        seg_1: ["q1", "q2", "q3", "q_missing"],
      },
    },
  });
  const result = runListeningValidationGate({
    task,
    sectionNo: 1,
  });
  assert.equal(result.report.verdict, "FAIL");
  const failing = result.report.gates.find((gate) => gate.gate_name === "question_coverage");
  assert.equal(failing?.error_code, "QUESTION_COVERAGE_INVALID");
  const orderIssues = (failing?.diagnostics as any)?.order_issues ?? [];
  assert.equal(orderIssues.length > 0, true);
});

test("validation gate fails answer key completeness with unresolved question ids", () => {
  const base = buildTask();
  const questions = Array.isArray(base.questions) ? base.questions : [];
  const task = buildTask({
    questions: questions.map((question: any, idx: number) => ({
      ...question,
      correctAnswer: idx === 0 ? "Z" : "A",
    })),
  });

  const result = runListeningValidationGate({
    task,
    sectionNo: 1,
  });
  assert.equal(result.report.verdict, "FAIL");
  const failing = result.report.gates.find((gate) => gate.gate_name === "answer_key_completeness");
  assert.equal(failing?.error_code, "ANSWER_KEY_MISSING");
  const unresolved = (failing?.diagnostics as any)?.unresolved_question_ids ?? [];
  assert.equal(Array.isArray(unresolved), true);
  assert.equal(unresolved.length > 0, true);
});
