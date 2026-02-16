import type { TaskProgress } from "@shared/schema";
import type { ListeningSectionManifest } from "@shared/listening";
import { storage } from "../storage";
import {
  attachManifestIntegrity,
  verifyManifestIntegrity,
  LISTENING_MANIFEST_HASH_ALGORITHM,
  LISTENING_MANIFEST_HASH_VERSION,
} from "./listeningManifestIntegrity";
import { recordGovernanceLedgerEntry } from "./listeningGovernanceLedger";

export const publishManifestVersion = async (params: {
  task: TaskProgress;
  manifest: ListeningSectionManifest;
  validationReportId?: string | null;
  publishedBy: string;
  traceId?: string;
  correlationId?: string;
}) => {
  const existing = await storage.listListeningManifestVersions(params.task.id);
  const nextVersionNo = (existing[0]?.versionNo ?? 0) + 1;
  const withVersion = {
    ...params.manifest,
    publish_version: nextVersionNo,
    published_at: new Date().toISOString(),
  } as ListeningSectionManifest;
  const signedManifest = attachManifestIntegrity(withVersion);
  const integrity = verifyManifestIntegrity(signedManifest);
  if (!integrity.ok) {
    throw new Error(integrity.error_code);
  }

  await storage.activateListeningManifestVersion(params.task.id, -1); // Clears current active rows.

  const version = await storage.insertListeningManifestVersion({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: Number(signedManifest.section_no ?? 1),
    versionNo: nextVersionNo,
    isActive: true,
    manifest: signedManifest as unknown as Record<string, unknown>,
    manifestChecksumSha256: integrity.checksum,
    hashAlgorithm: LISTENING_MANIFEST_HASH_ALGORITHM,
    hashVersion: LISTENING_MANIFEST_HASH_VERSION,
    validationReportId: params.validationReportId ?? null,
    generationTraceId: params.traceId ?? null,
    generationCorrelationId: params.correlationId ?? null,
    publishedBy: params.publishedBy,
  });

  await storage.insertListeningPublishAudit({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: Number(signedManifest.section_no ?? 1),
    manifestVersionId: version.id,
    eventType: "PUBLISHED",
    actorId: params.publishedBy,
    actorType: "system",
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    validationVerdicts: {
      validation_report_id: params.validationReportId ?? null,
      verdict: signedManifest.build_metadata.validation_verdict ?? null,
    },
    payload: {
      manifest_version: nextVersionNo,
      checksum: integrity.checksum,
    },
  });
  const governance = (signedManifest.build_metadata as any)?.governance ?? {};
  await recordGovernanceLedgerEntry({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: Number(signedManifest.section_no ?? 1),
    sessionId: params.correlationId ?? null,
    policyVersion: String(governance.policy_version ?? "J-unknown"),
    promptVersion: String(governance?.prompt_model?.prompt_version ?? "unknown"),
    promptRegistryId: String(governance?.prompt_model?.prompt_registry_id ?? "unknown"),
    modelId: String(governance?.prompt_model?.model_id ?? "unknown"),
    validatorSetVersion: String(governance.validator_set_version ?? "unknown"),
    validationVerdict: signedManifest.build_metadata.validation_verdict ?? null,
    actionType: "MANIFEST_PUBLISHED",
    actorId: params.publishedBy,
    actorType: "system",
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    metadata: {
      manifest_version: nextVersionNo,
      checksum: integrity.checksum,
    },
  });

  return {
    manifest: signedManifest,
    version,
  };
};

export const rollbackManifestVersion = async (params: {
  task: TaskProgress;
  versionNo: number;
  actorId: string;
  traceId?: string;
  correlationId?: string;
}) => {
  const activated = await storage.activateListeningManifestVersion(params.task.id, params.versionNo);
  if (!activated) {
    throw new Error("MANIFEST_VERSION_NOT_FOUND");
  }

  await storage.insertListeningPublishAudit({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: activated.sectionNo,
    manifestVersionId: activated.id,
    eventType: "ROLLBACK",
    actorId: params.actorId,
    actorType: "api",
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    payload: {
      rollback_to_version: params.versionNo,
    },
  });
  await recordGovernanceLedgerEntry({
    taskProgressId: params.task.id,
    userId: params.task.userId,
    sectionId: params.task.id,
    sectionNo: activated.sectionNo,
    sessionId: params.correlationId ?? null,
    policyVersion: "J-1.0.0",
    actionType: "MANIFEST_ROLLBACK",
    actorId: params.actorId,
    actorType: "api",
    traceId: params.traceId ?? null,
    correlationId: params.correlationId ?? null,
    metadata: {
      rollback_to_version: params.versionNo,
    },
  });

  return activated;
};

export const getActiveManifestVersionWithIntegrity = async (taskProgressId: string) => {
  const active = await storage.getActiveListeningManifestVersion(taskProgressId);
  if (!active) return null;
  const manifest = active.manifest as unknown as ListeningSectionManifest;
  const integrity = verifyManifestIntegrity(manifest);
  return {
    active,
    manifest,
    integrity,
  };
};
