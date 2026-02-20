import {
  LISTENING_EVENT_TOPICS,
  ListeningEventEnvelope,
  ListeningEventTopic,
  buildListeningEventEnvelope,
  parseListeningEventEnvelope,
} from "@shared/listening";
import { retryPrefetchJob, shouldRetryError } from "./prefetchRetry";
import {
  hasProcessedListeningIdempotencyKey,
  markProcessedListeningIdempotencyKey,
} from "./listeningIdempotencyStore";
import { persistListeningEventToOutbox } from "./listeningEventOutbox";

const processedIdempotencyKeys = new Set<string>();

export const buildSectionStepIdempotencyKey = (sessionId: string, sectionNo: number, step: string) => {
  return `${sessionId}:${sectionNo}:${step}:v1`;
};

export const isDuplicateListeningEvent = (idempotencyKey: string) => {
  return processedIdempotencyKeys.has(idempotencyKey);
};

export const markListeningEventProcessed = (idempotencyKey: string) => {
  processedIdempotencyKeys.add(idempotencyKey);
};

export const publishListeningEvent = <TPayload extends Record<string, unknown>>(params: {
  topic: ListeningEventTopic;
  eventType: string;
  eventVersion: string;
  producer: string;
  traceId: string;
  correlationId: string;
  idempotencyKey: string;
  userId: string;
  payload: TPayload;
}): ListeningEventEnvelope<TPayload> => {
  if (!Object.values(LISTENING_EVENT_TOPICS).includes(params.topic)) {
    throw new Error(`Unsupported topic: ${params.topic}`);
  }

  const envelope = buildListeningEventEnvelope<TPayload>({
    eventType: params.eventType,
    eventVersion: params.eventVersion,
    producer: params.producer,
    traceId: params.traceId,
    correlationId: params.correlationId,
    idempotencyKey: params.idempotencyKey,
    userId: params.userId,
    payload: params.payload,
  });

  console.log("[ListeningEvent][Publish]", {
    topic: params.topic,
    event_id: envelope.event_id,
    event_type: envelope.event_type,
    event_version: envelope.event_version,
    trace_id: envelope.trace_id,
    correlation_id: envelope.correlation_id,
    idempotency_key: envelope.idempotency_key,
  });

  return envelope;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const publishListeningEventDurably = async <TPayload extends Record<string, unknown>>(params: {
  topic: ListeningEventTopic;
  eventType: string;
  eventVersion: string;
  producer: string;
  traceId: string;
  correlationId: string;
  idempotencyKey: string;
  userId: string;
  payload: TPayload;
  taskProgressId: string;
  maxOutboxAttempts?: number;
  outboxRetryDelayMs?: number;
  persistOutboxFn?: (args: {
    taskProgressId: string;
    userId: string;
    topic: ListeningEventTopic;
    event: ListeningEventEnvelope<TPayload>;
  }) => Promise<unknown>;
}) => {
  let event: ListeningEventEnvelope<TPayload> | null = null;
  try {
    event = publishListeningEvent(params);
  } catch (error: any) {
    // Durable state transitions should not fail because event emission failed.
    console.error("[ListeningEvent][PublishFailed]", {
      topic: params.topic,
      event_type: params.eventType,
      trace_id: params.traceId,
      correlation_id: params.correlationId,
      message: error?.message ?? "unknown",
    });
    return {
      event: null,
      outboxPersisted: false,
    };
  }

  const maxOutboxAttempts = Math.max(1, Number(params.maxOutboxAttempts ?? 3));
  const outboxRetryDelayMs = Math.max(25, Number(params.outboxRetryDelayMs ?? 250));

  const persistOutboxFn =
    params.persistOutboxFn ??
    (async (args: {
      taskProgressId: string;
      userId: string;
      topic: ListeningEventTopic;
      event: ListeningEventEnvelope<TPayload>;
    }) => persistListeningEventToOutbox(args));

  for (let attempt = 1; attempt <= maxOutboxAttempts; attempt += 1) {
    try {
      await persistOutboxFn({
        taskProgressId: params.taskProgressId,
        userId: params.userId,
        topic: params.topic,
        event,
      });
      return {
        event,
        outboxPersisted: true,
      };
    } catch (error: any) {
      const finalAttempt = attempt >= maxOutboxAttempts;
      console.error("[ListeningEvent][OutboxPersistFailed]", {
        topic: params.topic,
        event_type: params.eventType,
        task_id: params.taskProgressId,
        attempt,
        max_attempts: maxOutboxAttempts,
        message: error?.message ?? "unknown",
      });
      if (!finalAttempt) {
        await sleep(outboxRetryDelayMs * attempt);
      }
    }
  }

  return {
    event,
    outboxPersisted: false,
  };
};

export const consumeListeningEvent = async <TPayload extends Record<string, unknown>>(params: {
  topic: ListeningEventTopic;
  rawEvent: unknown;
  onConsume: (event: ListeningEventEnvelope<TPayload>) => Promise<void>;
  idempotencyTaskId?: string;
  retryContext?: {
    taskId: string;
    userId: string;
    batchId: string;
    currentRetryCount: number;
  };
}) => {
  if (!Object.values(LISTENING_EVENT_TOPICS).includes(params.topic)) {
    throw new Error(`Unsupported topic: ${params.topic}`);
  }

  const envelope = parseListeningEventEnvelope<TPayload>(params.rawEvent);

  const persistedDuplicate = params.idempotencyTaskId
    ? await hasProcessedListeningIdempotencyKey(params.idempotencyTaskId, envelope.idempotency_key)
    : false;

  if (isDuplicateListeningEvent(envelope.idempotency_key)) {
    console.log("[ListeningEvent][DuplicateIgnored]", {
      topic: params.topic,
      event_id: envelope.event_id,
      idempotency_key: envelope.idempotency_key,
      trace_id: envelope.trace_id,
      correlation_id: envelope.correlation_id,
    });
    return;
  }
  if (persistedDuplicate) {
    console.log("[ListeningEvent][DuplicateIgnoredPersisted]", {
      topic: params.topic,
      event_id: envelope.event_id,
      idempotency_key: envelope.idempotency_key,
      trace_id: envelope.trace_id,
      correlation_id: envelope.correlation_id,
      task_id: params.idempotencyTaskId,
    });
    return;
  }

  try {
    await params.onConsume(envelope);
    markListeningEventProcessed(envelope.idempotency_key);
    if (params.idempotencyTaskId) {
      await markProcessedListeningIdempotencyKey(params.idempotencyTaskId, envelope.idempotency_key);
    }
  } catch (error: any) {
    const errorCode = typeof error?.code === "string" ? error.code : undefined;
    if (params.retryContext && shouldRetryError(errorCode)) {
      await retryPrefetchJob(
        {
          taskId: params.retryContext.taskId,
          userId: params.retryContext.userId,
          batchId: params.retryContext.batchId,
          errorCode,
          currentRetryCount: params.retryContext.currentRetryCount,
          skillType: "listening",
          traceId: envelope.trace_id,
          correlationId: envelope.correlation_id,
          stage: envelope.event_type,
        },
        async () => {
          await params.onConsume(envelope);
          markListeningEventProcessed(envelope.idempotency_key);
        },
      );
    }

    throw error;
  }
};
