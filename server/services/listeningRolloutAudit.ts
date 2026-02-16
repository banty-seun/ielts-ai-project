import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { listeningRolloutAudit } from "@shared/schema";

export type ListeningRolloutActionType =
  | "ROLLBACK_SWITCH"
  | "CANARY_OVERRIDE"
  | "CANARY_PROMOTION";

const MISSING_RELATION_ERROR_CODE = "42P01";

const hasMissingRelationMessage = (value: unknown) => {
  const text = String(value ?? "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("relation") &&
    text.includes("listening_rollout_audit") &&
    text.includes("does not exist")
  );
};

export const isListeningRolloutAuditStorageMissingError = (error: unknown) => {
  const candidate = error as Record<string, any> | null;
  const code = String(candidate?.code ?? candidate?.cause?.code ?? "").trim();
  if (code === MISSING_RELATION_ERROR_CODE) return true;
  if (hasMissingRelationMessage(candidate?.message)) return true;
  if (hasMissingRelationMessage(candidate?.cause?.message)) return true;
  return false;
};

export const recordListeningRolloutAudit = async (params: {
  actionType: ListeningRolloutActionType;
  actorId: string;
  reason: string;
  incidentTicket?: string | null;
  affectedCohorts: string[];
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) => {
  const [row] = await db
    .insert(listeningRolloutAudit)
    .values({
      id: `lra_${randomUUID()}`,
      actionType: params.actionType,
      actorId: params.actorId,
      reason: params.reason,
      incidentTicket: params.incidentTicket ?? null,
      affectedCohorts: params.affectedCohorts,
      metadata: params.metadata ?? {},
      createdAt: params.createdAt ?? new Date(),
    })
    .returning();
  return row;
};

export const listListeningRolloutAudit = async (params?: {
  actionType?: ListeningRolloutActionType;
  limit?: number;
}) => {
  const limit = Math.max(1, Math.min(500, Number(params?.limit ?? 100)));
  const conditions = [];
  if (params?.actionType) {
    conditions.push(eq(listeningRolloutAudit.actionType, params.actionType));
  }
  return db
    .select()
    .from(listeningRolloutAudit)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(listeningRolloutAudit.createdAt))
    .limit(limit);
};

export const getLatestListeningRolloutAudit = async (actionType?: ListeningRolloutActionType) => {
  const [row] = await listListeningRolloutAudit({
    actionType,
    limit: 1,
  });
  return row ?? null;
};
