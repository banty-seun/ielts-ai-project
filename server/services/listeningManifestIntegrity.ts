import { createHash } from "crypto";
import type { ListeningSectionManifest } from "@shared/listening";

export const LISTENING_MANIFEST_HASH_ALGORITHM = "sha256";
export const LISTENING_MANIFEST_HASH_VERSION = "1";

const toDeterministicJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => toDeterministicJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${toDeterministicJson(val)}`).join(",")}}`;
};

const buildManifestIntegrityPayload = (manifest: ListeningSectionManifest) => {
  return {
    manifest_version: manifest.manifest_version,
    section_id: manifest.section_id,
    section_no: manifest.section_no,
    question_json_url: manifest.question_json_url,
    anchors_url: manifest.anchors_url,
    answer_key_url: manifest.answer_key_url,
    audio_assets: manifest.audio_assets.map((asset) => ({
      segment_no: asset.segment_no,
      url: asset.url,
      duration_seconds: asset.duration_seconds,
      checksum_sha256: asset.checksum_sha256 ?? null,
    })),
    build_metadata: {
      build_id: manifest.build_metadata.build_id,
      build_version: manifest.build_metadata.build_version,
      built_at: manifest.build_metadata.built_at,
      validation_report_id: manifest.build_metadata.validation_report_id ?? null,
      validation_verdict: manifest.build_metadata.validation_verdict ?? null,
      trace_id: manifest.build_metadata.trace_id ?? null,
      correlation_id: manifest.build_metadata.correlation_id ?? null,
    },
    publish_version: manifest.publish_version ?? null,
    immutable: manifest.immutable,
  };
};

export const computeManifestChecksumSha256 = (manifest: ListeningSectionManifest) => {
  const payload = buildManifestIntegrityPayload(manifest);
  return createHash(LISTENING_MANIFEST_HASH_ALGORITHM).update(toDeterministicJson(payload)).digest("hex");
};

export const attachManifestIntegrity = (
  manifest: ListeningSectionManifest,
  signedAt?: string,
): ListeningSectionManifest => {
  const checksum = computeManifestChecksumSha256(manifest);
  return {
    ...manifest,
    integrity: {
      hash_algorithm: LISTENING_MANIFEST_HASH_ALGORITHM,
      hash_version: LISTENING_MANIFEST_HASH_VERSION,
      manifest_checksum_sha256: checksum,
      signed_at: signedAt ?? new Date().toISOString(),
    },
  };
};

export const verifyManifestIntegrity = (manifest: ListeningSectionManifest) => {
  const expected = manifest.integrity?.manifest_checksum_sha256 ?? null;
  if (!expected) {
    return {
      ok: false as const,
      error_code: "MANIFEST_INTEGRITY_MISSING",
      expected: null,
      computed: null,
    };
  }
  const computed = computeManifestChecksumSha256(manifest);
  if (expected !== computed) {
    return {
      ok: false as const,
      error_code: "MANIFEST_SIGNATURE_MISMATCH",
      expected,
      computed,
    };
  }
  return {
    ok: true as const,
    checksum: computed,
    hash_algorithm: manifest.integrity?.hash_algorithm ?? LISTENING_MANIFEST_HASH_ALGORITHM,
    hash_version: manifest.integrity?.hash_version ?? LISTENING_MANIFEST_HASH_VERSION,
  };
};
