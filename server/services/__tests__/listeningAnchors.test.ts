import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAnchorTimingBounds, validateAnchorsForSection } from "../listeningAnchors";

test("anchor timing validator rejects out-of-range offsets", () => {
  const result = validateAnchorTimingBounds(
    [
      {
        anchor_id: "a1",
        segment_no: 1,
        offset_seconds: 200,
        label: "Start",
      },
    ],
    [
      {
        segment_id: "s1",
        section_id: "sec-1",
        section_no: 1,
        segment_no: 1,
        transcript_text: "Transcript",
        predicted_duration_seconds: 150,
        stable_id: "stable-1",
        linkage: {
          previous_segment_id: null,
          next_segment_id: null,
          blueprint_id: "bp-1",
        },
        difficulty: "Band 6.5",
        difficulty_confidence: 0.8,
        accent_plan: { accent: "British" },
      },
    ],
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
});

test("anchor validator fails when configured block has no matching anchor", () => {
  const result = validateAnchorsForSection({
    task: {
      id: "task-1",
      userId: "user-1",
      weeklyPlanId: 1,
      progressData: {
        listeningQuestionContract: {
          block_plan: {
            plans: [
              {
                segment_no: 1,
                question_range: { from: 1, to: 3 },
              },
              {
                segment_no: 2,
                question_range: { from: 4, to: 6 },
              },
            ],
          },
        },
      },
    } as any,
    anchors: [
      {
        anchor_id: "anchor-1",
        segment_no: 1,
        offset_seconds: 0,
        label: "Segment 1",
        question_range: { from: 1, to: 3 },
      },
    ],
    segments: [
      {
        segment_id: "s1",
        section_id: "sec-1",
        section_no: 1,
        segment_no: 1,
        transcript_text: "Transcript one",
        predicted_duration_seconds: 150,
        stable_id: "stable-1",
        linkage: {
          previous_segment_id: null,
          next_segment_id: "s2",
          blueprint_id: "bp-1",
        },
        difficulty: "Band 6.5",
        difficulty_confidence: 0.8,
        accent_plan: { accent: "British" },
      },
      {
        segment_id: "s2",
        section_id: "sec-1",
        section_no: 1,
        segment_no: 2,
        transcript_text: "Transcript two",
        predicted_duration_seconds: 150,
        stable_id: "stable-2",
        linkage: {
          previous_segment_id: "s1",
          next_segment_id: null,
          blueprint_id: "bp-1",
        },
        difficulty: "Band 6.5",
        difficulty_confidence: 0.8,
        accent_plan: { accent: "British" },
      },
    ] as any,
  });

  assert.equal(result.ok, false);
  assert.ok(result.coverageErrors.some((error) => error.includes("MISSING_ANCHOR_FOR_CONFIGURED_BLOCK")));
});
