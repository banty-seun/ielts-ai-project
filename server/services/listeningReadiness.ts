import type { TaskProgress } from "@shared/schema";
import { getReadinessModel } from "./listeningReadinessModel";

const PREFETCH_STATUS_IDLE = "idle";
const PREFETCH_STATUS_QUEUED = "queued";
const PREFETCH_STATUS_RUNNING = "running";
const PREFETCH_STATUS_READY = "ready";
const PREFETCH_STATUS_READY_PARTIAL = "ready_partial";
const PREFETCH_STATUS_ERROR = "error";
const PREFETCH_READY_STATES = new Set([PREFETCH_STATUS_READY, PREFETCH_STATUS_READY_PARTIAL]);

const resolvePrefetchPhase = (status: string) => {
  if (status === PREFETCH_STATUS_IDLE) return "idle";
  if (status === PREFETCH_STATUS_QUEUED) return "queued";
  if (status === PREFETCH_STATUS_RUNNING) return "warming";
  if (status === PREFETCH_STATUS_ERROR) return "error";
  if (status === PREFETCH_STATUS_READY_PARTIAL) return "partial";
  return status;
};

export const buildManifestReadiness = async (task: TaskProgress, sectionId = task.id) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const sessionPrefetch = progressData.sessionPrefetch ?? {};
  const prefetchStatus = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
  const manifest = progressData.sectionManifest ?? null;
  const readModel = await getReadinessModel(task.id, sectionId);
  const manifestStatus = readModel?.manifestStatus ?? (manifest ? "ready" : (PREFETCH_READY_STATES.has(prefetchStatus) ? "ready_legacy" : "warming"));
  const partReady = readModel?.partReady ?? (Boolean(manifest) || (PREFETCH_READY_STATES.has(prefetchStatus) && Boolean(task.audioUrl)));

  return {
    manifestStatus,
    partReady,
    manifest: readModel?.manifest ?? manifest,
    prefetchStatus,
    prefetchPhase: resolvePrefetchPhase(prefetchStatus),
  };
};
