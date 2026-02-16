import { z } from "zod";

export const listeningReviewQueueStatusSchema = z.enum([
  "OPEN",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "REQUEUED",
  "CLOSED",
]);
export type ListeningReviewQueueStatus = z.infer<typeof listeningReviewQueueStatusSchema>;

export const listeningReviewActionTypeSchema = z.enum([
  "APPROVE_WITH_EXCEPTION",
  "HOLD",
  "FORCE_REGENERATE",
  "REQUEUE",
  "REQUEUE_STEP",
  "REJECT",
  // Backward-compat alias retained during migration.
  "APPROVE_WITH_OVERRIDE",
]);
export type ListeningReviewActionType = z.infer<typeof listeningReviewActionTypeSchema>;

export const listeningReviewQueueItemSchema = z.object({
  id: z.string().min(1),
  task_progress_id: z.string().min(1),
  user_id: z.string().min(1),
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  validation_report_id: z.string().min(1).nullable().optional(),
  status: listeningReviewQueueStatusSchema,
  severity: z.enum(["low", "medium", "high"]),
  failure_type: z.string().min(1),
  failure_code: z.string().min(1),
  context: z.record(z.string(), z.unknown()).nullable().optional(),
  sla_due_at: z.string().datetime().nullable().optional(),
  escalated_at: z.string().datetime().nullable().optional(),
  resolved_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const listeningReviewMetricsSchema = z.object({
  total_items: z.number().int().nonnegative(),
  open_items: z.number().int().nonnegative(),
  overdue_items: z.number().int().nonnegative(),
  manual_review_volume: z.number().int().nonnegative(),
  approval_rate: z.number().nonnegative(),
  mean_resolution_minutes: z.number().nonnegative(),
});
export type ListeningReviewMetrics = z.infer<typeof listeningReviewMetricsSchema>;
