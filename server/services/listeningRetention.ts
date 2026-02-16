import { lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  listeningEventOutbox,
  listeningGovernanceLedger,
  listeningPublishAudit,
  listeningPromptAssignment,
  listeningQueueMetric,
  taskAttempts,
} from "@shared/schema";

const RETENTION_DAYS = {
  content_artifacts: Math.max(30, Number(process.env.LISTENING_RETENTION_CONTENT_DAYS ?? 365)),
  attempts: Math.max(30, Number(process.env.LISTENING_RETENTION_ATTEMPTS_DAYS ?? 365)),
  analytics: Math.max(30, Number(process.env.LISTENING_RETENTION_ANALYTICS_DAYS ?? 180)),
  audit_logs: Math.max(30, Number(process.env.LISTENING_RETENTION_AUDIT_DAYS ?? 730)),
} as const;

const cutoffDate = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const countOlderThan = async (table: any, field: any, cutoff: Date) => {
  const rows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(table)
    .where(lte(field, cutoff));
  return Number(rows[0]?.total ?? 0);
};

export const getListeningRetentionPolicy = () => RETENTION_DAYS;

export const runListeningRetentionCleanup = async (params?: { dryRun?: boolean }) => {
  const dryRun = params?.dryRun !== false;
  const cutoffs = {
    content: cutoffDate(RETENTION_DAYS.content_artifacts),
    attempts: cutoffDate(RETENTION_DAYS.attempts),
    analytics: cutoffDate(RETENTION_DAYS.analytics),
    audit: cutoffDate(RETENTION_DAYS.audit_logs),
  };

  const counts = {
    eventOutbox: await countOlderThan(listeningEventOutbox, listeningEventOutbox.createdAt, cutoffs.content),
    attempts: await countOlderThan(taskAttempts, taskAttempts.createdAt, cutoffs.attempts),
    queueMetrics: await countOlderThan(listeningQueueMetric, listeningQueueMetric.createdAt, cutoffs.analytics),
    promptAssignments: await countOlderThan(listeningPromptAssignment, listeningPromptAssignment.createdAt, cutoffs.analytics),
    publishAudit: await countOlderThan(listeningPublishAudit, listeningPublishAudit.createdAt, cutoffs.audit),
    governanceLedger: await countOlderThan(listeningGovernanceLedger, listeningGovernanceLedger.createdAt, cutoffs.audit),
  };

  if (!dryRun) {
    await db.delete(listeningEventOutbox).where(lte(listeningEventOutbox.createdAt, cutoffs.content));
    await db.delete(taskAttempts).where(lte(taskAttempts.createdAt, cutoffs.attempts));
    await db.delete(listeningQueueMetric).where(lte(listeningQueueMetric.createdAt, cutoffs.analytics));
    await db.delete(listeningPromptAssignment).where(lte(listeningPromptAssignment.createdAt, cutoffs.analytics));
    await db.delete(listeningPublishAudit).where(lte(listeningPublishAudit.createdAt, cutoffs.audit));
    await db.delete(listeningGovernanceLedger).where(lte(listeningGovernanceLedger.createdAt, cutoffs.audit));
  }

  return {
    dryRun,
    retentionDays: RETENTION_DAYS,
    cutoffs: {
      content_artifacts: cutoffs.content.toISOString(),
      attempts: cutoffs.attempts.toISOString(),
      analytics: cutoffs.analytics.toISOString(),
      audit_logs: cutoffs.audit.toISOString(),
    },
    reconciled: {
      retained_window: RETENTION_DAYS,
      deletable_counts: counts,
      deleted_counts: dryRun ? null : counts,
    },
    generatedAt: new Date().toISOString(),
  };
};
