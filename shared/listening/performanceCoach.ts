import { z } from "zod";
import { listeningScoringTagSchema } from "./questionContracts";
import { listeningEvidenceReferenceSchema, listeningGovernanceProvenanceSchema } from "./governance";

export const weaknessSeveritySchema = z.enum(["low", "medium", "high"]);
export type WeaknessSeverity = z.infer<typeof weaknessSeveritySchema>;

export const weaknessProfileEntrySchema = z.object({
  tag: listeningScoringTagSchema,
  severity: weaknessSeveritySchema,
  evidence_questions: z.array(z.number().int().positive()).default([]),
  affected_sections: z.array(z.number().int().positive()).default([]),
  confidence: z.number().min(0).max(1),
});
export type WeaknessProfileEntry = z.infer<typeof weaknessProfileEntrySchema>;

export const behaviorSignalSectionSummarySchema = z.object({
  section_no: z.number().int().positive(),
  avg_response_latency_ms: z.number().nullable(),
  avg_response_latency_sec: z.number().nullable(),
  answer_changes: z.number().int().nonnegative(),
  replay_count: z.number().int().nonnegative(),
  unanswered_count: z.number().int().nonnegative(),
  question_count: z.number().int().positive(),
  answer_change_rate: z.number().min(0),
  replay_rate: z.number().min(0),
  unanswered_rate: z.number().min(0).max(1),
});
export type BehaviorSignalSectionSummary = z.infer<typeof behaviorSignalSectionSummarySchema>;

export const behaviorSignalSummarySchema = z.object({
  avg_response_latency_ms: z.number().nullable(),
  avg_response_latency_sec: z.number().nullable(),
  answer_changes: z.number().int().nonnegative(),
  replay_count: z.number().int().nonnegative(),
  unanswered_count: z.number().int().nonnegative(),
  question_count: z.number().int().nonnegative(),
  answer_change_rate: z.number().min(0),
  replay_rate: z.number().min(0),
  unanswered_rate: z.number().min(0).max(1),
  section_rollups: z.array(behaviorSignalSectionSummarySchema).default([]),
});
export type BehaviorSignalSummary = z.infer<typeof behaviorSignalSummarySchema>;

export const rootCauseTypeSchema = z.enum(["skill_gap", "behavior_pattern", "mixed"]);
export type RootCauseType = z.infer<typeof rootCauseTypeSchema>;

export const rootCauseInsightSchema = z.object({
  type: rootCauseTypeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  needs_more_data: z.boolean().default(false),
});
export type RootCauseInsight = z.infer<typeof rootCauseInsightSchema>;

export const trendDirectionSchema = z.enum(["up", "down", "flat"]);
export type TrendDirection = z.infer<typeof trendDirectionSchema>;

export const driftAlertSchema = z.object({
  tag: listeningScoringTagSchema,
  delta_points: z.number(),
  confidence: z.number().min(0).max(1),
});
export type DriftAlert = z.infer<typeof driftAlertSchema>;

export const listeningTrendAnalysisSchema = z.object({
  direction: trendDirectionSchema,
  confidence: z.number().min(0).max(1),
  data_window_size: z.number().int().nonnegative(),
  drift_alerts: z.array(driftAlertSchema).default([]),
  section_tag_dimensions: z.array(
    z.object({
      section_no: z.number().int().positive(),
      tag: listeningScoringTagSchema,
      direction: trendDirectionSchema,
      delta_points: z.number(),
      confidence: z.number().min(0).max(1),
    }),
  ).default([]),
});
export type ListeningTrendAnalysis = z.infer<typeof listeningTrendAnalysisSchema>;

export const strategyEvidenceSchema = z.object({
  section_ids: z.array(z.number().int().positive()).default([]),
  question_ids: z.array(z.number().int().positive()).default([]),
  section_id: z.string().min(1).optional(),
  part_id: z.number().int().positive().optional(),
  error_tags: z.array(listeningScoringTagSchema).default([]),
});
export type StrategyEvidence = z.infer<typeof strategyEvidenceSchema>;

export const personalizedStrategySchema = z.object({
  title: z.string().min(1),
  action: z.string().min(1),
  rationale: z.string().min(1),
  linked_weakness_tags: z.array(listeningScoringTagSchema).min(1),
  expected_outcome: z.string().min(1),
  evidence: strategyEvidenceSchema,
  evidence_refs: z.array(listeningEvidenceReferenceSchema).min(1),
  priority: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
});
export type PersonalizedStrategy = z.infer<typeof personalizedStrategySchema>;

export const recommendationDifficultySchema = z.enum(["easy", "medium", "hard"]);
export type RecommendationDifficulty = z.infer<typeof recommendationDifficultySchema>;

export const nextPracticeRecommendationSchema = z.object({
  focus: z.string().min(1),
  difficulty: recommendationDifficultySchema,
  accent: z.string().min(1),
  count: z.number().int().positive(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  severity: weaknessSeveritySchema,
});
export type NextPracticeRecommendation = z.infer<typeof nextPracticeRecommendationSchema>;

export const coachingFallbackSchema = z.object({
  summary: z.string().nullable(),
  actions: z.array(z.string()).default([]),
  used: z.boolean().default(false),
  reason_code: z.string().nullable().optional(),
});
export type CoachingFallback = z.infer<typeof coachingFallbackSchema>;

export const closedLoopLinkageSchema = z.object({
  source_analysis_id: z.string().min(1),
  updated_plan_items: z.array(z.string()).default([]),
  recommendation_adopted: z.boolean(),
  trend_impact: trendDirectionSchema,
  loop_break_metric: z.string().nullable(),
});
export type ClosedLoopLinkage = z.infer<typeof closedLoopLinkageSchema>;

export const listeningPerformanceAnalysisSchema = z.object({
  analysis_version: z.string().min(1),
  generated_at: z.string().datetime(),
  session_id: z.string().min(1),
  attempt_id: z.string().min(1),
  weakness_profile: z.array(weaknessProfileEntrySchema),
  behavior_signals: behaviorSignalSummarySchema,
  root_cause: rootCauseInsightSchema,
  trend: listeningTrendAnalysisSchema,
  personalized_strategies: z.array(personalizedStrategySchema),
  specific_challenges: z.array(z.string().min(1)),
  next_practice_set: z.array(nextPracticeRecommendationSchema),
  fallback: coachingFallbackSchema,
  governance: listeningGovernanceProvenanceSchema.optional(),
  closed_loop: closedLoopLinkageSchema,
});
export type ListeningPerformanceAnalysis = z.infer<typeof listeningPerformanceAnalysisSchema>;

export const tutorAdjustmentRequestSchema = z.object({
  weekly_plan_id: z.string().nullable(),
  listening_session_id: z.string().min(1),
  attempt_id: z.string().min(1),
  source_analysis_id: z.string().min(1),
  weakness_profile: z.array(
    z.object({
      tag: listeningScoringTagSchema,
      severity: weaknessSeveritySchema,
      confidence: z.number().min(0).max(1),
    }),
  ),
  recommended_focus: z.array(z.string().min(1)).default([]),
});
export type TutorAdjustmentRequest = z.infer<typeof tutorAdjustmentRequestSchema>;
