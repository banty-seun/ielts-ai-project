import { z } from "zod";

export const validationGateNameSchema = z.enum([
  "transcript_quality",
  "renderer_schema",
  "question_coverage",
  "anchor_bounds",
  "duration_consistency",
  "answer_key_completeness",
  "asset_completeness",
  "manifest_completeness",
  "policy_enforcement",
]);

export const validationSeveritySchema = z.enum(["low", "medium", "high"]);
export const validationGateStatusSchema = z.enum(["pass", "fail"]);
export const validationVerdictSchema = z.enum(["PASS", "FAIL"]);
export const LISTENING_VALIDATION_GATE_STEP = "VALIDATION_GATE" as const;

export const LISTENING_VALIDATION_ERROR_CODES = [
  "TRANSCRIPT_INVALID",
  "QUESTION_SCHEMA_INVALID",
  "QUESTION_COVERAGE_INVALID",
  "ANCHOR_OUT_OF_BOUNDS",
  "SEGMENT_DURATION_OUT_OF_BOUNDS",
  "SECTION_DURATION_BUDGET_EXCEEDED",
  "ANSWER_KEY_MISSING",
  "ASSET_MISSING",
  "ASSET_UNREACHABLE",
  "MANIFEST_INCOMPLETE",
  "POLICY_CHECK_FAILED",
  "EVIDENCE_MISSING",
  "CONFIDENCE_BELOW_THRESHOLD",
  "UNGROUNDED_CLAIM",
  "UNAPPROVED_PROMPT_VERSION",
  "UNAPPROVED_MODEL_ID",
  "PROHIBITED_CONTENT_DETECTED",
] as const;

export const listeningValidationErrorCodeSchema = z.enum(LISTENING_VALIDATION_ERROR_CODES);
export type ListeningValidationErrorCode = z.infer<typeof listeningValidationErrorCodeSchema>;

export const validationGateResultSchema = z.object({
  gate_name: validationGateNameSchema,
  status: validationGateStatusSchema,
  severity: validationSeveritySchema,
  error_code: listeningValidationErrorCodeSchema.optional(),
  message: z.string().min(1).optional(),
  diagnostics: z.record(z.string(), z.unknown()).default({}),
});
export type ValidationGateResult = z.infer<typeof validationGateResultSchema>;

export const listeningTimingArtifactSchema = z.object({
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  generated_at: z.string().datetime(),
  segment_durations: z.array(
    z.object({
      segment_no: z.number().int().positive(),
      expected_duration_sec: z.number().nonnegative().optional(),
      actual_duration_sec: z.number().nonnegative(),
      min_allowed_sec: z.number().nonnegative(),
      max_allowed_sec: z.number().nonnegative(),
      within_bounds: z.boolean(),
      duration_source: z.string().min(1).optional(),
    }),
  ),
  section_budget: z.object({
    expected_total_sec: z.number().nonnegative().optional(),
    actual_total_sec: z.number().nonnegative(),
    tolerance_sec: z.number().nonnegative(),
    within_budget: z.boolean(),
  }),
  anchors: z.array(
    z.object({
      anchor_id: z.string().min(1),
      segment_no: z.number().int().positive(),
      offset_seconds: z.number().nonnegative(),
      segment_duration_seconds: z.number().positive(),
      within_bounds: z.boolean(),
    }),
  ),
});
export type ListeningTimingArtifact = z.infer<typeof listeningTimingArtifactSchema>;

export const listeningValidationReportSchema = z.object({
  report_id: z.string().min(1),
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  verdict: validationVerdictSchema,
  severity: validationSeveritySchema,
  top_error_code: listeningValidationErrorCodeSchema.optional(),
  gates: z.array(validationGateResultSchema).min(1),
  timing_artifact: listeningTimingArtifactSchema.optional(),
  created_at: z.string().datetime(),
});
export type ListeningValidationReport = z.infer<typeof listeningValidationReportSchema>;

export const deriveValidationVerdict = (gates: ValidationGateResult[]) => {
  const failing = gates.filter((gate) => gate.status === "fail");
  if (failing.length === 0) {
    return {
      verdict: "PASS" as const,
      severity: "low" as const,
      top_error_code: undefined,
    };
  }

  const high = failing.find((gate) => gate.severity === "high");
  if (high) {
    return {
      verdict: "FAIL" as const,
      severity: "high" as const,
      top_error_code: high.error_code,
    };
  }

  const medium = failing.find((gate) => gate.severity === "medium");
  if (medium) {
    return {
      verdict: "FAIL" as const,
      severity: "medium" as const,
      top_error_code: medium.error_code,
    };
  }

  return {
    verdict: "FAIL" as const,
    severity: "low" as const,
    top_error_code: failing[0]?.error_code,
  };
};
