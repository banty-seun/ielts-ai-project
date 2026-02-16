import { z } from "zod";

export const listeningStageSpanSchema = z.enum([
  "plan_selected",
  "section_scheduled",
  "script_generated",
  "question_generated",
  "audio_rendered",
  "validated",
  "published",
  "result_computed",
  "coach_analyzed",
]);

export type ListeningStageSpan = z.infer<typeof listeningStageSpanSchema>;

export const listeningTelemetryContextSchema = z.object({
  trace_id: z.string().min(1),
  request_id: z.string().min(1),
  user_id: z.string().min(1),
  weekly_plan_id: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  section_id: z.string().nullable().optional(),
  part_id: z.string().nullable().optional(),
  agent_name: z.string().min(1),
  context_missing: z.boolean().default(false),
  feature_flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  tags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export type ListeningTelemetryContext = z.infer<typeof listeningTelemetryContextSchema>;

export const buildListeningTelemetryContext = (input: {
  trace_id?: string | null;
  request_id?: string | null;
  user_id?: string | null;
  weekly_plan_id?: string | null;
  session_id?: string | null;
  section_id?: string | null;
  part_id?: string | null;
  agent_name: string;
  feature_flags?: Record<string, string | number | boolean>;
  tags?: Record<string, string | number | boolean>;
}) => {
  const traceId = String(input.trace_id ?? "").trim();
  const requestId = String(input.request_id ?? "").trim();
  const userId = String(input.user_id ?? "").trim();

  const contextMissing = !traceId || !requestId || !userId;

  return listeningTelemetryContextSchema.parse({
    trace_id: traceId || "missing_trace_id",
    request_id: requestId || "missing_request_id",
    user_id: userId || "missing_user_id",
    weekly_plan_id: input.weekly_plan_id ?? null,
    session_id: input.session_id ?? null,
    section_id: input.section_id ?? null,
    part_id: input.part_id ?? null,
    agent_name: input.agent_name,
    context_missing: contextMissing,
    feature_flags: input.feature_flags ?? {},
    tags: input.tags ?? {},
  });
};
