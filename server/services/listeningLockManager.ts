import { randomUUID } from "crypto";
import { storage } from "../storage";

const DEFAULT_LOCK_TTL_MS = 60_000;

export const buildListeningLockKey = (sessionId: string, sectionNo: number, stepName: string) =>
  `${sessionId}:${sectionNo}:${stepName}`;

export const acquireListeningStepLock = async (params: {
  taskProgressId: string;
  userId: string;
  sectionNo: number;
  stepName: string;
  ownerId?: string;
  lockTtlMs?: number;
}) => {
  const ownerId = params.ownerId ?? `lock_owner_${randomUUID()}`;
  const ttlMs = params.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const lockKey = buildListeningLockKey(params.taskProgressId, params.sectionNo, params.stepName);
  const expiresAt = new Date(Date.now() + ttlMs);

  const row = await storage.acquireListeningExecutionLock({
    id: `lel_${randomUUID()}`,
    lockKey,
    taskProgressId: params.taskProgressId,
    userId: params.userId,
    stepName: params.stepName,
    ownerId,
    expiresAt,
  });

  if (!row) {
    return {
      ok: false as const,
      lockKey,
      ownerId,
      reason: "LOCK_EXISTS",
    };
  }

  return {
    ok: true as const,
    lockKey,
    ownerId,
    expiresAt,
  };
};

export const heartbeatListeningStepLock = async (params: {
  lockKey: string;
  ownerId: string;
  lockTtlMs?: number;
}) => {
  const ttlMs = params.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);
  return storage.heartbeatListeningExecutionLock(params.lockKey, params.ownerId, expiresAt);
};

export const releaseListeningStepLock = async (lockKey: string, ownerId: string) => {
  return storage.releaseListeningExecutionLock(lockKey, ownerId);
};
