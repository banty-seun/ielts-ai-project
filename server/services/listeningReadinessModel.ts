import { randomUUID } from "crypto";
import type { ListeningSectionStateRecord, ListeningSectionManifest } from "@shared/listening";
import type { TaskProgress } from "@shared/schema";
import { storage } from "../storage";

export const upsertReadinessFromSectionState = async (params: {
  task: TaskProgress;
  section: ListeningSectionStateRecord;
  lastEventId?: string;
}) => {
  const partReady = params.section.state === "PUBLISHED";
  const manifestStatus = partReady ? "ready" : params.section.state === "FAILED" ? "error" : "warming";
  return storage.upsertListeningReadinessModel({
    id: `lrm_${randomUUID()}`,
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.section.section_id,
    sectionNo: params.section.section_no,
    state: params.section.state,
    partReady,
    manifestStatus,
    lastEventId: params.lastEventId ?? null,
  });
};

export const upsertReadinessFromManifest = async (params: {
  task: TaskProgress;
  sectionId: string;
  sectionNo: number;
  manifest: ListeningSectionManifest;
  lastEventId?: string;
}) => {
  return storage.upsertListeningReadinessModel({
    id: `lrm_${randomUUID()}`,
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.sectionId,
    sectionNo: params.sectionNo,
    state: "PUBLISHED",
    partReady: true,
    manifestStatus: "ready",
    manifest: params.manifest as unknown as Record<string, unknown>,
    lastEventId: params.lastEventId ?? null,
  });
};

export const getReadinessModel = (taskProgressId: string, sectionId: string) => {
  return storage.getListeningReadinessModel(taskProgressId, sectionId);
};
