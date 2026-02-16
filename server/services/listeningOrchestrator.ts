import type { TaskProgress } from "@shared/schema";
import {
  LISTENING_EVENT_TOPICS,
  LISTENING_EVENT_TYPES,
  ListeningEventEnvelope,
  createListeningTraceContext,
} from "@shared/listening";
import {
  buildSectionStepIdempotencyKey,
  consumeListeningEvent,
  publishListeningEvent,
} from "./listeningEvents";
import {
  mapLegacyPrefetchToSectionStateRecord,
  transitionListeningSectionState,
  upsertListeningSectionState,
  validateSequentialSectionPolicy,
} from "./listeningSectionState";

export const deriveSectionIdentifiers = (task: TaskProgress, sectionNo = 1) => {
  return {
    sectionId: `${task.id}:section-${sectionNo}`,
    sectionNo,
  };
};

export const dispatchSectionBuildRequested = (params: {
  task: TaskProgress;
  sectionNo?: number;
  requestId?: string;
  traceId?: string;
  correlationId?: string;
}) => {
  const { sectionNo = 1 } = params;
  const { sectionId } = deriveSectionIdentifiers(params.task, sectionNo);
  const trace = createListeningTraceContext({
    requestId: params.requestId,
    traceId: params.traceId,
    correlationId: params.correlationId,
    userId: params.task.userId,
    taskId: params.task.id,
    sessionBatchId: ((params.task.progressData ?? {}) as any)?.sessionBatchId,
  });

  const idempotencyKey = buildSectionStepIdempotencyKey(trace.correlationId, sectionNo, "build_requested");

  const event = publishListeningEvent({
    topic: LISTENING_EVENT_TOPICS.SECTION_COMMANDS,
    eventType: LISTENING_EVENT_TYPES.SECTION_BUILD_REQUESTED,
    eventVersion: "1.0.0",
    producer: "listening-api",
    traceId: trace.traceId,
    correlationId: trace.correlationId,
    idempotencyKey,
    userId: params.task.userId,
    payload: {
      task_id: params.task.id,
      section_id: sectionId,
      section_no: sectionNo,
    },
  });

  return {
    event,
    trace,
    idempotencyKey,
    sectionId,
    sectionNo,
  };
};

export const syncLegacyPrefetchIntoSectionState = async (task: TaskProgress, sectionNo = 1) => {
  const { sectionId } = deriveSectionIdentifiers(task, sectionNo);
  const idempotencyKey = buildSectionStepIdempotencyKey(task.id, sectionNo, "legacy_prefetch_sync");
  const sectionRecord = mapLegacyPrefetchToSectionStateRecord({
    task,
    sectionId,
    sectionNo,
    idempotencyKey,
  });

  return await upsertListeningSectionState(task, sectionRecord);
};

export const enforceSequentialPolicy = async (task: TaskProgress, sectionNo: number) => {
  return await validateSequentialSectionPolicy(task, sectionNo);
};

export const bootstrapSessionSections = async (params: {
  task: TaskProgress;
  traceId: string;
}) => {
  for (let sectionNo = 1; sectionNo <= 4; sectionNo += 1) {
    const sectionId = `${params.task.id}:section-${sectionNo}`;
    const result = await transitionListeningSectionState({
      task: params.task,
      sectionId,
      sectionNo,
      toState: "PLANNED",
      eventId: params.traceId,
      idempotencyKey: buildSectionStepIdempotencyKey(params.task.id, sectionNo, "bootstrap"),
    });

    if (!result.ok) {
      return result;
    }
  }

  return { ok: true as const };
};

export const consumePlanCreatedBootstrapEvent = async (params: {
  rawEvent: unknown;
  task: TaskProgress;
  retryContext?: {
    taskId: string;
    userId: string;
    batchId: string;
    currentRetryCount: number;
  };
}) => {
  return consumeListeningEvent({
    topic: LISTENING_EVENT_TOPICS.PLAN_EVENTS,
    rawEvent: params.rawEvent,
    idempotencyTaskId: params.task.id,
    retryContext: params.retryContext,
    onConsume: async (event: ListeningEventEnvelope) => {
      if (event.event_type !== LISTENING_EVENT_TYPES.SESSION_PLAN_CREATED) {
        return;
      }
      const bootstrapped = await bootstrapSessionSections({
        task: params.task,
        traceId: event.trace_id,
      });
      if (!bootstrapped.ok) {
        const err = new Error("Session bootstrap failed");
        (err as any).code = "BOOTSTRAP_FAILED";
        throw err;
      }
    },
  });
};
