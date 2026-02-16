import { z } from "zod";

export const listeningSectionSegmentSchema = z.object({
  segment_id: z.string().min(1),
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  segment_no: z.number().int().positive(),
  transcript_text: z.string().min(1),
  predicted_duration_seconds: z.number().int().positive(),
  stable_id: z.string().min(1),
  linkage: z.object({
    previous_segment_id: z.string().min(1).nullable(),
    next_segment_id: z.string().min(1).nullable(),
    blueprint_id: z.string().min(1),
  }),
  difficulty: z.string().min(1),
  difficulty_confidence: z.number().min(0).max(1),
  accent_plan: z.object({
    accent: z.string().min(1),
    voice_hint: z.string().min(1).optional(),
  }),
});

export type ListeningSectionSegment = z.infer<typeof listeningSectionSegmentSchema>;

export const listeningAnchorSchema = z.object({
  anchor_id: z.string().min(1),
  segment_no: z.number().int().positive(),
  offset_seconds: z.number().nonnegative(),
  label: z.string().min(1),
  question_range: z
    .object({
      from: z.number().int().positive(),
      to: z.number().int().positive(),
    })
    .optional(),
});

export type ListeningAnchor = z.infer<typeof listeningAnchorSchema>;

export const continuityIssueSchema = z.object({
  issue_type: z.enum(["entity_mismatch", "fact_mismatch", "timeline_break", "coherence_break"]),
  severity: z.enum(["low", "high"]),
  segment_refs: z.array(z.number().int().positive()).min(1),
  message: z.string().min(1),
  remediation_hint: z.string().min(1),
});

export type ContinuityIssue = z.infer<typeof continuityIssueSchema>;

export const continuityReportSchema = z.object({
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  issues: z.array(continuityIssueSchema),
  coherence_score: z.number().min(0).max(1),
});

export type ContinuityReport = z.infer<typeof continuityReportSchema>;
