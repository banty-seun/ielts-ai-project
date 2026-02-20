import { randomUUID } from "crypto";
import type { ListeningPriorityClass } from "./listeningPriority";
import { storage } from "../storage";

export const publishQueueDelayMetric = async (params: {
  taskProgressId: string;
  userId: string;
  sectionNo: number;
  priorityClass: ListeningPriorityClass;
  stepName: string;
  enqueueToStartMs?: number | null;
  startToPublishMs?: number | null;
  metadata?: Record<string, unknown>;
}) => {
  const metric = await storage.insertListeningQueueMetric({
    id: `lqm_${randomUUID()}`,
    taskProgressId: params.taskProgressId,
    userId: params.userId,
    sectionNo: params.sectionNo,
    priorityClass: params.priorityClass,
    stepName: params.stepName,
    enqueueToStartMs: params.enqueueToStartMs ?? null,
    startToPublishMs: params.startToPublishMs ?? null,
    metadata: params.metadata ?? {},
  });

  const isP1 = params.priorityClass === "P1_CURRENT";
  const p1Breach = isP1 && (params.enqueueToStartMs ?? 0) > 45_000;
  if (p1Breach) {
    console.error("[ListeningQueue][Alert][P1_DELAY]", {
      taskId: params.taskProgressId,
      sectionNo: params.sectionNo,
      enqueueToStartMs: params.enqueueToStartMs,
      stepName: params.stepName,
    });
  }

  return metric;
};

export const publishDeadLetterMetric = async (params: {
  taskProgressId: string;
  userId: string;
  sectionNo: number;
  action: "created" | "replayed";
  errorCode?: string | null;
  attempts?: number | null;
  priorityClass?: ListeningPriorityClass;
  metadata?: Record<string, unknown>;
}) => {
  const metric = await storage.insertListeningQueueMetric({
    id: `lqm_${randomUUID()}`,
    taskProgressId: params.taskProgressId,
    userId: params.userId,
    sectionNo: params.sectionNo,
    priorityClass: params.priorityClass ?? "P3_LATER",
    stepName: params.action === "created" ? "dlq_created" : "dlq_replayed",
    metadata: {
      error_code: params.errorCode ?? null,
      attempts: Number(params.attempts ?? 0),
      action: params.action,
      emitted_at: new Date().toISOString(),
      ...(params.metadata ?? {}),
    },
  });

  const alertAttempts = Number(params.attempts ?? 0);
  if (params.action === "created" && alertAttempts >= 3) {
    console.error("[ListeningDLQ][Alert][REPEATED_FAILURE]", {
      taskId: params.taskProgressId,
      sectionNo: params.sectionNo,
      attempts: alertAttempts,
      errorCode: params.errorCode ?? null,
    });
  }

  return metric;
};

export type TtsQualityMetricPayload = {
  taskProgressId: string;
  userId: string;
  sectionNo: number;
  priorityClass?: ListeningPriorityClass;
  synthSuccessRate: number;
  averageDurationSec: number;
  retryCount: number;
  failureCodes: Record<string, number>;
  silenceOrCorruptionDetections: number;
  fallbackUsages: number;
  provider: string;
  providerVersion: string;
  pipelineVersion: string;
};

const QUALITY_FAILURE_ALERT_THRESHOLD = Math.max(
  1,
  Number(process.env.LISTENING_TTS_ALERT_FAILURE_THRESHOLD ?? 3),
);
const QUALITY_VALIDATION_ALERT_THRESHOLD = Math.max(
  1,
  Number(process.env.LISTENING_TTS_ALERT_VALIDATION_THRESHOLD ?? 2),
);

export const publishTtsQualityMetric = async (params: TtsQualityMetricPayload) => {
  const metric = await storage.insertListeningQueueMetric({
    id: `lqm_${randomUUID()}`,
    taskProgressId: params.taskProgressId,
    userId: params.userId,
    sectionNo: params.sectionNo,
    priorityClass: params.priorityClass ?? "P3_LATER",
    stepName: "tts_quality",
    metadata: {
      synth_success_rate: params.synthSuccessRate,
      average_duration_sec: params.averageDurationSec,
      retry_count: params.retryCount,
      failure_codes: params.failureCodes,
      silence_or_corruption_detections: params.silenceOrCorruptionDetections,
      fallback_usages: params.fallbackUsages,
      provider: params.provider,
      provider_version: params.providerVersion,
      pipeline_version: params.pipelineVersion,
      emitted_at: new Date().toISOString(),
    },
  });

  const totalFailures = Object.values(params.failureCodes).reduce((sum, value) => sum + Number(value || 0), 0);
  if (totalFailures >= QUALITY_FAILURE_ALERT_THRESHOLD) {
    console.error("[ListeningTTS][Alert][FAILURE_SPIKE]", {
      taskId: params.taskProgressId,
      sectionNo: params.sectionNo,
      totalFailures,
      failureCodes: params.failureCodes,
      threshold: QUALITY_FAILURE_ALERT_THRESHOLD,
    });
  }

  if (params.silenceOrCorruptionDetections >= QUALITY_VALIDATION_ALERT_THRESHOLD) {
    console.error("[ListeningTTS][Alert][VALIDATION_SPIKE]", {
      taskId: params.taskProgressId,
      sectionNo: params.sectionNo,
      detections: params.silenceOrCorruptionDetections,
      threshold: QUALITY_VALIDATION_ALERT_THRESHOLD,
    });
  }

  if (params.fallbackUsages > 0) {
    console.warn("[ListeningTTS][FallbackUsage]", {
      taskId: params.taskProgressId,
      sectionNo: params.sectionNo,
      fallbackUsages: params.fallbackUsages,
      provider: params.provider,
    });
  }

  return metric;
};
