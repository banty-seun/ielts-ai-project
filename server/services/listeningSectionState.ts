import type { TaskProgress } from "@shared/schema";
import {
  LISTENING_EVENT_TOPICS,
  LISTENING_EVENT_TYPES,
  ListeningSectionStateRecord,
  applySectionStateTransition,
  assertSequentialSectionStart,
  listeningSectionStateRecordSchema,
  mapPrefetchStatusToSectionState,
  prefetchStatusSchema,
  sectionLifecycleStateSchema,
} from "@shared/listening";
import { storage } from "../storage";
import { publishListeningEvent } from "./listeningEvents";
import { upsertReadinessFromSectionState } from "./listeningReadinessModel";

const SECTION_STATE_ROOT = "sectionLifecycle";

const getListeningSectionStatesFromProgressData = (task: TaskProgress): ListeningSectionStateRecord[] => {
  const progressData = (task.progressData ?? {}) as Record<string, unknown>;
  const raw = (progressData[SECTION_STATE_ROOT] ?? []) as unknown[];

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const parsed = listeningSectionStateRecordSchema.safeParse(entry);
      return parsed.success ? parsed.data : null;
    })
    .filter((entry): entry is ListeningSectionStateRecord => entry !== null)
    .sort((a, b) => a.section_no - b.section_no);
};

const toRecord = (row: {
  sectionId: string;
  sectionNo: number;
  state: string;
  attempt: number;
  lastErrorCode: string | null;
  updatedAt: Date;
  idempotencyKey: string;
}): ListeningSectionStateRecord | null => {
  const parsed = listeningSectionStateRecordSchema.safeParse({
    section_id: row.sectionId,
    section_no: row.sectionNo,
    state: row.state,
    attempt: row.attempt,
    last_error_code: row.lastErrorCode,
    updated_at: row.updatedAt.toISOString(),
    idempotency_key: row.idempotencyKey,
  });
  return parsed.success ? parsed.data : null;
};

export const getListeningSectionStates = async (task: TaskProgress): Promise<ListeningSectionStateRecord[]> => {
  const persistedRows = await storage.getListeningSectionStates(task.id);
  const persisted = persistedRows
    .map((row) => toRecord({
      sectionId: row.sectionId,
      sectionNo: row.sectionNo,
      state: row.state,
      attempt: row.attempt,
      lastErrorCode: row.lastErrorCode ?? null,
      updatedAt: row.updatedAt,
      idempotencyKey: row.idempotencyKey,
    }))
    .filter((entry): entry is ListeningSectionStateRecord => entry !== null)
    .sort((a, b) => a.section_no - b.section_no);

  if (persisted.length > 0) {
    return persisted;
  }

  return getListeningSectionStatesFromProgressData(task);
};

export const upsertListeningSectionState = async (
  task: TaskProgress,
  nextState: ListeningSectionStateRecord,
): Promise<Record<string, unknown>> => {
  await storage.upsertListeningSectionState({
    id: `${task.id}:${nextState.section_id}`,
    taskProgressId: task.id,
    userId: task.userId,
    sectionId: nextState.section_id,
    sectionNo: nextState.section_no,
    state: nextState.state,
    attempt: nextState.attempt,
    lastErrorCode: nextState.last_error_code ?? null,
    idempotencyKey: nextState.idempotency_key,
    updatedAt: new Date(nextState.updated_at),
  });

  // Keep existing progress data readable, but authoritative section-state persistence is table-backed.
  return (task.progressData ?? {}) as Record<string, unknown>;
};

export const mapLegacyPrefetchToSectionStateRecord = (params: {
  task: TaskProgress;
  sectionId: string;
  sectionNo: number;
  idempotencyKey: string;
}): ListeningSectionStateRecord => {
  const progressData = (params.task.progressData ?? {}) as Record<string, any>;
  const prefetch = (progressData.sessionPrefetch ?? {}) as Record<string, any>;
  const prefetchStatus = prefetchStatusSchema.safeParse(prefetch.status).success
    ? (prefetch.status as "idle" | "queued" | "running" | "ready" | "ready_partial" | "error")
    : "idle";
  const mappedState = mapPrefetchStatusToSectionState(
    prefetchStatus,
  );

  return {
    section_id: params.sectionId,
    section_no: params.sectionNo,
    state: mappedState,
    attempt: Number(prefetch.retryCount ?? 0),
    last_error_code: typeof prefetch.errorCode === "string" ? prefetch.errorCode : null,
    updated_at: typeof prefetch.updatedAt === "string" ? prefetch.updatedAt : new Date().toISOString(),
    idempotency_key: params.idempotencyKey,
  };
};

export const transitionListeningSectionState = async (params: {
  task: TaskProgress;
  sectionId: string;
  sectionNo: number;
  toState: string;
  eventId: string;
  idempotencyKey: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}) => {
  const to = sectionLifecycleStateSchema.parse(params.toState);
  const sectionStates = await getListeningSectionStates(params.task);
  const existing = sectionStates.find((state) => state.section_id === params.sectionId);

  if (!existing) {
    if (to !== "PLANNED") {
      return {
        ok: false as const,
        error: {
          code: "MISSING_SECTION_STATE",
          section_id: params.sectionId,
          to_state: to,
          event_id: params.eventId,
        },
      };
    }

    const seeded: ListeningSectionStateRecord = {
      section_id: params.sectionId,
      section_no: params.sectionNo,
      state: "PLANNED",
      attempt: 0,
      updated_at: new Date().toISOString(),
      idempotency_key: params.idempotencyKey,
      last_error_code: null,
    };

    const nextProgressData = await upsertListeningSectionState(params.task, seeded);
    const event = publishListeningEvent({
      topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
      eventType: LISTENING_EVENT_TYPES.SECTION_STATE_CHANGED,
      eventVersion: "1.0.0",
      producer: "listening-orchestrator",
      traceId: params.eventId,
      correlationId: params.task.id,
      idempotencyKey: params.idempotencyKey,
      userId: params.task.userId,
      payload: {
        section_id: seeded.section_id,
        section_no: seeded.section_no,
        previous_state: null,
        state: seeded.state,
        attempt: seeded.attempt,
        occurred_at: seeded.updated_at,
        metadata: params.metadata ?? null,
      },
    });
    await upsertReadinessFromSectionState({
      task: params.task,
      section: seeded,
      lastEventId: event.event_id,
    });

    return {
      ok: true as const,
      nextRecord: seeded,
      nextProgressData,
    };
  }

  const transition = applySectionStateTransition({
    sectionId: existing.section_id,
    fromState: existing.state,
    toState: to,
    eventId: params.eventId,
  });

  if (!transition.ok) {
    console.error("[ListeningSectionState][InvalidTransition]", transition.error);
    return transition;
  }

  const nextRecord: ListeningSectionStateRecord = {
    ...existing,
    state: transition.nextState,
    attempt: transition.nextState === "FAILED" ? existing.attempt + 1 : existing.attempt,
    last_error_code: transition.nextState === "FAILED" ? params.errorCode ?? existing.last_error_code : null,
    updated_at: new Date().toISOString(),
    idempotency_key: params.idempotencyKey,
  };

  const nextProgressData = await upsertListeningSectionState(params.task, nextRecord);
  const event = publishListeningEvent({
    topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
    eventType: LISTENING_EVENT_TYPES.SECTION_STATE_CHANGED,
    eventVersion: "1.0.0",
    producer: "listening-orchestrator",
    traceId: params.eventId,
    correlationId: params.task.id,
    idempotencyKey: params.idempotencyKey,
    userId: params.task.userId,
    payload: {
      section_id: nextRecord.section_id,
      section_no: nextRecord.section_no,
      previous_state: existing.state,
      state: nextRecord.state,
      attempt: nextRecord.attempt,
      occurred_at: nextRecord.updated_at,
      metadata: params.metadata ?? null,
    },
  });
  await upsertReadinessFromSectionState({
    task: params.task,
    section: nextRecord,
    lastEventId: event.event_id,
  });

  return {
    ok: true as const,
    nextRecord,
    nextProgressData,
  };
};

export const validateSequentialSectionPolicy = async (task: TaskProgress, requestedSectionNo: number) => {
  const sectionStates = await getListeningSectionStates(task);
  const result = assertSequentialSectionStart({
    requestedSectionNo,
    sections: sectionStates,
  });

  if (!result.ok) {
    console.warn("[ListeningSectionState][OrderViolation]", {
      task_id: task.id,
      reason: "ORDER_GUARD_FAILED",
      ...result.error,
    });
  }

  return result;
};

export const recoverSectionStateFromProgressData = (task: TaskProgress, sectionId: string) => {
  const records = getListeningSectionStatesFromProgressData(task);
  const existing = records.find((record) => record.section_id === sectionId);
  if (existing) {
    return existing;
  }

  return null;
};

export const recoverListeningSectionState = async (task: TaskProgress, sectionId: string) => {
  const row = await storage.getListeningSectionState(task.id, sectionId);
  if (row) {
    const parsed = toRecord({
      sectionId: row.sectionId,
      sectionNo: row.sectionNo,
      state: row.state,
      attempt: row.attempt,
      lastErrorCode: row.lastErrorCode ?? null,
      updatedAt: row.updatedAt,
      idempotencyKey: row.idempotencyKey,
    });
    if (parsed) return parsed;
  }
  return recoverSectionStateFromProgressData(task, sectionId);
};

export const resolveResumeTargetState = (currentState: ListeningSectionStateRecord["state"]) => {
  if (currentState === "PLANNED") return "SCRIPT_READY";
  if (currentState === "SCRIPT_READY") return "QUESTIONS_READY";
  if (currentState === "QUESTIONS_READY") return "AUDIO_READY";
  if (currentState === "AUDIO_READY") return "VALIDATED";
  if (currentState === "VALIDATED") return "PUBLISHED";
  if (currentState === "REVIEW_REQUIRED") return "VALIDATED";
  if (currentState === "FAILED") return "PLANNED";
  return null;
};
