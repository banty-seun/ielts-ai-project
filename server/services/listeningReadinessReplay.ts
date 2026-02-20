import {
  LISTENING_EVENT_TYPES,
  parseListeningEventEnvelope,
  type ListeningSectionManifest,
  type SectionLifecycleState,
} from "@shared/listening";
import type { ListeningEventOutbox, TaskProgress } from "@shared/schema";
import { storage } from "../storage";
import { upsertReadinessFromManifest, upsertReadinessFromSectionState } from "./listeningReadinessModel";

const toMs = (value: unknown) => {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : 0;
};

const resolveSectionLifecycleState = (value: unknown): SectionLifecycleState | null => {
  const state = String(value ?? "").toUpperCase();
  if (
    state === "PLANNED" ||
    state === "SCRIPT_READY" ||
    state === "QUESTIONS_READY" ||
    state === "AUDIO_READY" ||
    state === "VALIDATED" ||
    state === "PUBLISHED" ||
    state === "REVIEW_REQUIRED" ||
    state === "FAILED"
  ) {
    return state;
  }
  return null;
};

const applyReadinessProjectionEvent = async (task: TaskProgress, row: ListeningEventOutbox) => {
  const envelope = parseListeningEventEnvelope(row.envelope);
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;

  if (envelope.event_type === LISTENING_EVENT_TYPES.SECTION_STATE_CHANGED) {
    const state = resolveSectionLifecycleState(payload.state);
    const sectionNo = Number(payload.section_no ?? 1);
    const sectionId = String(payload.section_id ?? `${task.id}:section-${sectionNo}`);
    if (!state || !Number.isFinite(sectionNo) || sectionNo <= 0 || !sectionId.trim()) {
      return { applied: false as const, reason: "invalid_state_payload" as const };
    }

    await upsertReadinessFromSectionState({
      task,
      section: {
        section_id: sectionId,
        section_no: Math.round(sectionNo),
        state,
        attempt: Number(payload.attempt ?? 0),
        last_error_code:
          typeof payload.last_error_code === "string" ? payload.last_error_code : null,
        updated_at:
          typeof payload.occurred_at === "string" ? payload.occurred_at : row.createdAt.toISOString(),
        idempotency_key: envelope.idempotency_key,
      },
      lastEventId: envelope.event_id,
    });
    return { applied: true as const, type: envelope.event_type };
  }

  if (envelope.event_type === LISTENING_EVENT_TYPES.SECTION_PUBLISHED) {
    const sectionNo = Number(payload.section_no ?? 1);
    const sectionId = String(payload.section_id ?? task.id);
    const manifest = payload.manifest as ListeningSectionManifest | undefined;
    if (!manifest || !Number.isFinite(sectionNo) || sectionNo <= 0 || !sectionId.trim()) {
      return { applied: false as const, reason: "invalid_publish_payload" as const };
    }
    await upsertReadinessFromManifest({
      task,
      sectionId,
      sectionNo: Math.round(sectionNo),
      manifest,
      lastEventId: envelope.event_id,
    });
    return { applied: true as const, type: envelope.event_type };
  }

  return { applied: false as const, reason: "ignored_event_type" as const };
};

export const rebuildListeningReadinessFromOutbox = async (taskProgressId: string) => {
  const task = await storage.getTaskProgress(taskProgressId);
  if (!task) {
    return {
      ok: false as const,
      taskProgressId,
      message: "task_not_found",
    };
  }

  const outboxRows = await storage.listListeningEventOutboxByTask(taskProgressId);
  const rowsAsc = [...outboxRows].sort((a, b) => {
    const aOccurredAt = toMs((a.envelope as any)?.occurred_at);
    const bOccurredAt = toMs((b.envelope as any)?.occurred_at);
    if (aOccurredAt !== bOccurredAt) return aOccurredAt - bOccurredAt;
    return toMs(a.createdAt) - toMs(b.createdAt);
  });

  let applied = 0;
  let skipped = 0;
  const errors: Array<{ eventId: string; eventType: string; message: string }> = [];

  for (const row of rowsAsc) {
    try {
      const result = await applyReadinessProjectionEvent(task, row);
      if (result.applied) {
        applied += 1;
      } else {
        skipped += 1;
      }
    } catch (error: any) {
      errors.push({
        eventId: row.eventId,
        eventType: row.eventType,
        message: error?.message ?? "unknown",
      });
    }
  }

  return {
    ok: true as const,
    taskProgressId,
    totalOutboxEvents: rowsAsc.length,
    applied,
    skipped,
    errors,
  };
};
