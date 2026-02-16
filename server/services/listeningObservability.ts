import { randomUUID } from "crypto";
import {
  buildListeningTelemetryContext,
  listeningStageSpanSchema,
  type ListeningStageSpan,
  type ListeningTelemetryContext,
} from "@shared/listening";
import { storage } from "../storage";
import { isPrivacySafeLogMode, redactSensitive } from "../utils/privacy";

type LogLevel = "info" | "warn" | "error";

type SpanRecord = {
  spanId: string;
  stage: ListeningStageSpan;
  startedAt: number;
  context: ListeningTelemetryContext;
  attempt?: number;
  metadata?: Record<string, unknown>;
  taskProgressId?: string;
};

const safeString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return String(value);
};

const toPositiveInt = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : null;
};

const resolveSectionNo = (params: {
  context: ListeningTelemetryContext;
  metadata: Record<string, unknown>;
}) => {
  const metadataSectionNo = toPositiveInt(params.metadata.section_no);
  if (metadataSectionNo) return metadataSectionNo;

  const sectionId = String(params.context.section_id ?? "");
  const matched = sectionId.match(/section-(\d+)/i);
  if (matched?.[1]) {
    const parsed = toPositiveInt(matched[1]);
    if (parsed) return parsed;
  }

  const partAsSection = toPositiveInt(params.context.part_id);
  if (partAsSection) return partAsSection;

  return 1;
};

const defaultFeatureFlags = () => ({
  listening_rollout_mode: String(process.env.LISTENING_ROLLOUT_MODE ?? "cohort"),
  listening_rollout_percent: Number(process.env.LISTENING_ROLLOUT_PERCENT ?? 0),
  listening_rollout_force_rollback: process.env.LISTENING_ROLLOUT_FORCE_ROLLBACK === "true",
  listening_startup_gate_mode: String(process.env.LISTENING_STARTUP_GATE_MODE ?? "cohort"),
});

export const createTelemetryContext = (params: {
  traceId?: string | null;
  requestId?: string | null;
  userId?: string | null;
  weeklyPlanId?: string | null;
  sessionId?: string | null;
  sectionId?: string | null;
  partId?: string | null;
  agentName: string;
  featureFlags?: Record<string, string | number | boolean>;
  tags?: Record<string, string | number | boolean>;
}) => {
  return buildListeningTelemetryContext({
    trace_id: params.traceId,
    request_id: params.requestId,
    user_id: params.userId,
    weekly_plan_id: params.weeklyPlanId ?? null,
    session_id: params.sessionId ?? null,
    section_id: params.sectionId ?? null,
    part_id: params.partId ?? null,
    agent_name: params.agentName,
    feature_flags: {
      ...defaultFeatureFlags(),
      ...(params.featureFlags ?? {}),
    },
    tags: params.tags,
  });
};

const emitStructuredLog = (
  level: LogLevel,
  eventName: string,
  context: ListeningTelemetryContext,
  metadata?: Record<string, unknown>,
) => {
  const payload = {
    event_name: eventName,
    level,
    trace_id: context.trace_id,
    request_id: context.request_id,
    user_id: context.user_id,
    weekly_plan_id: context.weekly_plan_id ?? null,
    session_id: context.session_id ?? null,
    section_id: context.section_id ?? null,
    part_id: context.part_id ?? null,
    agent_name: context.agent_name,
    context_missing: context.context_missing,
    feature_flags: context.feature_flags,
    tags: isPrivacySafeLogMode() ? redactSensitive(context.tags) : context.tags,
    metadata: isPrivacySafeLogMode() ? redactSensitive(metadata ?? {}) : metadata ?? {},
    at: new Date().toISOString(),
  };

  if (level === "error") {
    console.error("[ListeningStructuredLog]", payload);
  } else if (level === "warn") {
    console.warn("[ListeningStructuredLog]", payload);
  } else {
    console.log("[ListeningStructuredLog]", payload);
  }
};

export const logListeningEvent = (params: {
  level?: LogLevel;
  eventName: string;
  context: ListeningTelemetryContext;
  metadata?: Record<string, unknown>;
}) => {
  emitStructuredLog(params.level ?? "info", params.eventName, params.context, params.metadata);
};

export const startListeningStageSpan = (params: {
  stage: ListeningStageSpan;
  context: ListeningTelemetryContext;
  attempt?: number;
  metadata?: Record<string, unknown>;
  taskProgressId?: string;
}) => {
  const stage = listeningStageSpanSchema.parse(params.stage);
  const span: SpanRecord = {
    spanId: `span_${randomUUID()}`,
    stage,
    startedAt: Date.now(),
    context: params.context,
    attempt: params.attempt,
    metadata: params.metadata,
    taskProgressId: params.taskProgressId,
  };
  emitStructuredLog("info", "listening.stage_span.started", params.context, {
    span_id: span.spanId,
    stage: span.stage,
    attempt: span.attempt ?? null,
    ...params.metadata,
  });
  return span;
};

export const finishListeningStageSpan = async (
  span: SpanRecord,
  params?: {
    success?: boolean;
    errorClass?: string | null;
    metadata?: Record<string, unknown>;
  },
) => {
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - span.startedAt);
  const success = params?.success !== false;
  const mergedMetadata: Record<string, unknown> = {
    ...(span.metadata ?? {}),
    ...(params?.metadata ?? {}),
  };

  emitStructuredLog(success ? "info" : "error", "listening.stage_span.finished", span.context, {
    span_id: span.spanId,
    stage: span.stage,
    duration_ms: durationMs,
    attempt: span.attempt ?? null,
    success,
    error_class: safeString(params?.errorClass) ?? null,
    ...mergedMetadata,
  });

  if (span.taskProgressId) {
    try {
      const sectionNo = resolveSectionNo({
        context: span.context,
        metadata: mergedMetadata,
      });
      await storage.insertListeningQueueMetric({
        id: `lqm_${randomUUID()}`,
        taskProgressId: span.taskProgressId,
        userId: span.context.user_id,
        sectionNo,
        priorityClass: "P3_LATER",
        stepName: `span:${span.stage}`,
        enqueueToStartMs: durationMs,
        metadata: {
          trace_id: span.context.trace_id,
          request_id: span.context.request_id,
          correlation_session_id: span.context.session_id ?? null,
          section_id: span.context.section_id ?? null,
          agent_name: span.context.agent_name,
          attempt: span.attempt ?? null,
          part_no: toPositiveInt(mergedMetadata.part_no) ?? toPositiveInt(span.context.part_id),
          section_no: sectionNo,
          success,
          error_class: safeString(params?.errorClass) ?? null,
          ...mergedMetadata,
        },
      });
    } catch (error) {
      emitStructuredLog("warn", "listening.stage_span.metric_write_failed", span.context, {
        span_id: span.spanId,
        stage: span.stage,
      });
    }
  }

  return {
    durationMs,
    success,
  };
};
