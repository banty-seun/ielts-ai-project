import test from "node:test";
import assert from "node:assert/strict";

test("performance coach builds section-aware weakness profile and closed-loop adoption flags", async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "dummy";
  process.env.LISTENING_COACH_LLM_ENHANCE = "false";

  const { buildListeningPerformanceAnalysis } = await import("../listeningPerformanceCoach");
  const { storage } = await import("../../storage");
  const originalGetRecent = storage.getRecentTaskProgressBySkill.bind(storage);
  const originalGetStudyPlans = storage.getStudyPlansByUserId.bind(storage);
  (storage as any).getRecentTaskProgressBySkill = async () => [];
  (storage as any).getStudyPlansByUserId = async () => [
    {
      id: "plan-1",
      userId: "user-1",
      targetBandScore: "8.0",
      skillRatings: { listening: 6 },
      updatedAt: new Date("2026-01-15T10:00:00.000Z"),
      createdAt: new Date("2026-01-10T10:00:00.000Z"),
    },
  ];

  try {
    const task = {
      id: "task-coach-1",
      userId: "user-1",
      weeklyPlanId: "weekly-1",
      taskTitle: "Listening practice",
      skill: "listening",
      accent: "Canadian",
      difficulty: "Band 7",
      questions: [
        { id: "s1q1", tags: ["numbers"], sectionNo: 1 },
        { id: "s1q2", tags: ["numbers"], sectionNo: 1 },
        { id: "s2q3", tags: ["maps"], sectionNo: 2 },
        { id: "s2q4", tags: ["maps"], sectionNo: 2 },
      ],
      progressData: {
        sessionOrder: 1,
        performanceCoach: {
          adoptedRecommendations: [
            {
              sourceAnalysisId: "source:attempt:1.0.0",
              sourceTaskProgressId: "task-source",
              focus: "number_capture",
            },
          ],
        },
      },
    } as any;

    const analysis = await buildListeningPerformanceAnalysis({
      task,
      attemptId: "attempt-1",
      score: { correct: 1, total: 4, percent: 25 },
      outcomes: [
        {
          questionId: "s1q1",
          questionNo: 1,
          sectionNo: 1,
          isCorrect: false,
          responseTimeMs: 12000,
          answerChangeCount: 1,
          replayCount: 2,
          unanswered: false,
        },
        {
          questionId: "s1q2",
          questionNo: 2,
          sectionNo: 1,
          isCorrect: false,
          responseTimeMs: 11000,
          answerChangeCount: 0,
          replayCount: 1,
          unanswered: false,
        },
        {
          questionId: "s2q3",
          questionNo: 3,
          sectionNo: 2,
          isCorrect: false,
          responseTimeMs: 10000,
          answerChangeCount: 1,
          replayCount: 1,
          unanswered: false,
        },
        {
          questionId: "s2q4",
          questionNo: 4,
          sectionNo: 2,
          isCorrect: true,
          responseTimeMs: 9000,
          answerChangeCount: 0,
          replayCount: 0,
          unanswered: false,
        },
      ],
    });

    assert.equal(analysis.weakness_profile.length > 0, true);
    assert.equal(analysis.weakness_profile[0]?.affected_sections.length > 0, true);
    assert.equal(analysis.next_practice_set.length > 0, true);
    assert.equal(analysis.next_practice_set[0]?.accent, "British");
    assert.notEqual(analysis.next_practice_set[0]?.accent, "Canadian");
    assert.equal(analysis.next_practice_set[0]?.difficulty, "hard");
    assert.equal(typeof analysis.behavior_signals.unanswered_rate, "number");
    assert.equal(typeof analysis.behavior_signals.replay_rate, "number");
    assert.equal(typeof analysis.behavior_signals.answer_change_rate, "number");
    assert.equal(Array.isArray(analysis.trend.section_tag_dimensions), true);
    assert.equal(analysis.trend.section_tag_dimensions.length > 0, true);
    assert.equal(analysis.trend.section_tag_dimensions[0]?.section_no > 0, true);
    assert.equal(analysis.closed_loop.recommendation_adopted, true);
    assert.equal(analysis.closed_loop.source_analysis_id, "task-coach-1:attempt-1:1.0.0");
  } finally {
    (storage as any).getRecentTaskProgressBySkill = originalGetRecent;
    (storage as any).getStudyPlansByUserId = originalGetStudyPlans;
  }
});
