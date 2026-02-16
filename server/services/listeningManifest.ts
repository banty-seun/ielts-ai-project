import type { TaskProgress } from "@shared/schema";
import {
  LISTENING_EVENT_TOPICS,
  LISTENING_EVENT_TYPES,
  type ListeningSectionManifest,
  buildListeningSectionManifest,
} from "@shared/listening";
import { validateTranscriptComplete } from "./content";
import { publishListeningEvent } from "./listeningEvents";
import { upsertReadinessFromManifest } from "./listeningReadinessModel";
import { normalizeLegacyQuestionsForApi } from "./listeningQuestionAdapters";
import { resolveListeningQuestionContract } from "./listeningQuestionContractState";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./listeningObservability";
import { buildGovernanceProvenance } from "./listeningGovernancePolicy";

const LISTENING_PUBLISH_TAG_STRICT = process.env.LISTENING_PUBLISH_TAG_STRICT !== "false";

const isTagRelatedIssue = (issue: string) => {
  return (
    issue.includes("MISSING_TAGS") ||
    issue.includes("UNKNOWN_TAGS") ||
    issue.includes("MAP_ENGINE_MISSING_MAP_TAG") ||
    issue.includes("MATCHING_ENGINE_MISSING_MATCHING_TAG")
  );
};

type ManifestAudioAsset = {
  segment_no: number;
  accent: string;
  url: string;
  duration_seconds: number;
  voice_id?: string | null;
  provider?: string;
  provider_version?: string;
  pipeline_version?: string;
  checksum_sha256?: string | null;
  status?: "success" | "failed";
  url_mode?: "public" | "signed";
  url_expires_at?: string | null;
  retrieval_verified?: boolean;
  section_no?: number;
  duration_source?: "derived_media" | "word_count_fallback" | "metadata" | null;
  validator_code?: string | null;
  validator_reason?: string | null;
};

const toValidAudioAsset = (asset: any): ManifestAudioAsset | null => {
  const segmentNo = Number(asset?.segment_no ?? asset?.segmentNo);
  const durationSeconds = Number(asset?.duration_seconds ?? asset?.durationSec ?? asset?.estimatedDurationSec);
  const accent = typeof asset?.accent === "string" ? asset.accent : "British";
  const url = typeof asset?.url === "string" ? asset.url : typeof asset?.audioUrl === "string" ? asset.audioUrl : "";

  if (!Number.isFinite(segmentNo) || segmentNo <= 0) return null;
  if (!url || !url.trim()) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

  const urlMode = asset?.url_mode === "signed" ? "signed" : asset?.url_mode === "public" ? "public" : undefined;

  return {
    segment_no: Math.round(segmentNo),
    accent,
    url,
    duration_seconds: Math.round(durationSeconds),
    voice_id: typeof asset?.voice_id === "string" ? asset.voice_id : typeof asset?.voiceId === "string" ? asset.voiceId : null,
    provider: typeof asset?.provider === "string" ? asset.provider : undefined,
    provider_version: typeof asset?.provider_version === "string" ? asset.provider_version : undefined,
    pipeline_version: typeof asset?.pipeline_version === "string" ? asset.pipeline_version : undefined,
    checksum_sha256: typeof asset?.checksum_sha256 === "string" ? asset.checksum_sha256 : null,
    status: asset?.status === "failed" ? "failed" : "success",
    url_mode: urlMode,
    url_expires_at: typeof asset?.url_expires_at === "string" ? asset.url_expires_at : null,
    retrieval_verified: typeof asset?.retrieval_verified === "boolean" ? asset.retrieval_verified : undefined,
    section_no: Number.isFinite(Number(asset?.section_no)) ? Number(asset.section_no) : undefined,
    duration_source:
      asset?.duration_source === "derived_media" ||
      asset?.duration_source === "word_count_fallback" ||
      asset?.duration_source === "metadata"
        ? asset.duration_source
        : null,
    validator_code: typeof asset?.validator_code === "string" ? asset.validator_code : null,
    validator_reason: typeof asset?.validator_reason === "string" ? asset.validator_reason : null,
  };
};

const extractManifestAudioAssets = (task: TaskProgress): ManifestAudioAsset[] => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;

  const sectionAudioAssets = Array.isArray(progressData.sectionAudioAssets)
    ? progressData.sectionAudioAssets.map(toValidAudioAsset).filter(Boolean)
    : [];

  if (sectionAudioAssets.length > 0) {
    return sectionAudioAssets.sort((a, b) => a!.segment_no - b!.segment_no) as ManifestAudioAsset[];
  }

  const segmentAssets = Array.isArray(progressData.segments)
    ? progressData.segments
        .map((segment: any, index: number) => {
          return toValidAudioAsset({
            segment_no: Number(segment?.ieltsPart ?? segment?.segmentNo ?? index + 1),
            accent: segment?.accent ?? task.accent ?? "British",
            audioUrl: segment?.audioUrl,
            estimatedDurationSec: segment?.estimatedDurationSec,
            voiceId: segment?.voiceId,
          });
        })
        .filter(Boolean)
    : [];

  if (segmentAssets.length > 0) {
    return segmentAssets.sort((a, b) => a!.segment_no - b!.segment_no) as ManifestAudioAsset[];
  }

  if (task.audioUrl && task.duration && task.duration > 0) {
    return [
      {
        segment_no: 1,
        accent: task.accent ?? "British",
        url: task.audioUrl,
        duration_seconds: Number(task.duration),
      },
    ];
  }

  return [];
};

const resolveExpectedAssetCount = (task: TaskProgress) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  if (Array.isArray(progressData.sectionAudioAssets) && progressData.sectionAudioAssets.length > 0) {
    return progressData.sectionAudioAssets.length;
  }

  const roadmapSegments = Array.isArray(progressData?.listeningSegments?.data)
    ? progressData.listeningSegments.data
    : [];

  if (roadmapSegments.length > 0) {
    return roadmapSegments.length;
  }

  if (typeof progressData?.sessionOrder === "number") {
    return 1;
  }

  if (Array.isArray(progressData.segments) && progressData.segments.length > 0) {
    return progressData.segments.length;
  }

  return 1;
};

export const buildTaskManifestReferences = (task: TaskProgress) => {
  const sectionId = task.id;
  const baseUrl = `/api/listening/sections/${encodeURIComponent(sectionId)}`;
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const anchorsUpdatedAt = progressData?.listeningAnchors?.updated_at;
  const anchorVersion = typeof anchorsUpdatedAt === "string" ? new Date(anchorsUpdatedAt).getTime() : Date.now();
  const anchorsUrl = `${baseUrl}/anchors.json?v=${encodeURIComponent(String(anchorVersion))}`;
  return {
    question_json_url: `${baseUrl}/questions.json`,
    anchors_url: anchorsUrl,
    answer_key_url: `${baseUrl}/answer-key.json`,
  };
};

export const validateManifestPublishGates = (task: TaskProgress) => {
  const scriptValidation = validateTranscriptComplete(task.scriptText ?? "");
  if (!scriptValidation.ok) {
    return { ok: false as const, error: { code: "TRANSCRIPT_INVALID", reason: scriptValidation.reason } };
  }

  const normalizedQuestions = normalizeLegacyQuestionsForApi(task.questions ?? []);
  if (!normalizedQuestions.length) {
    return { ok: false as const, error: { code: "QUESTION_SET_MISSING" } };
  }

  let contract;
  try {
    contract = resolveListeningQuestionContract(task);
  } catch (error: any) {
    return {
      ok: false as const,
      error: {
        code: "RENDERER_SCHEMA_INVALID",
        path: "blocks",
        message: error?.message ?? "Renderer transform failed",
      },
    };
  }
  if (!contract.ok) {
    return {
      ok: false as const,
      error: {
        code: "QUESTION_CONTRACT_INVALID",
        path: "question_contract",
        message: contract.error,
      },
    };
  }
  if (contract.issues.length > 0) {
    const blockingIssues = LISTENING_PUBLISH_TAG_STRICT
      ? contract.issues
      : contract.issues.filter((issue) => !isTagRelatedIssue(issue));

    if (!LISTENING_PUBLISH_TAG_STRICT) {
      const nonBlocking = contract.issues.filter((issue) => isTagRelatedIssue(issue));
      if (nonBlocking.length > 0) {
        console.warn("[ManifestPublish][TagQuality][NonBlocking]", {
          sectionId: task.id,
          issues: nonBlocking,
        });
      }
    }

    if (blockingIssues.length > 0) {
      return {
        ok: false as const,
        error: {
          code: "RENDERER_ADAPTER_RULE_INVALID",
          path: "blocks",
          message: blockingIssues[0] ?? "Renderer adapter validation failed",
        },
      };
    }
  }

  const rendererPayload = contract.rendererPayload;
  const answerKey = contract.answerKey;
  if (!answerKey.entries.length || answerKey.entries.length < normalizedQuestions.length) {
    return { ok: false as const, error: { code: "ANSWER_KEY_INCOMPLETE" } };
  }

  const audioAssets = extractManifestAudioAssets(task);
  const expectedAssets = resolveExpectedAssetCount(task);

  if (audioAssets.length === 0) {
    return { ok: false as const, error: { code: "AUDIO_ASSET_INVALID", reason: "MISSING_ASSETS" } };
  }

  if (audioAssets.length < expectedAssets) {
    return {
      ok: false as const,
      error: {
        code: "AUDIO_ASSET_INVALID",
        reason: `ASSET_COUNT_MISMATCH expected=${expectedAssets} actual=${audioAssets.length}`,
      },
    };
  }

  const invalidAsset = audioAssets.find(
    (asset) =>
      !asset.url ||
      asset.duration_seconds <= 0 ||
      asset.status === "failed" ||
      asset.retrieval_verified === false ||
      Boolean(asset.validator_code),
  );

  if (invalidAsset) {
    return {
      ok: false as const,
      error: {
        code: "AUDIO_ASSET_INVALID",
        reason: `INVALID_SEGMENT_${invalidAsset.segment_no}`,
      },
    };
  }

  return {
    ok: true as const,
    rendererPayload,
    answerKey,
    blockPlan: contract.blockPlan,
    audioAssets,
  };
};

export const buildSectionManifestFromTask = (
  task: TaskProgress,
  options?: {
    validationReportId?: string | null;
    validationVerdict?: "PASS" | "FAIL" | null;
    traceId?: string | null;
    correlationId?: string | null;
    publishVersion?: number | null;
    publishedAt?: string | null;
  },
): ListeningSectionManifest => {
  const refs = buildTaskManifestReferences(task);
  let contractBuildId = `build_${task.id}`;
  try {
    const contract = resolveListeningQuestionContract(task);
    if (contract.ok && contract.blockPlan?.build_id) {
      contractBuildId = contract.blockPlan.build_id;
    }
  } catch {
    // Fallback to legacy build id if question-contract resolution is unavailable.
  }

  const audioAssets = extractManifestAudioAssets(task);
  const deliveryMode = audioAssets.find((asset) => asset.url_mode)?.url_mode;
  const qaSummary = {
    total_assets: audioAssets.length,
    retrieval_verified_assets: audioAssets.filter((asset) => asset.retrieval_verified === true).length,
    failed_assets: audioAssets.filter((asset) => asset.status === "failed").length,
    validator_failures: audioAssets.filter((asset) => Boolean(asset.validator_code)).length,
  };

  return buildListeningSectionManifest({
    manifest_version: "1.0.0",
    section_id: task.id,
    section_no: 1,
    question_json_url: refs.question_json_url,
    audio_assets: audioAssets,
    anchors_url: refs.anchors_url,
    answer_key_url: refs.answer_key_url,
    build_metadata: {
      build_id: contractBuildId,
      build_version: "1.0.0",
      built_at: new Date().toISOString(),
      validation_report_id: options?.validationReportId ?? undefined,
      validation_verdict: options?.validationVerdict ?? undefined,
      trace_id: options?.traceId ?? undefined,
      correlation_id: options?.correlationId ?? undefined,
      delivery_mode: deliveryMode,
      qa_summary: qaSummary,
      governance: buildGovernanceProvenance({
        task,
        riskClass: "learning_content",
      }),
    },
    publish_version: typeof options?.publishVersion === "number" ? options.publishVersion : undefined,
    published_at: options?.publishedAt ?? undefined,
    immutable: true,
  });
};

export const publishSectionManifestEvent = (params: {
  task: TaskProgress;
  traceId: string;
  correlationId: string;
  idempotencyKey: string;
  manifest?: ListeningSectionManifest;
}) => {
  const spanContext = createTelemetryContext({
    traceId: params.traceId,
    requestId: params.traceId,
    userId: params.task.userId,
    weeklyPlanId: params.task.weeklyPlanId,
    sessionId: params.task.id,
    sectionId: params.task.id,
    partId: "1",
    agentName: "publish_service",
  });
  const publishSpan = startListeningStageSpan({
    stage: "published",
    context: spanContext,
    taskProgressId: params.task.id,
  });
  const manifest = params.manifest ?? buildSectionManifestFromTask(params.task);

  const event = publishListeningEvent({
    topic: LISTENING_EVENT_TOPICS.SECTION_EVENTS,
    eventType: LISTENING_EVENT_TYPES.SECTION_PUBLISHED,
    eventVersion: "1.0.0",
    producer: "listening-orchestrator",
    traceId: params.traceId,
    correlationId: params.correlationId,
    idempotencyKey: params.idempotencyKey,
    userId: params.task.userId,
    payload: {
      listening_session_id: params.task.id,
      section_id: params.task.id,
      section_no: 1,
      part_ready: true,
      manifest,
    },
  });

  void upsertReadinessFromManifest({
    task: params.task,
    sectionId: params.task.id,
    sectionNo: 1,
    manifest,
    lastEventId: event.event_id,
  });
  void finishListeningStageSpan(publishSpan, {
    success: true,
    metadata: {
      event_id: event.event_id,
      manifest_version: manifest.manifest_version,
      publish_version: manifest.publish_version ?? null,
    },
  });

  return {
    manifest,
    event,
  };
};
