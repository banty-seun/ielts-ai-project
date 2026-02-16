import assert from "node:assert/strict";
import { test } from "node:test";
import { runPromptQualityRegression } from "../listeningPromptRegression";

const longTranscript =
  "The university orientation begins at nine thirty in the main hall. " +
  "Students check in at the registration desk where staff provide maps and schedules. ".repeat(25);

test("prompt regression passes for structurally valid segment outputs", () => {
  const result = runPromptQualityRegression([
    {
      segment_id: "s1",
      section_id: "sec-1",
      section_no: 1,
      segment_no: 1,
      transcript_text: `In the university orientation, Dr. Ahmed greets the students and explains the day plan. ${longTranscript}`,
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
      transcript_text: `As mentioned earlier, Dr. Ahmed now reviews the safety rules in the same orientation session. ${longTranscript}`,
      predicted_duration_seconds: 155,
      stable_id: "stable-2",
      linkage: {
        previous_segment_id: "s1",
        next_segment_id: "s3",
        blueprint_id: "bp-1",
      },
      difficulty: "Band 6.5",
      difficulty_confidence: 0.82,
      accent_plan: { accent: "British" },
    },
    {
      segment_id: "s3",
      section_id: "sec-1",
      section_no: 1,
      segment_no: 3,
      transcript_text: `Following the safety briefing, the presenter concludes with final instructions for Friday submissions. ${longTranscript}`,
      predicted_duration_seconds: 148,
      stable_id: "stable-3",
      linkage: {
        previous_segment_id: "s2",
        next_segment_id: null,
        blueprint_id: "bp-1",
      },
      difficulty: "Band 6.5",
      difficulty_confidence: 0.85,
      accent_plan: { accent: "British" },
    },
  ]);
  assert.equal(result.ok, true);
});

test("prompt regression fails for invalid durations/transcript", () => {
  const result = runPromptQualityRegression([
    {
      segment_id: "s1",
      section_id: "sec-1",
      section_no: 1,
      segment_no: 1,
      transcript_text: "Too short.",
      predicted_duration_seconds: 50,
      stable_id: "stable-1",
      linkage: {
        previous_segment_id: null,
        next_segment_id: null,
        blueprint_id: "",
      },
      difficulty: "Band 6.5",
      difficulty_confidence: 0.8,
      accent_plan: { accent: "British" },
    },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.failures.length >= 3);
});

test("prompt regression fails when transition continuity and difficulty rubric are weak", () => {
  const isolatedTranscriptOne =
    "The railway office announces platform changes and departure notices for commuters. ".repeat(22);
  const isolatedTranscriptTwo =
    "The museum desk explains weekend ticket discounts, gallery passes, and closing times for tourists. ".repeat(22);
  const isolatedTranscriptThree =
    "The weather bulletin describes regional temperatures, rainfall forecasts, and coastal wind warnings. ".repeat(22);
  const result = runPromptQualityRegression([
    {
      segment_id: "s1",
      section_id: "sec-1",
      section_no: 1,
      segment_no: 1,
      transcript_text: isolatedTranscriptOne,
      predicted_duration_seconds: 145,
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
      transcript_text: isolatedTranscriptTwo,
      predicted_duration_seconds: 150,
      stable_id: "stable-2",
      linkage: {
        previous_segment_id: "s1",
        next_segment_id: "s3",
        blueprint_id: "bp-1",
      },
      difficulty: "",
      difficulty_confidence: 0.2,
      accent_plan: { accent: "British" },
    },
    {
      segment_id: "s3",
      section_id: "sec-1",
      section_no: 1,
      segment_no: 3,
      transcript_text: isolatedTranscriptThree,
      predicted_duration_seconds: 147,
      stable_id: "stable-3",
      linkage: {
        previous_segment_id: "s2",
        next_segment_id: null,
        blueprint_id: "bp-1",
      },
      difficulty: "Band 6.5",
      difficulty_confidence: 0.9,
      accent_plan: { accent: "British" },
    },
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("MISSING_DIFFICULTY_DECLARATION")));
  assert.ok(result.failures.some((failure) => failure.includes("DIFFICULTY_CONFIDENCE_OUT_OF_RUBRIC")));
  assert.ok(result.failures.some((failure) => failure.includes("MISSING_TRANSITION_CONTINUITY_SIGNAL")));
});
