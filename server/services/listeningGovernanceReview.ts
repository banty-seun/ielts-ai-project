import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { listeningGovernanceReviewReport } from "@shared/schema";
import { db } from "../db";
import {
  computeGovernanceKpis,
  runGovernanceLedgerIntegrityCheck,
} from "./listeningGovernanceCompliance";

type GovernanceActionItem = {
  id: string;
  title: string;
  owner: string;
  due_at: string;
  status: "open" | "completed";
  mandatory: boolean;
  reason: string;
};

const ACTION_OWNER_DEFAULT = process.env.LISTENING_GOVERNANCE_ACTION_OWNER ?? "platform_ai";

const withDueDate = (days: number) => new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();

const hasFailure = (kpis: any, integrity: any) => {
  return (
    Number(kpis?.policy_violation_rate ?? 0) > 0.02 ||
    Number(kpis?.hallucination_rejection_rate ?? 0) > 0.05 ||
    Number(kpis?.override_rate ?? 0) > 0.05 ||
    Number(integrity?.totals?.gaps ?? 0) > 0
  );
};

const buildActionItems = (params: {
  kpis: Record<string, unknown>;
  integrity: Record<string, unknown>;
  repeatedFailure: boolean;
}) => {
  const items: GovernanceActionItem[] = [];
  const policyViolationRate = Number(params.kpis.policy_violation_rate ?? 0);
  const overrideRate = Number(params.kpis.override_rate ?? 0);
  const hallucinationRejectionRate = Number(params.kpis.hallucination_rejection_rate ?? 0);
  const integrityGaps = Number((params.integrity as any)?.totals?.gaps ?? 0);

  if (policyViolationRate > 0.02) {
    items.push({
      id: `ga_${randomUUID()}`,
      title: "Reduce policy violation rate",
      owner: ACTION_OWNER_DEFAULT,
      due_at: withDueDate(21),
      status: "open",
      mandatory: false,
      reason: `policy_violation_rate=${policyViolationRate}`,
    });
  }
  if (overrideRate > 0.05) {
    items.push({
      id: `ga_${randomUUID()}`,
      title: "Reduce manual override dependency",
      owner: ACTION_OWNER_DEFAULT,
      due_at: withDueDate(21),
      status: "open",
      mandatory: false,
      reason: `override_rate=${overrideRate}`,
    });
  }
  if (hallucinationRejectionRate > 0.05) {
    items.push({
      id: `ga_${randomUUID()}`,
      title: "Investigate hallucination rejections",
      owner: ACTION_OWNER_DEFAULT,
      due_at: withDueDate(14),
      status: "open",
      mandatory: false,
      reason: `hallucination_rejection_rate=${hallucinationRejectionRate}`,
    });
  }
  if (integrityGaps > 0) {
    items.push({
      id: `ga_${randomUUID()}`,
      title: "Close governance ledger integrity gaps",
      owner: ACTION_OWNER_DEFAULT,
      due_at: withDueDate(7),
      status: "open",
      mandatory: false,
      reason: `integrity_gaps=${integrityGaps}`,
    });
  }
  if (params.repeatedFailure) {
    items.push({
      id: `ga_${randomUUID()}`,
      title: "Mandatory backlog reprioritization before wider rollout",
      owner: ACTION_OWNER_DEFAULT,
      due_at: withDueDate(7),
      status: "open",
      mandatory: true,
      reason: "repeated_control_failures",
    });
  }
  return items;
};

export const generateGovernanceReviewReport = async (params: {
  generatedBy: string;
  windowFrom: Date;
  windowTo: Date;
}) => {
  const kpis = await computeGovernanceKpis({
    from: params.windowFrom,
    to: params.windowTo,
  });
  const integrity = await runGovernanceLedgerIntegrityCheck({
    from: params.windowFrom,
    to: params.windowTo,
  });
  const previous = await db
    .select()
    .from(listeningGovernanceReviewReport)
    .orderBy(desc(listeningGovernanceReviewReport.createdAt))
    .limit(1);
  const previousFailure = previous.length > 0 && hasFailure(previous[0].kpis as any, previous[0].integrity as any);
  const repeatedFailure = hasFailure(kpis as any, integrity as any) && previousFailure;
  const actionItems = buildActionItems({
    kpis: kpis as unknown as Record<string, unknown>,
    integrity: integrity as unknown as Record<string, unknown>,
    repeatedFailure,
  });
  const [row] = await db
    .insert(listeningGovernanceReviewReport)
    .values({
      id: `grr_${randomUUID()}`,
      windowFrom: params.windowFrom,
      windowTo: params.windowTo,
      kpis: kpis as unknown as Record<string, unknown>,
      integrity: integrity as unknown as Record<string, unknown>,
      actionItems: actionItems as unknown as Record<string, unknown>,
      rolloutBlocked: repeatedFailure,
      generatedBy: params.generatedBy,
      updatedAt: new Date(),
    })
    .returning();

  return row;
};

export const listGovernanceReviewReports = async (limit = 20) => {
  return db
    .select()
    .from(listeningGovernanceReviewReport)
    .orderBy(desc(listeningGovernanceReviewReport.createdAt))
    .limit(Math.max(1, Math.min(200, Number(limit))));
};

export const completeGovernanceReviewActionItem = async (params: {
  reportId: string;
  actionItemId: string;
  completedBy: string;
}) => {
  const [existing] = await db
    .select()
    .from(listeningGovernanceReviewReport)
    .where(eq(listeningGovernanceReviewReport.id, params.reportId))
    .limit(1);
  if (!existing) return null;
  const actionItems = Array.isArray(existing.actionItems) ? existing.actionItems : [];
  const nextItems = actionItems.map((item: any) =>
    String(item?.id) === params.actionItemId
      ? {
          ...item,
          status: "completed",
          completed_by: params.completedBy,
          completed_at: new Date().toISOString(),
        }
      : item,
  );
  const hasOpenMandatory = nextItems.some((item: any) => item?.mandatory === true && item?.status !== "completed");
  const [updated] = await db
    .update(listeningGovernanceReviewReport)
    .set({
      actionItems: nextItems as unknown as Record<string, unknown>,
      rolloutBlocked: hasOpenMandatory,
      updatedAt: new Date(),
    })
    .where(eq(listeningGovernanceReviewReport.id, params.reportId))
    .returning();
  return updated ?? null;
};

export const hasOutstandingMandatoryReprioritization = async () => {
  const [latest] = await db
    .select()
    .from(listeningGovernanceReviewReport)
    .orderBy(desc(listeningGovernanceReviewReport.createdAt))
    .limit(1);
  if (!latest) return false;
  const items = Array.isArray(latest.actionItems) ? latest.actionItems : [];
  return items.some((item: any) => item?.mandatory === true && item?.status !== "completed");
};

