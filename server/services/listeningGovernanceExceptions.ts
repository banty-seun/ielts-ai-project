import { randomUUID } from "crypto";
import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { listeningGovernanceException } from "@shared/schema";
import { db } from "../db";

export const createGovernanceException = async (params: {
  scopeType: "review_override" | "policy_bypass";
  scopeRef?: string | null;
  riskClass: string;
  owner: string;
  createdBy: string;
  approverId: string;
  reasonCode: string;
  reasonNotes: string;
  incidentTicket?: string | null;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}) => {
  const now = new Date();
  if (params.expiresAt.getTime() <= now.getTime()) {
    throw new Error("GOVERNANCE_EXCEPTION_EXPIRES_AT_INVALID");
  }
  const [row] = await db
    .insert(listeningGovernanceException)
    .values({
      id: `gex_${randomUUID()}`,
      scopeType: params.scopeType,
      scopeRef: params.scopeRef ?? null,
      riskClass: params.riskClass,
      owner: params.owner,
      createdBy: params.createdBy,
      approverId: params.approverId,
      reasonCode: params.reasonCode,
      reasonNotes: params.reasonNotes,
      incidentTicket: params.incidentTicket ?? null,
      expiresAt: params.expiresAt,
      status: "active",
      metadata: params.metadata ?? {},
    })
    .returning();
  return row;
};

export const listGovernanceExceptions = async (params?: {
  status?: "active" | "revoked" | "expired";
  scopeType?: string;
  limit?: number;
}) => {
  const limit = Math.max(1, Math.min(500, Number(params?.limit ?? 100)));
  const conditions = [];
  if (params?.status) {
    conditions.push(eq(listeningGovernanceException.status, params.status));
  }
  if (params?.scopeType) {
    conditions.push(eq(listeningGovernanceException.scopeType, params.scopeType));
  }
  return db
    .select()
    .from(listeningGovernanceException)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(listeningGovernanceException.createdAt))
    .limit(limit);
};

export const expireGovernanceExceptions = async () => {
  const now = new Date();
  const rows = await db
    .update(listeningGovernanceException)
    .set({
      status: "expired",
      updatedAt: now,
    })
    .where(
      and(
        eq(listeningGovernanceException.status, "active"),
        lte(listeningGovernanceException.expiresAt, now),
      ),
    )
    .returning();
  return rows;
};

export const revokeGovernanceException = async (params: {
  id: string;
  revokedBy: string;
  reason?: string;
}) => {
  const [row] = await db
    .update(listeningGovernanceException)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        revoked_by: params.revokedBy,
        revoke_reason: params.reason ?? null,
      },
    })
    .where(eq(listeningGovernanceException.id, params.id))
    .returning();
  return row ?? null;
};

export const findActiveGovernanceException = async (params: {
  scopeType: "review_override" | "policy_bypass";
  scopeRef?: string | null;
  riskClass?: string;
}) => {
  await expireGovernanceExceptions();
  const now = new Date();
  const conditions = [
    eq(listeningGovernanceException.scopeType, params.scopeType),
    eq(listeningGovernanceException.status, "active"),
    gt(listeningGovernanceException.expiresAt, now),
  ];
  if (params.scopeRef) {
    conditions.push(eq(listeningGovernanceException.scopeRef, params.scopeRef));
  }
  if (params.riskClass) {
    conditions.push(eq(listeningGovernanceException.riskClass, params.riskClass));
  }
  const [row] = await db
    .select()
    .from(listeningGovernanceException)
    .where(and(...conditions))
    .orderBy(desc(listeningGovernanceException.createdAt))
    .limit(1);
  return row ?? null;
};

export const listActiveGovernanceExceptionsExpiringSoon = async (withinHours: number) => {
  const now = new Date();
  const cutoff = new Date(now.getTime() + Math.max(1, withinHours) * 60 * 60 * 1000);
  return db
    .select()
    .from(listeningGovernanceException)
    .where(
      and(
        eq(listeningGovernanceException.status, "active"),
        gt(listeningGovernanceException.expiresAt, now),
        lte(listeningGovernanceException.expiresAt, cutoff),
        or(
          isNull(listeningGovernanceException.revokedAt),
          gt(listeningGovernanceException.expiresAt, now),
        ),
      ),
    )
    .orderBy(listeningGovernanceException.expiresAt);
};

