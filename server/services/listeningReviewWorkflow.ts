import { randomUUID } from "crypto";
import type { TaskProgress } from "@shared/schema";
import { LISTENING_EVENT_TOPICS, type ListeningValidationReport } from "@shared/listening";
import { listeningReviewActionTypeSchema } from "@shared/listening";
import { storage } from "../storage";

const DEFAULT_REVIEW_SLA_MINUTES = Number(process.env.LISTENING_REVIEW_SLA_MINUTES ?? 120);

const isQueueOpenStatus = (status: string) => {
  return status === "OPEN" || status === "IN_REVIEW";
};

export const shouldRouteValidationToReviewQueue = (report: ListeningValidationReport) => {
  return report.verdict === "FAIL" && report.severity === "high";
};

export const enqueueValidationReview = async (params: {
  task: TaskProgress;
  report: ListeningValidationReport;
  traceId?: string;
  correlationId?: string;
}) => {
  const now = new Date();
  const slaDueAt = new Date(now.getTime() + DEFAULT_REVIEW_SLA_MINUTES * 60_000);
  const topFailure = params.report.gates.find((gate) => gate.status === "fail");
  const queueItem = await storage.insertListeningReviewQueue({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: Number(params.report.section_no ?? 1),
    validationReportId: params.report.report_id,
    status: "OPEN",
    severity: params.report.severity,
    failureType: String(topFailure?.gate_name ?? "validation"),
    failureCode: String(params.report.top_error_code ?? topFailure?.error_code ?? "VALIDATION_FAILED"),
    context: {
      report: params.report,
      failed_checks: params.report.gates.filter((gate) => gate.status === "fail"),
      artifacts: {
        validation_report_id: params.report.report_id,
        timing_artifact_present: Boolean(params.report.timing_artifact),
      },
      replay_options: ["HOLD", "REQUEUE", "FORCE_REGENERATE", "APPROVE_WITH_EXCEPTION"],
    },
    slaDueAt,
    createdAt: now,
    updatedAt: now,
  });

  await storage.insertListeningPublishAudit({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: Number(params.report.section_no ?? 1),
    eventType: "REVIEW_QUEUED",
    actorId: "system",
    actorType: "system",
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    validationVerdicts: params.report as unknown as Record<string, unknown>,
    payload: {
      review_queue_id: queueItem.id,
      sla_due_at: queueItem.slaDueAt,
      failure_code: queueItem.failureCode,
    },
  });

  return queueItem;
};

export const applyReviewAction = async (params: {
  reviewQueueId: string;
  action: string;
  reviewerId: string;
  reasonNotes: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
  correlationId?: string;
}) => {
  const action = listeningReviewActionTypeSchema.parse(params.action);
  const item = await storage.getListeningReviewQueueById(params.reviewQueueId);
  if (!item) {
    throw new Error("REVIEW_QUEUE_ITEM_NOT_FOUND");
  }

  const now = new Date();
  let nextStatus: "OPEN" | "APPROVED" | "REJECTED" | "REQUEUED";
  if (action === "APPROVE_WITH_EXCEPTION" || action === "APPROVE_WITH_OVERRIDE") {
    nextStatus = "APPROVED";
  } else if (action === "REJECT") {
    nextStatus = "REJECTED";
  } else if (action === "HOLD") {
    nextStatus = "OPEN";
  } else if (action === "REQUEUE" || action === "REQUEUE_STEP" || action === "FORCE_REGENERATE") {
    nextStatus = "REQUEUED";
  } else {
    nextStatus = "OPEN";
  }

  const updated = await storage.updateListeningReviewQueue(item.id, {
    status: nextStatus,
    resolvedAt: nextStatus === "OPEN" ? null : now,
    updatedAt: now,
  });

  const reviewAction = await storage.insertListeningReviewAction({
    reviewQueueId: item.id,
    taskProgressId: item.taskProgressId,
    userId: item.userId,
    sectionId: item.sectionId,
    sectionNo: item.sectionNo,
    action,
    reviewerId: params.reviewerId,
    reasonNotes: params.reasonNotes,
    metadata: params.metadata ?? null,
    createdAt: now,
  });

  await storage.insertListeningPublishAudit({
    taskProgressId: item.taskProgressId,
    userId: item.userId,
    sectionId: item.sectionId,
    sectionNo: item.sectionNo,
    eventType: action,
    actorId: params.reviewerId,
    actorType: "reviewer",
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    overrideAction: action,
    payload: {
      reason_notes: params.reasonNotes,
      metadata: params.metadata ?? null,
      review_queue_id: item.id,
      review_action_id: reviewAction.id,
    },
  });

  return {
    reviewQueue: updated,
    reviewAction,
  };
};

export const escalateOverdueReviewItems = async () => {
  const { rows } = await storage.listListeningReviewQueue({
    page: 1,
    pageSize: 200,
  });
  const now = new Date();
  const escalated: string[] = [];
  for (const item of rows) {
    if (!isQueueOpenStatus(item.status)) continue;
    if (!item.slaDueAt) continue;
    if (item.escalatedAt) continue;
    if (item.slaDueAt.getTime() > now.getTime()) continue;

    const updated = await storage.updateListeningReviewQueue(item.id, {
      escalatedAt: now,
      updatedAt: now,
    });
    if (updated) {
      escalated.push(updated.id);
      await storage.insertListeningPublishAudit({
        taskProgressId: item.taskProgressId,
        userId: item.userId,
        sectionId: item.sectionId,
        sectionNo: item.sectionNo,
        eventType: "REVIEW_SLA_ESCALATED",
        actorId: "system",
        actorType: "system",
        payload: {
          review_queue_id: item.id,
          sla_due_at: item.slaDueAt,
        },
      });

      // Alert emission for overdue reviews via durable outbox.
      await storage.insertListeningEventOutbox({
        id: randomUUID(),
        taskProgressId: item.taskProgressId,
        userId: item.userId,
        topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
        eventType: "listening.review.sla.escalated",
        eventVersion: "1.0.0",
        eventId: `review-sla-${item.id}-${randomUUID()}`,
        envelope: {
          review_queue_id: item.id,
          task_progress_id: item.taskProgressId,
          section_id: item.sectionId,
          section_no: item.sectionNo,
          severity: item.severity,
          sla_due_at: item.slaDueAt?.toISOString?.() ?? null,
          escalated_at: now.toISOString(),
        },
      });
    }
  }
  return escalated;
};

export const buildReviewQueueMetrics = async () => {
  const { rows } = await storage.listListeningReviewQueue({ page: 1, pageSize: 500 });
  const now = Date.now();
  const totalItems = rows.length;
  const openItems = rows.filter((row) => isQueueOpenStatus(row.status)).length;
  const overdueItems = rows.filter(
    (row) => isQueueOpenStatus(row.status) && row.slaDueAt && row.slaDueAt.getTime() < now,
  ).length;

  const resolvedRows = rows.filter((row) => row.resolvedAt && row.createdAt);
  const resolutionMinutes =
    resolvedRows.length > 0
      ? resolvedRows.reduce((sum, row) => {
          return sum + Math.max(0, row.resolvedAt!.getTime() - row.createdAt.getTime()) / 60_000;
        }, 0) / resolvedRows.length
      : 0;

  const approved = rows.filter((row) => row.status === "APPROVED").length;
  const terminal = rows.filter((row) => row.status === "APPROVED" || row.status === "REJECTED").length;
  const approvalRate = terminal > 0 ? approved / terminal : 0;

  return {
    total_items: totalItems,
    open_items: openItems,
    overdue_items: overdueItems,
    manual_review_volume: totalItems,
    approval_rate: Number(approvalRate.toFixed(4)),
    mean_resolution_minutes: Number(resolutionMinutes.toFixed(2)),
  };
};
