import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContinuityReport } from "../listeningContinuity";

const blueprint = {
  blueprint_id: "bp-1",
  blueprint_version: 1,
  section_id: "sec-1",
  section_no: 1,
  context_type: "educational_lecture",
  entities: [
    { id: "e1", name: "Dr. Ahmed", role: "presenter" },
  ],
  timeline: [
    { id: "t1", label: "Opening briefing", order: 1 },
    { id: "t2", label: "Lab safety reminder", order: 2 },
    { id: "t3", label: "Final instructions", order: 3 },
  ],
  facts: [
    { id: "f1", text: "The lecture starts at nine thirty." },
    { id: "f2", text: "Students must submit forms by Friday." },
    { id: "f3", text: "The chemistry lab is in Building C." },
  ],
  roles: ["presenter", "audience"],
  accent_plan: {
    default_accent: "British",
    segment_accents: [
      { segment_no: 1, accent: "British" },
      { segment_no: 2, accent: "British" },
      { segment_no: 3, accent: "British" },
    ],
  },
  topic_domain: "Chemistry",
  context_label: "University orientation lecture",
  scenario_overview: "Students receive final lab instructions",
  script_type: "monologue",
  created_at: new Date().toISOString(),
} as const;

test("continuity report surfaces timeline and supplemental metadata issues", () => {
  const report = buildContinuityReport({
    blueprint: blueprint as any,
    segments: [
      {
        segment_id: "s1",
        section_id: "sec-1",
        section_no: 1,
        segment_no: 1,
        transcript_text: "Welcome everyone. Today we discuss campus events and lunch options.",
        predicted_duration_seconds: 150,
        stable_id: "stable-1",
        linkage: { previous_segment_id: null, next_segment_id: "s2", blueprint_id: "bp-1" },
        difficulty: "Band 6.5",
        difficulty_confidence: 0.8,
        accent_plan: { accent: "British" },
      },
      {
        segment_id: "s2",
        section_id: "sec-1",
        section_no: 1,
        segment_no: 2,
        transcript_text: "Now we move to transport schedules with no reference to previous details.",
        predicted_duration_seconds: 150,
        stable_id: "stable-2",
        linkage: { previous_segment_id: "s1", next_segment_id: "s3", blueprint_id: "bp-1" },
        difficulty: "Band 6.5",
        difficulty_confidence: 0.8,
        accent_plan: { accent: "British" },
      },
      {
        segment_id: "s3",
        section_id: "sec-1",
        section_no: 1,
        segment_no: 3,
        transcript_text: "Finally we discuss sports clubs and weekend activities.",
        predicted_duration_seconds: 150,
        stable_id: "stable-3",
        linkage: { previous_segment_id: "s2", next_segment_id: null, blueprint_id: "bp-1" },
        difficulty: "Band 6.5",
        difficulty_confidence: 0.8,
        accent_plan: { accent: "British" },
      },
    ],
  });

  assert.equal(report.section_id, "sec-1");
  assert.ok(report.issues.some((issue) => issue.issue_type === "timeline_break"));
  assert.ok(report.issues.some((issue) => issue.message.includes("Supplemental continuity signal missing")));
  assert.ok(report.coherence_score < 1);
});
