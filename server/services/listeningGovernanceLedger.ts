import { randomUUID } from "crypto";
import { storage } from "../storage";

export const recordGovernanceLedgerEntry = async (params: {
  taskProgressId?: string | null;
  userId?: string | null;
  sectionId?: string | null;
  sectionNo?: number | null;
  sessionId?: string | null;
  attemptId?: string | null;
  policyVersion: string;
  promptVersion?: string | null;
  promptRegistryId?: string | null;
  modelId?: string | null;
  validatorSetVersion?: string | null;
  validationVerdict?: string | null;
  actionType: string;
  actorId: string;
  actorType: "system" | "reviewer" | "api";
  approverId?: string | null;
  traceId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  return storage.insertListeningGovernanceLedger({
    id: `glg_${randomUUID()}`,
    taskProgressId: params.taskProgressId ?? null,
    userId: params.userId ?? null,
    sectionId: params.sectionId ?? null,
    sectionNo:
      Number.isFinite(Number(params.sectionNo)) && Number(params.sectionNo) > 0
        ? Number(params.sectionNo)
        : null,
    sessionId: params.sessionId ?? null,
    attemptId: params.attemptId ?? null,
    policyVersion: params.policyVersion,
    promptVersion: params.promptVersion ?? null,
    promptRegistryId: params.promptRegistryId ?? null,
    modelId: params.modelId ?? null,
    validatorSetVersion: params.validatorSetVersion ?? null,
    validationVerdict: params.validationVerdict ?? null,
    actionType: params.actionType,
    actorId: params.actorId,
    actorType: params.actorType,
    approverId: params.approverId ?? null,
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    metadata: params.metadata ?? null,
  });
};

