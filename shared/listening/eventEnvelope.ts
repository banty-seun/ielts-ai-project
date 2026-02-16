import { randomUUID } from "crypto";
import { z } from "zod";

export const EVENT_VERSION_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const eventVersionSchema = z
  .string()
  .regex(EVENT_VERSION_REGEX, "event_version must follow semantic version format major.minor.patch");

export type EventVersionChange = "major" | "minor" | "patch";

export const determineEventVersionChange = (fromVersion: string, toVersion: string): EventVersionChange => {
  const from = fromVersion.split(".").map((value) => Number(value));
  const to = toVersion.split(".").map((value) => Number(value));

  if (from.length !== 3 || to.length !== 3 || from.some(Number.isNaN) || to.some(Number.isNaN)) {
    throw new Error("Invalid semantic version value");
  }

  if (to[0] !== from[0]) return "major";
  if (to[1] !== from[1]) return "minor";
  return "patch";
};

export const listeningEventEnvelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  event_version: eventVersionSchema,
  occurred_at: z.string().datetime(),
  producer: z.string().min(1),
  trace_id: z.string().min(1),
  correlation_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  user_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type ListeningEventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> = Omit<
  z.infer<typeof listeningEventEnvelopeSchema>,
  "payload"
> & {
  payload: TPayload;
};

export const buildListeningEventEnvelope = <TPayload extends Record<string, unknown>>(params: {
  eventType: string;
  eventVersion: string;
  producer: string;
  traceId: string;
  correlationId: string;
  idempotencyKey: string;
  userId: string;
  payload: TPayload;
  eventId?: string;
  occurredAt?: string;
}): ListeningEventEnvelope<TPayload> => {
  const envelope: ListeningEventEnvelope<TPayload> = {
    event_id: params.eventId ?? `evt_${randomUUID()}`,
    event_type: params.eventType,
    event_version: params.eventVersion,
    occurred_at: params.occurredAt ?? new Date().toISOString(),
    producer: params.producer,
    trace_id: params.traceId,
    correlation_id: params.correlationId,
    idempotency_key: params.idempotencyKey,
    user_id: params.userId,
    payload: params.payload,
  };

  return listeningEventEnvelopeSchema.parse(envelope) as ListeningEventEnvelope<TPayload>;
};

export const parseListeningEventEnvelope = <TPayload extends Record<string, unknown> = Record<string, unknown>>(
  input: unknown,
): ListeningEventEnvelope<TPayload> => {
  return listeningEventEnvelopeSchema.parse(input) as ListeningEventEnvelope<TPayload>;
};

export const createListeningTraceContext = (req: {
  requestId?: string;
  traceId?: string;
  correlationId?: string;
  userId: string;
  taskId?: string;
  sessionBatchId?: string;
  weeklyPlanId?: string;
  sectionId?: string;
  partId?: string;
  agentName?: string;
}) => {
  const traceId = req.traceId ?? req.requestId ?? `trc_${randomUUID()}`;
  const correlationId = req.correlationId ?? req.sessionBatchId ?? req.taskId ?? `cor_${randomUUID()}`;

  return {
    traceId,
    requestId: req.requestId ?? traceId,
    correlationId,
    userId: req.userId,
    weeklyPlanId: req.weeklyPlanId ?? null,
    sessionId: req.sessionBatchId ?? req.taskId ?? null,
    sectionId: req.sectionId ?? null,
    partId: req.partId ?? null,
    agentName: req.agentName ?? "unknown_agent",
    contextMissing: !req.requestId || !req.userId,
  };
};
