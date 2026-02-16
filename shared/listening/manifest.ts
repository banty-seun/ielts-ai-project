import { z } from "zod";
import { listeningGovernanceProvenanceSchema } from "./governance";

export const listeningAudioAssetSchema = z.object({
  segment_no: z.number().int().positive(),
  accent: z.string().min(1),
  url: z.string().min(1),
  duration_seconds: z.number().positive(),
  voice_id: z.string().min(1).nullable().optional(),
  provider: z.string().min(1).optional(),
  provider_version: z.string().min(1).optional(),
  pipeline_version: z.string().min(1).optional(),
  checksum_sha256: z.string().min(1).nullable().optional(),
  status: z.enum(["success", "failed"]).optional(),
  url_mode: z.enum(["public", "signed"]).optional(),
  url_expires_at: z.string().datetime().nullable().optional(),
  retrieval_verified: z.boolean().optional(),
  section_no: z.number().int().positive().optional(),
  duration_source: z.enum(["derived_media", "word_count_fallback", "metadata"]).nullable().optional(),
});

export const listeningSectionManifestSchema = z.object({
  manifest_version: z.string().min(1),
  section_id: z.string().min(1),
  section_no: z.number().int().positive(),
  question_json_url: z.string().min(1),
  audio_assets: z.array(listeningAudioAssetSchema).min(1),
  anchors_url: z.string().min(1),
  answer_key_url: z.string().min(1),
  build_metadata: z.object({
    build_id: z.string().min(1),
    build_version: z.string().min(1),
    built_at: z.string().datetime(),
    validation_report_id: z.string().min(1).optional(),
    validation_verdict: z.enum(["PASS", "FAIL"]).optional(),
    trace_id: z.string().min(1).optional(),
    correlation_id: z.string().min(1).optional(),
    delivery_mode: z.enum(["public", "signed"]).optional(),
    qa_summary: z
      .object({
        total_assets: z.number().int().nonnegative(),
        retrieval_verified_assets: z.number().int().nonnegative(),
        failed_assets: z.number().int().nonnegative(),
        validator_failures: z.number().int().nonnegative(),
      })
      .optional(),
    governance: listeningGovernanceProvenanceSchema.optional(),
  }),
  integrity: z
    .object({
      hash_algorithm: z.string().min(1),
      hash_version: z.string().min(1),
      manifest_checksum_sha256: z.string().min(1),
      signed_at: z.string().datetime(),
    })
    .optional(),
  publish_version: z.number().int().positive().optional(),
  published_at: z.string().datetime().optional(),
  immutable: z.literal(true),
});

export type ListeningSectionManifest = z.infer<typeof listeningSectionManifestSchema>;

export const buildListeningSectionManifest = (input: ListeningSectionManifest): ListeningSectionManifest => {
  return listeningSectionManifestSchema.parse(input);
};
