import { z } from "zod";
import { listeningScoringTagSchema } from "./questionContracts";

export const listeningRiskClassSchema = z.enum([
  "learning_content",
  "scoring_feedback",
  "personalized_coaching",
  "plan_adjustment",
]);
export type ListeningRiskClass = z.infer<typeof listeningRiskClassSchema>;

export const listeningGovernanceFailureCodeSchema = z.enum([
  "POLICY_CHECK_FAILED",
  "EVIDENCE_MISSING",
  "CONFIDENCE_BELOW_THRESHOLD",
  "UNGROUNDED_CLAIM",
  "UNAPPROVED_PROMPT_VERSION",
  "UNAPPROVED_MODEL_ID",
  "PROHIBITED_CONTENT_DETECTED",
]);
export type ListeningGovernanceFailureCode = z.infer<typeof listeningGovernanceFailureCodeSchema>;

export const listeningEvidenceReferenceSchema = z.object({
  section_id: z.string().min(1),
  part_id: z.number().int().positive(),
  question_ids: z.array(z.number().int().positive()).default([]),
  error_tags: z.array(listeningScoringTagSchema).default([]),
});
export type ListeningEvidenceReference = z.infer<typeof listeningEvidenceReferenceSchema>;

export const listeningPromptModelProvenanceSchema = z.object({
  prompt_id: z.string().min(1),
  prompt_version: z.string().min(1),
  prompt_registry_id: z.string().min(1),
  model_id: z.string().min(1),
  model_settings: z.record(z.string(), z.unknown()).default({}),
  owner: z.string().min(1),
  approved_at: z.string().datetime(),
  status: z.enum(["draft", "approved", "deprecated"]),
});
export type ListeningPromptModelProvenance = z.infer<typeof listeningPromptModelProvenanceSchema>;

export const listeningGovernanceProvenanceSchema = z.object({
  policy_version: z.string().min(1),
  risk_class: listeningRiskClassSchema,
  validator_set_version: z.string().min(1),
  prompt_model: listeningPromptModelProvenanceSchema.optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  confidence_score: z.number().min(0).max(1).optional(),
  fallback_reason: z.string().min(1).optional(),
  fallback_used: z.boolean().optional(),
});
export type ListeningGovernanceProvenance = z.infer<typeof listeningGovernanceProvenanceSchema>;

export const listeningGovernanceCheckResultSchema = z.object({
  ok: z.boolean(),
  code: listeningGovernanceFailureCodeSchema.optional(),
  message: z.string().optional(),
  risk_class: listeningRiskClassSchema,
  diagnostics: z.record(z.string(), z.unknown()).default({}),
});
export type ListeningGovernanceCheckResult = z.infer<typeof listeningGovernanceCheckResultSchema>;

