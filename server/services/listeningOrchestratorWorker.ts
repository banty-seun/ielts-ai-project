import { storage } from "../storage";
import { validateSequentialSectionPolicy } from "./listeningSectionState";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./listeningObservability";

export type ListeningOrchestratorJob = {
  taskId: string;
  userId: string;
  sectionNo: number;
  priorityClass: "P1_CURRENT" | "P2_NEXT_24H" | "P3_LATER";
  priorityScore: number;
  correlationId?: string;
  traceId?: string;
};

type QueueRecord = ListeningOrchestratorJob & {
  enqueuedAtMs: number;
  nextRunAtMs: number;
  attempts: number;
};

type JobExecutor = (job: ListeningOrchestratorJob) => Promise<void>;

const PRIORITY_ORDER: Record<ListeningOrchestratorJob["priorityClass"], number> = {
  P1_CURRENT: 3,
  P2_NEXT_24H: 2,
  P3_LATER: 1,
};

const queue = new Map<string, QueueRecord>();
let processorTimer: NodeJS.Timeout | null = null;
let executor: JobExecutor | null = null;
let processing = false;

const getQueueKey = (job: Pick<ListeningOrchestratorJob, "taskId" | "sectionNo">) => `${job.taskId}:${job.sectionNo}`;

const pickNextJob = () => {
  const now = Date.now();
  const candidates = Array.from(queue.values()).filter((record) => record.nextRunAtMs <= now);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const classDiff = PRIORITY_ORDER[b.priorityClass] - PRIORITY_ORDER[a.priorityClass];
    if (classDiff !== 0) return classDiff;
    const scoreDiff = b.priorityScore - a.priorityScore;
    if (scoreDiff !== 0) return scoreDiff;
    return a.enqueuedAtMs - b.enqueuedAtMs;
  });
  return candidates[0];
};

const shouldRequeueForOrderGuard = async (job: QueueRecord) => {
  const task = await storage.getTaskProgress(job.taskId);
  if (!task) return false;
  const ordering = await validateSequentialSectionPolicy(task, job.sectionNo);
  if (ordering.ok) return false;

  console.warn("[ListeningWorker][ORDER_GUARD_FAILED]", {
    taskId: job.taskId,
    sectionNo: job.sectionNo,
    reason: ordering.error,
  });
  job.attempts += 1;
  job.nextRunAtMs = Date.now() + Math.min(60_000, 5_000 * job.attempts);
  queue.set(getQueueKey(job), job);
  return true;
};

const processOne = async () => {
  if (processing || !executor) return;
  const next = pickNextJob();
  if (!next) return;

  processing = true;
  queue.delete(getQueueKey(next));
  const context = createTelemetryContext({
    traceId: next.traceId ?? null,
    requestId: next.traceId ?? null,
    userId: next.userId,
    sessionId: next.correlationId ?? next.taskId,
    sectionId: `${next.taskId}:section-${next.sectionNo}`,
    partId: String(next.sectionNo),
    agentName: "listening_orchestrator_worker",
    tags: {
      priority_class: next.priorityClass,
      priority_score: next.priorityScore,
    },
  });
  const span = startListeningStageSpan({
    stage: "section_scheduled",
    context,
    attempt: next.attempts + 1,
    metadata: {
      task_id: next.taskId,
      section_no: next.sectionNo,
    },
    taskProgressId: next.taskId,
  });

  try {
    const blocked = await shouldRequeueForOrderGuard(next);
    if (blocked) {
      await finishListeningStageSpan(span, {
        success: false,
        errorClass: "ORDER_GUARD_FAILED",
      });
      return;
    }
    await executor(next);
    await finishListeningStageSpan(span, { success: true });
  } catch (error) {
    next.attempts += 1;
    if (next.attempts <= 3) {
      next.nextRunAtMs = Date.now() + Math.min(120_000, 10_000 * next.attempts);
      queue.set(getQueueKey(next), next);
      console.warn("[ListeningWorker][RetryQueued]", {
        taskId: next.taskId,
        sectionNo: next.sectionNo,
        attempts: next.attempts,
        nextRunAtMs: next.nextRunAtMs,
      });
    } else {
      console.error("[ListeningWorker][DropAfterRetries]", {
        taskId: next.taskId,
        sectionNo: next.sectionNo,
        attempts: next.attempts,
      });
    }
    await finishListeningStageSpan(span, {
      success: false,
      errorClass: (error as any)?.code ?? (error as any)?.name ?? "executor_error",
    });
  } finally {
    processing = false;
  }
};

const ensureWorkerTimer = () => {
  if (processorTimer) return;
  processorTimer = setInterval(() => {
    void processOne();
  }, 250);
  if (typeof processorTimer.unref === "function") {
    processorTimer.unref();
  }
};

export const registerListeningOrchestratorExecutor = (nextExecutor: JobExecutor) => {
  executor = nextExecutor;
  ensureWorkerTimer();
};

export const enqueueListeningOrchestratorJob = (job: ListeningOrchestratorJob) => {
  const key = getQueueKey(job);
  const now = Date.now();
  const existing = queue.get(key);
  if (existing) {
    existing.priorityClass = PRIORITY_ORDER[job.priorityClass] > PRIORITY_ORDER[existing.priorityClass]
      ? job.priorityClass
      : existing.priorityClass;
    existing.priorityScore = Math.max(existing.priorityScore, job.priorityScore);
    existing.nextRunAtMs = Math.min(existing.nextRunAtMs, now);
    queue.set(key, existing);
    return { deduped: true as const };
  }

  queue.set(key, {
    ...job,
    enqueuedAtMs: now,
    nextRunAtMs: now,
    attempts: 0,
  });
  ensureWorkerTimer();
  return { deduped: false as const };
};

export const getListeningOrchestratorQueueSnapshot = () => {
  return Array.from(queue.values())
    .sort((a, b) => a.nextRunAtMs - b.nextRunAtMs)
    .map((entry) => ({
      taskId: entry.taskId,
      sectionNo: entry.sectionNo,
      priorityClass: entry.priorityClass,
      priorityScore: entry.priorityScore,
      attempts: entry.attempts,
      nextRunAtMs: entry.nextRunAtMs,
      enqueuedAtMs: entry.enqueuedAtMs,
    }));
};

export const __resetListeningOrchestratorWorkerForTests = () => {
  queue.clear();
  processing = false;
  executor = null;
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
};
