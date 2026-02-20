import { randomUUID } from "crypto";
import { LISTENING_EVENT_TOPICS } from "@shared/listening";
import type { TaskProgress } from "@shared/schema";
import { publishListeningEventDurably } from "./listeningEvents";
import { publishDeadLetterMetric } from "./listeningTelemetry";
import { storage } from "../storage";

export const routeListeningTerminalFailureToDLQ = async (params: {
  task: TaskProgress;
  sectionId: string;
  sectionNo: number;
  stepName: string;
  errorCode: string;
  attempts: number;
  context?: Record<string, unknown>;
  traceId: string;
  correlationId: string;
}) => {
  const record = await storage.insertListeningDeadLetter({
    id: `ldl_${randomUUID()}`,
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.sectionId,
    sectionNo: params.sectionNo,
    stepName: params.stepName,
    errorCode: params.errorCode,
    attempts: params.attempts,
    context: params.context ?? {},
  });

  const eventResult = await publishListeningEventDurably({
    topic: LISTENING_EVENT_TOPICS.DEADLETTER,
    eventType: "listening.deadletter.created",
    eventVersion: "1.0.0",
    producer: "listening-orchestrator",
    traceId: params.traceId,
    correlationId: params.correlationId,
    idempotencyKey: `${params.task.id}:${params.sectionNo}:${params.stepName}:deadletter:v1`,
    userId: params.task.userId,
    taskProgressId: params.task.id,
    payload: {
      deadletter_id: record.id,
      session: params.task.id,
      section: params.sectionNo,
      step: params.stepName,
      error_code: params.errorCode,
      attempts: params.attempts,
      context: params.context ?? {},
    },
  });

  console.error("[ListeningDLQ][Created]", {
    id: record.id,
    taskId: params.task.id,
    sectionNo: params.sectionNo,
    stepName: params.stepName,
    errorCode: params.errorCode,
    attempts: params.attempts,
  });
  await publishDeadLetterMetric({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionNo: params.sectionNo,
    action: "created",
    errorCode: params.errorCode,
    attempts: params.attempts,
    metadata: {
      deadletter_id: record.id,
      step_name: params.stepName,
      outbox_persisted: eventResult.outboxPersisted,
    },
  });

  return { record, event: eventResult.event };
};

export const replayListeningDLQItem = async (id: string) => {
  const marked = await storage.markListeningDeadLetterReplayed(id);
  if (!marked) return null;
  return marked;
};
