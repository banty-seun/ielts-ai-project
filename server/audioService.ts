import { createHash, createHmac, randomUUID } from "crypto";
import {
  Engine,
  OutputFormat,
  PollyClient,
  SynthesizeSpeechCommand,
  type VoiceId,
} from "@aws-sdk/client-polly";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { uploadPollyMp3 } from "./audio/uploadPollyMp3";
import { normalizeAccent } from "./utils/audio";
import { ACCENT_TO_TTS_VOICE, DEFAULT_ACCENT, type Accent } from "../shared/constants";
import { publishTtsQualityMetric } from "./services/listeningTelemetry";
import {
  createTelemetryContext,
  finishListeningStageSpan,
  startListeningStageSpan,
} from "./services/listeningObservability";

const DEFAULT_AUDIO_BUCKET = "ielts-ai-audio";
const DEFAULT_AUDIO_REGION = "eu-west-2";
const DEFAULT_SAMPLE_RATE = "22050";
const DEFAULT_PROMPT_VERSION = "legacy-v1";
const MIN_AUDIO_BYTES = 2048;
const AUDIO_PIPELINE_VERSION = "tts-pipeline-v1";
const AUDIO_OUTPUT_FORMAT = "mp3";
const AUDIO_LOUDNESS_BASELINE = "-16 LUFS";
const AUDIO_DEBUG_LOG = process.env.NODE_ENV !== "production" || process.env.LISTENING_AUDIO_DEBUG === "true";

const awsRegion = (process.env.AWS_REGION || DEFAULT_AUDIO_REGION).trim();
const resolvedBucket = process.env.AWS_S3_BUCKET?.trim();
const audioBucket =
  resolvedBucket && resolvedBucket.length > 0 ? resolvedBucket : DEFAULT_AUDIO_BUCKET;
const audioUrlMode = (process.env.LISTENING_AUDIO_URL_MODE || "public").trim().toLowerCase();
const signedUrlTtlSeconds = Math.max(60, Number(process.env.LISTENING_AUDIO_SIGNED_TTL_SECONDS ?? 900));
const signedAudioSecret =
  process.env.LISTENING_AUDIO_SIGNING_SECRET || process.env.AWS_SECRET_ACCESS_KEY || "dev-listening-audio-secret";

const pollyClient = new PollyClient({ region: awsRegion });
const s3Client = new S3Client({ region: awsRegion });
const failFastConfig = process.env.LISTENING_TTS_FAIL_FAST === "true";
if (failFastConfig && (!process.env.AWS_ACCESS_KEY_ID?.trim() || !process.env.AWS_SECRET_ACCESS_KEY?.trim())) {
  throw new Error(
    "LISTENING_TTS_FAIL_FAST is enabled but AWS credentials are missing. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.",
  );
}

type CanonicalTtsErrorCode =
  | "AUTH_ERROR"
  | "INPUT_INVALID"
  | "TTS_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "AUDIO_VALIDATION_FAILED"
  | "DELIVERY_VERIFICATION_FAILED"
  | "UNKNOWN";

type ProviderSynthesisParams = {
  text: string;
  accent: Accent;
  voiceId: string;
  sampleRate: string;
};

type ProviderSynthesisResult = {
  audioBuffer: Buffer;
  requestId?: string;
  provider: string;
  providerVersion: string;
};

type ProviderHealthResult = {
  ok: boolean;
  provider: string;
  details: Record<string, unknown>;
};

type ProviderError = {
  code: CanonicalTtsErrorCode;
  message: string;
  retryable: boolean;
};

interface TtsProviderAdapter {
  provider: string;
  version: string;
  validateInput(params: ProviderSynthesisParams): ProviderError | null;
  synthesize(params: ProviderSynthesisParams): Promise<ProviderSynthesisResult>;
  healthcheck(): Promise<ProviderHealthResult>;
  normalizeError(error: unknown): ProviderError;
}

type AudioDeliveryMetadata = {
  url: string;
  mode: "public" | "signed";
  expiresAt: string | null;
};

type AudioPostProcessingResult = {
  ok: boolean;
  audioBuffer: Buffer;
  pipelineVersion: string;
  format: string;
  sampleRate: string;
  loudnessBaseline: string;
  errorCode?: CanonicalTtsErrorCode;
  errorMessage?: string;
};

export type SegmentRenderInput = {
  segmentNo: number;
  transcript: string;
  accent?: string;
  voiceId?: string;
  secondaryAccents?: string[];
};

export type SegmentRenderResult = {
  segmentNo: number;
  status: "success" | "failed";
  url?: string;
  durationSec?: number;
  accent: Accent;
  voiceId?: string;
  provider: string;
  providerVersion: string;
  errorCode?: CanonicalTtsErrorCode;
  errorMessage?: string;
  checksumSha256?: string;
  storageKey?: string;
  urlMode?: "public" | "signed";
  urlExpiresAt?: string | null;
  retrievalVerified?: boolean;
  pipelineVersion?: string;
  durationSource?: "derived_media" | "word_count_fallback" | "metadata";
  validatorCode?: string;
  validatorReason?: string;
  attempts?: number;
  fallbackUsed?: boolean;
};

export type SectionRenderResult = {
  success: boolean;
  sectionNo: number;
  promptVersion: string;
  results: SegmentRenderResult[];
};

const toBase64Url = (value: Buffer | string) => {
  const raw = Buffer.isBuffer(value) ? value.toString("base64") : Buffer.from(value).toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromBase64Url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
};

const isSignedMode = () => audioUrlMode === "signed";

const buildPublicUrl = (bucket: string, key: string) => {
  return `https://${bucket}.s3.${awsRegion}.amazonaws.com/${key}`;
};

const buildSignedAudioToken = (payload: {
  bucket: string;
  key: string;
  expiresAtEpochSeconds: number;
}) => {
  const body = toBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", signedAudioSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
};

const parseSignedAudioTokenPayload = (token: string): { bucket: string; key: string; expiresAtEpochSeconds: number } | null => {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = createHmac("sha256", signedAudioSecret)
    .update(encodedPayload)
    .digest("base64url");

  if (expectedSignature !== signature) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload));
    if (!parsed?.bucket || !parsed?.key || !parsed?.expiresAtEpochSeconds) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const createSignedAudioTokenForKey = (params: {
  key: string;
  bucket?: string;
  expiresInSeconds?: number;
}) => {
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + Math.max(30, params.expiresInSeconds ?? 300);
  return buildSignedAudioToken({
    bucket: params.bucket ?? audioBucket,
    key: params.key,
    expiresAtEpochSeconds,
  });
};

export const resolveSignedAudioProxyRedirect = (token: string): string | null => {
  const parsed = parseSignedAudioTokenPayload(token);
  if (!parsed) {
    return null;
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (parsed.expiresAtEpochSeconds < nowEpoch) {
    return null;
  }

  return buildPublicUrl(parsed.bucket, parsed.key);
};

const buildDeliveryUrl = (bucket: string, key: string): AudioDeliveryMetadata => {
  if (!isSignedMode()) {
    return {
      url: buildPublicUrl(bucket, key),
      mode: "public",
      expiresAt: null,
    };
  }

  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + signedUrlTtlSeconds;
  const token = buildSignedAudioToken({
    bucket,
    key,
    expiresAtEpochSeconds,
  });

  const basePath = process.env.LISTENING_AUDIO_PROXY_BASE_URL?.trim();
  const relativeUrl = `/api/listening/audio/signed?token=${encodeURIComponent(token)}`;
  return {
    url: basePath && basePath.length > 0 ? `${basePath}${relativeUrl}` : relativeUrl,
    mode: "signed",
    expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString(),
  };
};

const verifyDeliveryCompatibility = async (params: {
  delivery: AudioDeliveryMetadata;
  storageKey: string;
}) => {
  const delivery = params.delivery;
  const head = await getSegmentHeadMetadata(params.storageKey);
  if (!head || (head.ContentLength ?? 0) <= 0) {
    return {
      ok: false as const,
      reason: "DELIVERY_OBJECT_MISSING",
    };
  }

  const contentType = String(head.ContentType ?? "").toLowerCase();
  if (contentType && contentType !== "audio/mpeg" && contentType !== "audio/mp3") {
    return {
      ok: false as const,
      reason: "DELIVERY_CONTENT_TYPE_INVALID",
    };
  }

  if (!params.storageKey.toLowerCase().endsWith(".mp3")) {
    return {
      ok: false as const,
      reason: "DELIVERY_EXTENSION_INVALID",
    };
  }

  if (delivery.mode === "signed") {
    const tokenMatch = delivery.url.match(/[?&]token=([^&]+)/);
    if (!tokenMatch || !tokenMatch[1]) {
      return {
        ok: false as const,
        reason: "SIGNED_TOKEN_MISSING",
      };
    }
    const token = decodeURIComponent(tokenMatch[1]);
    const decoded = resolveSignedAudioProxyRedirect(token);
    if (!decoded) {
      return {
        ok: false as const,
        reason: "SIGNED_TOKEN_INVALID",
      };
    }
    const payload = parseSignedAudioTokenPayload(token);
    if (!payload || payload.key !== params.storageKey) {
      return {
        ok: false as const,
        reason: "SIGNED_TOKEN_KEY_MISMATCH",
      };
    }
    return { ok: true as const };
  }

  if (process.env.LISTENING_AUDIO_VERIFY_DELIVERY_HTTP === "true") {
    const ok = await verifyAudioFetchability(delivery.url);
    if (!ok) {
      return {
        ok: false as const,
        reason: "PUBLIC_HEAD_FETCH_FAILED",
      };
    }
  }

  return { ok: true as const };
};

const sanitizeKeyPart = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "na";
};

export const buildSegmentRenderKey = (params: {
  sessionId: string;
  userId: string;
  weekNumber: number;
  taskId: string;
  sectionNo: number;
  segmentNo: number;
  accent: Accent;
  promptVersion: string;
}) => {
  const promptPart = sanitizeKeyPart(params.promptVersion || DEFAULT_PROMPT_VERSION);
  const accentPart = sanitizeKeyPart(params.accent);
  const sessionPart = sanitizeKeyPart(params.sessionId || params.taskId);
  return [
    "audio",
    `session-${sessionPart}`,
    params.userId,
    `week-${params.weekNumber}`,
    `task-${params.taskId}`,
    `section-${params.sectionNo}`,
    `segment-${params.segmentNo}`,
    accentPart,
    `pv-${promptPart}.mp3`,
  ].join("/");
};

const buildLegacySegmentRenderKey = (params: {
  userId: string;
  weekNumber: number;
  taskId: string;
  sectionNo: number;
  segmentNo: number;
  accent: Accent;
  promptVersion: string;
}) => {
  const promptPart = sanitizeKeyPart(params.promptVersion || DEFAULT_PROMPT_VERSION);
  const accentPart = sanitizeKeyPart(params.accent);
  return [
    "audio",
    params.userId,
    `week-${params.weekNumber}`,
    `task-${params.taskId}`,
    `section-${params.sectionNo}`,
    `segment-${params.segmentNo}`,
    accentPart,
    `pv-${promptPart}.mp3`,
  ].join("/");
};

const buildSegmentRenderKeyCandidates = (params: {
  sessionId: string;
  userId: string;
  weekNumber: number;
  taskId: string;
  sectionNo: number;
  segmentNo: number;
  accent: Accent;
  promptVersion: string;
}) => {
  const primary = buildSegmentRenderKey(params);
  const legacy = buildLegacySegmentRenderKey(params);
  return primary === legacy ? [primary] : [primary, legacy];
};

const parseVoiceFallbackEnv = (): Partial<Record<Accent, string[]>> => {
  const raw = process.env.LISTENING_TTS_VOICE_FALLBACKS;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const output: Partial<Record<Accent, string[]>> = {};
    for (const accent of Object.keys(ACCENT_TO_TTS_VOICE) as Accent[]) {
      const candidates = parsed?.[accent];
      if (!Array.isArray(candidates)) continue;
      const cleaned = candidates
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
      if (cleaned.length > 0) {
        output[accent] = cleaned;
      }
    }
    return output;
  } catch {
    console.error("[TTS] Invalid LISTENING_TTS_VOICE_FALLBACKS JSON");
    return {};
  }
};

const VOICE_FALLBACKS = parseVoiceFallbackEnv();

const resolveAccentPlan = (requestedAccent?: string, secondaryAccents?: string[]): {
  primary: Accent;
  secondary: Accent[];
  normalizedFrom: string | null;
  usedDefault: boolean;
} => {
  const rawRequested = typeof requestedAccent === "string" ? requestedAccent.trim() : "";
  const normalizedPrimary = normalizeAccent(rawRequested || DEFAULT_ACCENT);
  const normalizedFrom = requestedAccent ?? null;
  const usedDefault = !rawRequested;
  if (rawRequested && normalizedPrimary === DEFAULT_ACCENT && rawRequested.toLowerCase() !== "british") {
    console.warn("[TTS][AccentResolver][FallbackToDefault]", {
      requestedAccent: rawRequested,
      resolvedAccent: normalizedPrimary,
    });
  }
  const secondary = (secondaryAccents ?? [])
    .map((entry) => normalizeAccent(entry))
    .filter((accent, index, arr) => arr.indexOf(accent) === index && accent !== normalizedPrimary);
  return {
    primary: normalizedPrimary,
    secondary,
    normalizedFrom,
    usedDefault,
  };
};

const applyPostProcessingStandardization = (params: {
  audioBuffer: Buffer;
  format: string;
  sampleRate: string;
}): AudioPostProcessingResult => {
  const enforcedFormat = process.env.LISTENING_AUDIO_OUTPUT_FORMAT?.trim().toLowerCase() || AUDIO_OUTPUT_FORMAT;
  const enforcedSampleRate = process.env.LISTENING_AUDIO_SAMPLE_RATE?.trim() || DEFAULT_SAMPLE_RATE;
  const enforcedLoudness = process.env.LISTENING_AUDIO_LOUDNESS_BASELINE?.trim() || AUDIO_LOUDNESS_BASELINE;

  if (params.format.toLowerCase() !== enforcedFormat) {
    return {
      ok: false,
      audioBuffer: params.audioBuffer,
      pipelineVersion: AUDIO_PIPELINE_VERSION,
      format: params.format,
      sampleRate: params.sampleRate,
      loudnessBaseline: enforcedLoudness,
      errorCode: "AUDIO_VALIDATION_FAILED",
      errorMessage: `POST_PROCESS_FORMAT_MISMATCH expected=${enforcedFormat} actual=${params.format}`,
    };
  }

  if (params.sampleRate !== enforcedSampleRate) {
    return {
      ok: false,
      audioBuffer: params.audioBuffer,
      pipelineVersion: AUDIO_PIPELINE_VERSION,
      format: params.format,
      sampleRate: params.sampleRate,
      loudnessBaseline: enforcedLoudness,
      errorCode: "AUDIO_VALIDATION_FAILED",
      errorMessage: `POST_PROCESS_SAMPLE_RATE_MISMATCH expected=${enforcedSampleRate} actual=${params.sampleRate}`,
    };
  }

  return {
    ok: true,
    audioBuffer: params.audioBuffer,
    pipelineVersion: AUDIO_PIPELINE_VERSION,
    format: enforcedFormat,
    sampleRate: enforcedSampleRate,
    loudnessBaseline: enforcedLoudness,
  };
};

const resolveVoiceCandidates = (params: {
  accent: Accent;
  explicitVoiceId?: string;
}) => {
  const voices: string[] = [];
  if (params.explicitVoiceId && params.explicitVoiceId.trim().length > 0) {
    voices.push(params.explicitVoiceId.trim());
  }

  const mapped = ACCENT_TO_TTS_VOICE[params.accent] ?? ACCENT_TO_TTS_VOICE[DEFAULT_ACCENT];
  if (mapped) voices.push(mapped);

  for (const fallbackVoice of VOICE_FALLBACKS[params.accent] ?? []) {
    voices.push(fallbackVoice);
  }

  const defaultVoice = ACCENT_TO_TTS_VOICE[DEFAULT_ACCENT];
  if (defaultVoice) voices.push(defaultVoice);

  return voices.filter((voice, index) => voices.indexOf(voice) === index);
};

const parseMpegBitrateKbps = (buffer: Buffer): number | null => {
  if (buffer.length < 4) return null;

  let offset = 0;
  if (buffer.slice(0, 3).toString("ascii") === "ID3" && buffer.length >= 10) {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = 10 + size;
  }

  for (let i = offset; i < Math.min(buffer.length - 4, offset + 2048); i += 1) {
    if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) continue;

    const versionBits = (buffer[i + 1] >> 3) & 0x03;
    const layerBits = (buffer[i + 1] >> 1) & 0x03;
    const bitrateIndex = (buffer[i + 2] >> 4) & 0x0f;

    if (layerBits !== 0x01 || bitrateIndex === 0 || bitrateIndex === 0x0f) {
      continue;
    }

    const mpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const mpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
    return versionBits === 0x03 ? mpeg1[bitrateIndex] ?? null : mpeg2[bitrateIndex] ?? null;
  }

  return null;
};

const deriveDurationFromAudioBuffer = (buffer: Buffer) => {
  const bitrateKbps = parseMpegBitrateKbps(buffer);
  if (!bitrateKbps || bitrateKbps <= 0) {
    return null;
  }

  const durationSec = Math.max(1, Math.round((buffer.length * 8) / (bitrateKbps * 1000)));
  return {
    durationSec,
    bitrateKbps,
  };
};

const estimateDurationFromWords = (text: string) => {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil((wordCount / 165) * 60));
};

const countMpegFrameHeaders = (buffer: Buffer, maxScanBytes = 96_000) => {
  if (buffer.length < 4) return 0;
  let frames = 0;
  const upper = Math.min(buffer.length - 1, maxScanBytes);
  for (let i = 0; i < upper; i += 1) {
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
      frames += 1;
    }
  }
  return frames;
};

const estimateByteEntropy = (buffer: Buffer, sampleSize = 8192) => {
  if (buffer.length === 0) return 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, sampleSize));
  const freq = new Array<number>(256).fill(0);
  for (const byte of sample) {
    freq[byte] += 1;
  }
  const total = sample.length;
  let entropy = 0;
  for (const count of freq) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(4));
};

const analyzeMp3Quality = (buffer: Buffer) => {
  const frameHeaders = countMpegFrameHeaders(buffer);
  if (frameHeaders < 2) {
    return {
      ok: false as const,
      reason: "UNDECODABLE_MP3_STREAM",
      frameHeaders,
    };
  }

  const entropy = estimateByteEntropy(buffer);
  const repeatedRatio = Number(
    (
      [...new Set(buffer.subarray(0, Math.min(buffer.length, 4096)).values())].length /
      Math.min(buffer.length, 4096)
    ).toFixed(4),
  );

  if (entropy < 2.0 || repeatedRatio < 0.03) {
    return {
      ok: false as const,
      reason: "SILENCE_DETECTED",
      entropy,
      repeatedRatio,
    };
  }

  return {
    ok: true as const,
    frameHeaders,
    entropy,
    repeatedRatio,
  };
};

const validateAudioBuffer = (params: { audioBuffer: Buffer; transcript: string }) => {
  const minSize = Math.max(MIN_AUDIO_BYTES, Math.min(16000, params.transcript.length * 6));
  if (params.audioBuffer.length === 0) {
    return { ok: false as const, code: "AUDIO_VALIDATION_FAILED" as const, reason: "EMPTY_BUFFER" };
  }

  if (params.audioBuffer.length < minSize) {
    return {
      ok: false as const,
      code: "AUDIO_VALIDATION_FAILED" as const,
      reason: "SMALL_BUFFER",
      minSize,
      size: params.audioBuffer.length,
    };
  }

  const head3 = params.audioBuffer.slice(0, 3).toString("ascii");
  const frameSync = params.audioBuffer[0] === 0xff && (params.audioBuffer[1] & 0xe0) === 0xe0;
  if (head3 !== "ID3" && !frameSync) {
    return { ok: false as const, code: "AUDIO_VALIDATION_FAILED" as const, reason: "UNDECODABLE_MP3_HEADER" };
  }

  const streamQuality = analyzeMp3Quality(params.audioBuffer);
  if (!streamQuality.ok) {
    return {
      ok: false as const,
      code: "AUDIO_VALIDATION_FAILED" as const,
      reason: streamQuality.reason,
    };
  }

  const derived = deriveDurationFromAudioBuffer(params.audioBuffer);
  const durationSec = derived?.durationSec ?? estimateDurationFromWords(params.transcript);
  if (durationSec <= 0 || durationSec > 3600) {
    return { ok: false as const, code: "AUDIO_VALIDATION_FAILED" as const, reason: "DURATION_ANOMALY", durationSec };
  }

  return {
    ok: true as const,
    durationSec,
    durationSource: derived ? ("derived_media" as const) : ("word_count_fallback" as const),
    bitrateKbps: derived?.bitrateKbps ?? null,
  };
};

const streamToBuffer = async (stream: any): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (error: Error) => reject(error));
  });
};

const createPollyAdapter = (engine: Engine, version: string): TtsProviderAdapter => ({
  provider: "aws-polly",
  version,
  validateInput(params) {
    if (!params.text || params.text.trim().length === 0) {
      return { code: "INPUT_INVALID", message: "Script text is empty", retryable: false };
    }
    if (params.text.length > 5500) {
      return { code: "INPUT_INVALID", message: "Script text exceeds provider limit", retryable: false };
    }
    if (!params.voiceId) {
      return { code: "INPUT_INVALID", message: "Voice ID is required", retryable: false };
    }
    return null;
  },
  async synthesize(params) {
    const command = new SynthesizeSpeechCommand({
      Engine: engine,
      OutputFormat: OutputFormat.MP3,
      SampleRate: params.sampleRate,
      Text: params.text,
      VoiceId: params.voiceId as VoiceId,
    });
    const response = await pollyClient.send(command);
    if (!response.AudioStream) {
      throw new Error("Polly returned no audio stream");
    }

    const audioBuffer = await streamToBuffer(response.AudioStream);
    return {
      audioBuffer,
      requestId: response.$metadata?.requestId,
      provider: "aws-polly",
      providerVersion: version,
    };
  },
  async healthcheck() {
    const hasCredentials = Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());
    const details: Record<string, unknown> = {
      region: awsRegion,
      bucket: audioBucket,
      hasCredentials,
      engine: engine.toLowerCase(),
      version,
    };

    if (!hasCredentials) {
      return {
        ok: false,
        provider: "aws-polly",
        details: {
          ...details,
          code: "AUTH_ERROR",
          message: "AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY not configured",
        },
      };
    }

    if (process.env.LISTENING_TTS_HEALTHCHECK_DEEP === "true") {
      try {
        const probe = await this.synthesize({
          text: "Health check for IELTS listening pipeline.",
          accent: DEFAULT_ACCENT,
          voiceId: ACCENT_TO_TTS_VOICE[DEFAULT_ACCENT],
          sampleRate: DEFAULT_SAMPLE_RATE,
        });
        details.probeBytes = probe.audioBuffer.length;
      } catch (error) {
        const normalized = this.normalizeError(error);
        return {
          ok: false,
          provider: "aws-polly",
          details: {
            ...details,
            code: normalized.code,
            message: normalized.message,
          },
        };
      }
    }

    return {
      ok: true,
      provider: "aws-polly",
      details,
    };
  },
  normalizeError(error) {
    const name = String((error as any)?.name ?? "");
    const code = String((error as any)?.code ?? "");
    const message = String((error as any)?.message ?? "Unknown provider error");

    if (name.includes("InvalidParameter") || name.includes("TextLengthExceeded")) {
      return { code: "INPUT_INVALID", message, retryable: false };
    }

    if (
      name.includes("Credentials") ||
      name.includes("AccessDenied") ||
      code.includes("AccessDenied") ||
      message.toLowerCase().includes("credentials")
    ) {
      return { code: "AUTH_ERROR", message, retryable: false };
    }

    if (
      name.includes("Throttl") ||
      name.includes("Timeout") ||
      code.includes("Timeout") ||
      message.toLowerCase().includes("timeout")
    ) {
      return { code: "TTS_TIMEOUT", message, retryable: true };
    }

    if (name.includes("Service") || name.includes("Internal")) {
      return { code: "PROVIDER_UNAVAILABLE", message, retryable: true };
    }

    return { code: "UNKNOWN", message, retryable: true };
  },
});

const pollyProvider = createPollyAdapter(Engine.NEURAL, "neural-v1");
const pollyStandardProvider = createPollyAdapter(Engine.STANDARD, "standard-v1");

const providerRegistry: Record<string, TtsProviderAdapter> = {
  polly: pollyProvider,
  "polly-neural": pollyProvider,
  "polly-standard": pollyStandardProvider,
};

const resolveProviderByName = (name: string): TtsProviderAdapter => {
  const normalized = (name || "").trim().toLowerCase();
  const provider = providerRegistry[normalized];
  if (provider) {
    return provider;
  }
  const message = `Unsupported LISTENING_TTS_PROVIDER=${normalized}. Supported values: ${Object.keys(providerRegistry).join(", ")}`;
  if (process.env.LISTENING_TTS_STRICT_PROVIDER !== "false") {
    throw new Error(message);
  }
  console.warn(`[TTS] ${message}; falling back to polly`);
  return pollyProvider;
};

const resolveProviderChain = (): TtsProviderAdapter[] => {
  const configured = (process.env.LISTENING_TTS_PROVIDER || "polly").trim().toLowerCase();
  const fallbackRaw = (process.env.LISTENING_TTS_FALLBACK_PROVIDER || "").trim().toLowerCase();
  const fallbackProviders = fallbackRaw.length > 0
    ? fallbackRaw.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [];

  const names = [configured, ...fallbackProviders].filter((name, index, arr) => arr.indexOf(name) === index);
  return names.map((name) => resolveProviderByName(name));
};

const validateConfiguredProviderChain = () => {
  try {
    const chain = resolveProviderChain();
    if (chain.length === 0) {
      throw new Error("No TTS providers resolved from configuration.");
    }
  } catch (error) {
    if (process.env.LISTENING_TTS_STRICT_PROVIDER !== "false") {
      throw error;
    }
    console.warn("[TTS] Provider chain validation warning:", (error as any)?.message ?? "unknown");
  }
};

validateConfiguredProviderChain();

const getSegmentHeadMetadata = async (key: string) => {
  try {
    const head = await s3Client.send(
      new HeadObjectCommand({
        Bucket: audioBucket,
        Key: key,
      }),
    );
    return head;
  } catch {
    return null;
  }
};

const parseDurationMetadata = (value: string | undefined): number | null => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
};

const verifyAssetRetrieval = async (key: string) => {
  const head = await getSegmentHeadMetadata(key);
  if (!head) {
    return {
      ok: false as const,
      errorCode: "DELIVERY_VERIFICATION_FAILED" as const,
      reason: "HEAD_NOT_FOUND",
    };
  }

  if ((head.ContentLength ?? 0) <= 0) {
    return {
      ok: false as const,
      errorCode: "DELIVERY_VERIFICATION_FAILED" as const,
      reason: "ZERO_CONTENT_LENGTH",
    };
  }

  if (process.env.LISTENING_AUDIO_VERIFY_GET !== "false") {
    try {
      const probe = await s3Client.send(
        new GetObjectCommand({
          Bucket: audioBucket,
          Key: key,
          Range: "bytes=0-32",
        }),
      );
      if (!probe.Body) {
        return {
          ok: false as const,
          errorCode: "DELIVERY_VERIFICATION_FAILED" as const,
          reason: "GET_RANGE_EMPTY_BODY",
        };
      }
      await streamToBuffer(probe.Body as any);
    } catch {
      return {
        ok: false as const,
        errorCode: "DELIVERY_VERIFICATION_FAILED" as const,
        reason: "GET_RANGE_FAILED",
      };
    }
  }

  return {
    ok: true as const,
    metadata: head.Metadata ?? {},
  };
};

export const renderSectionAudioAssets = async (params: {
  userId: string;
  taskId: string;
  weekNumber: number;
  sectionNo: number;
  sessionId?: string;
  correlationId?: string;
  promptVersion?: string;
  sectionAccent?: string;
  sectionFallbackAccents?: string[];
  segmentInputs: SegmentRenderInput[];
}): Promise<SectionRenderResult> => {
  const spanContext = createTelemetryContext({
    traceId: params.correlationId ?? `trc_audio_${params.taskId}`,
    requestId: params.correlationId ?? `req_audio_${params.taskId}`,
    userId: params.userId,
    sessionId: params.sessionId ?? params.taskId,
    sectionId: `${params.taskId}:section-${params.sectionNo}`,
    partId: String(params.sectionNo),
    agentName: "tts_worker",
  });
  const audioSpan = startListeningStageSpan({
    stage: "audio_rendered",
    context: spanContext,
    taskProgressId: params.taskId,
  });
  const providerChain = resolveProviderChain();
  const provider = providerChain[0] ?? pollyProvider;
  const attemptsPerSegment = Math.max(1, Number(process.env.LISTENING_SEGMENT_RENDER_ATTEMPTS ?? 2));
  const promptVersion = params.promptVersion || DEFAULT_PROMPT_VERSION;
  const sessionId = params.sessionId?.trim() || params.taskId;
  const correlationId = params.correlationId?.trim() || buildCorrelationId();

  const envFallbackAccents = (process.env.LISTENING_TTS_FALLBACK_ACCENTS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const sectionFallbackAccents = [...(params.sectionFallbackAccents ?? []), ...envFallbackAccents].filter(
    (accent, index, arr) => accent && arr.indexOf(accent) === index,
  );

  const results: SegmentRenderResult[] = [];
  let totalAttempts = 0;
  let fallbackUsages = 0;
  let validationDetections = 0;

  for (const input of params.segmentInputs) {
    const combinedFallbackAccents = [...(input.secondaryAccents ?? []), ...sectionFallbackAccents].filter(
      (accent, index, arr) => accent && arr.indexOf(accent) === index,
    );
    const accentPlan = resolveAccentPlan(input.accent ?? params.sectionAccent, combinedFallbackAccents);
    const primaryAccent = accentPlan.primary;
    const allAccents = [primaryAccent, ...accentPlan.secondary].filter(
      (accent, index, arr) => arr.indexOf(accent) === index,
    );

    let rendered: SegmentRenderResult | null = null;
    let segmentAttempts = 0;

    for (const accentCandidate of allAccents) {
      let fallbackUsedForSegment = accentCandidate !== primaryAccent;
      if (fallbackUsedForSegment) {
        fallbackUsages += 1;
      }
      const voiceCandidates = resolveVoiceCandidates({
        accent: accentCandidate,
        explicitVoiceId: input.voiceId,
      });
      const keyCandidates = buildSegmentRenderKeyCandidates({
        sessionId,
        userId: params.userId,
        weekNumber: params.weekNumber,
        taskId: params.taskId,
        sectionNo: params.sectionNo,
        segmentNo: input.segmentNo,
        accent: accentCandidate,
        promptVersion,
      });
      const objectKey = keyCandidates[0];
      let resolvedExistingKey: string | null = null;
      let existingHead: Awaited<ReturnType<typeof getSegmentHeadMetadata>> = null;
      for (const keyCandidate of keyCandidates) {
        const head = await getSegmentHeadMetadata(keyCandidate);
        if (head && (head.ContentLength ?? 0) > 0) {
          resolvedExistingKey = keyCandidate;
          existingHead = head;
          break;
        }
      }
      if (existingHead && (existingHead.ContentLength ?? 0) > 0) {
        if (AUDIO_DEBUG_LOG) {
          console.info("[TTS][Idempotency][Hit]", {
            taskId: params.taskId,
            sessionId,
            correlationId,
            sectionNo: params.sectionNo,
            segmentNo: input.segmentNo,
            accent: accentCandidate,
            promptVersion,
            key: resolvedExistingKey,
            keyType: resolvedExistingKey === objectKey ? "current" : "legacy",
          });
        }
        const existingKey = resolvedExistingKey ?? objectKey;
        const delivery = buildDeliveryUrl(audioBucket, existingKey);
        const deliveryCheck = await verifyDeliveryCompatibility({
          delivery,
          storageKey: existingKey,
        });
        if (!deliveryCheck.ok) {
          rendered = {
            segmentNo: input.segmentNo,
            status: "failed",
            accent: accentCandidate,
            voiceId: existingHead.Metadata?.voice_id ?? voiceCandidates[0],
            provider: existingHead.Metadata?.provider ?? provider.provider,
            providerVersion: existingHead.Metadata?.provider_version ?? provider.version,
            errorCode: "DELIVERY_VERIFICATION_FAILED",
            errorMessage: deliveryCheck.reason,
            validatorCode: "DELIVERY_VERIFICATION_FAILED",
            validatorReason: deliveryCheck.reason,
            attempts: segmentAttempts,
            fallbackUsed: fallbackUsedForSegment,
          };
          validationDetections += 1;
          continue;
        }
        const metadataDuration = parseDurationMetadata(existingHead.Metadata?.duration_seconds);
        rendered = {
          segmentNo: input.segmentNo,
          status: "success",
          url: delivery.url,
          durationSec: metadataDuration ?? estimateDurationFromWords(input.transcript),
          accent: accentCandidate,
          voiceId: existingHead.Metadata?.voice_id ?? voiceCandidates[0],
          provider: existingHead.Metadata?.provider ?? provider.provider,
          providerVersion: existingHead.Metadata?.provider_version ?? provider.version,
          checksumSha256: existingHead.Metadata?.checksum_sha256,
          storageKey: existingKey,
          urlMode: delivery.mode,
          urlExpiresAt: delivery.expiresAt,
          retrievalVerified: true,
          pipelineVersion: existingHead.Metadata?.pipeline_version ?? AUDIO_PIPELINE_VERSION,
          durationSource: metadataDuration ? "metadata" : "word_count_fallback",
          attempts: segmentAttempts,
          fallbackUsed: fallbackUsedForSegment,
        };
        break;
      }

      for (let attempt = 0; attempt < attemptsPerSegment; attempt += 1) {
        for (const voiceId of voiceCandidates) {
          for (let providerIndex = 0; providerIndex < providerChain.length; providerIndex += 1) {
            const providerCandidate = providerChain[providerIndex] ?? provider;
            segmentAttempts += 1;
            totalAttempts += 1;

            const validationError = providerCandidate.validateInput({
              text: input.transcript,
              accent: accentCandidate,
              voiceId,
              sampleRate: DEFAULT_SAMPLE_RATE,
            });
            if (validationError) {
              rendered = {
                segmentNo: input.segmentNo,
                status: "failed",
                accent: accentCandidate,
                voiceId,
                provider: providerCandidate.provider,
                providerVersion: providerCandidate.version,
                errorCode: validationError.code,
                errorMessage: validationError.message,
                validatorCode: validationError.code,
                validatorReason: "PROVIDER_INPUT_INVALID",
                attempts: segmentAttempts,
                fallbackUsed: fallbackUsedForSegment,
              };
              continue;
            }

            try {
              const synth = await providerCandidate.synthesize({
                text: input.transcript,
                accent: accentCandidate,
                voiceId,
                sampleRate: DEFAULT_SAMPLE_RATE,
              });

              const quality = validateAudioBuffer({
                audioBuffer: synth.audioBuffer,
                transcript: input.transcript,
              });
              if (!quality.ok) {
                rendered = {
                  segmentNo: input.segmentNo,
                  status: "failed",
                  accent: accentCandidate,
                  voiceId,
                  provider: synth.provider,
                  providerVersion: synth.providerVersion,
                  errorCode: quality.code,
                  errorMessage: quality.reason,
                  validatorCode: quality.code,
                  validatorReason: quality.reason,
                  attempts: segmentAttempts,
                  fallbackUsed: fallbackUsedForSegment,
                };
                validationDetections += 1;
                continue;
              }

              const postProcessing = applyPostProcessingStandardization({
                audioBuffer: synth.audioBuffer,
                format: AUDIO_OUTPUT_FORMAT,
                sampleRate: DEFAULT_SAMPLE_RATE,
              });
              if (!postProcessing.ok) {
                rendered = {
                  segmentNo: input.segmentNo,
                  status: "failed",
                  accent: accentCandidate,
                  voiceId,
                  provider: synth.provider,
                  providerVersion: synth.providerVersion,
                  errorCode: postProcessing.errorCode ?? "AUDIO_VALIDATION_FAILED",
                  errorMessage: postProcessing.errorMessage ?? "POST_PROCESSING_FAILED",
                  validatorCode: postProcessing.errorCode ?? "AUDIO_VALIDATION_FAILED",
                  validatorReason: postProcessing.errorMessage ?? "POST_PROCESSING_FAILED",
                  attempts: segmentAttempts,
                  fallbackUsed: fallbackUsedForSegment,
                };
                validationDetections += 1;
                continue;
              }

              const checksumSha256 = createHash("sha256").update(postProcessing.audioBuffer).digest("hex");
              const upload = await uploadPollyMp3({
                key: objectKey,
                audioBuffer: postProcessing.audioBuffer,
                checkExisting: true,
                metadata: {
                  provider: synth.provider,
                  provider_version: synth.providerVersion,
                  voice_id: voiceId,
                  accent: accentCandidate,
                  pipeline_version: postProcessing.pipelineVersion,
                  checksum_sha256: checksumSha256,
                  duration_seconds: String(quality.durationSec),
                  duration_source: quality.durationSource,
                  prompt_version: promptVersion,
                  section_no: String(params.sectionNo),
                  segment_no: String(input.segmentNo),
                  output_format: postProcessing.format,
                  output_sample_rate: postProcessing.sampleRate,
                  loudness_baseline: postProcessing.loudnessBaseline,
                  session_id: sessionId,
                  correlation_id: correlationId,
                },
              });

              if (upload.existing && AUDIO_DEBUG_LOG) {
                console.info("[TTS][Idempotency][Collision]", {
                  taskId: params.taskId,
                  sessionId,
                  correlationId,
                  sectionNo: params.sectionNo,
                  segmentNo: input.segmentNo,
                  accent: accentCandidate,
                  provider: synth.provider,
                  providerVersion: synth.providerVersion,
                  key: upload.key,
                });
              }

              const retrieval = await verifyAssetRetrieval(upload.key);
              if (!retrieval.ok) {
                rendered = {
                  segmentNo: input.segmentNo,
                  status: "failed",
                  accent: accentCandidate,
                  voiceId,
                  provider: synth.provider,
                  providerVersion: synth.providerVersion,
                  errorCode: retrieval.errorCode,
                  errorMessage: retrieval.reason,
                  validatorCode: retrieval.errorCode,
                  validatorReason: retrieval.reason,
                  attempts: segmentAttempts,
                  fallbackUsed: fallbackUsedForSegment,
                };
                validationDetections += 1;
                continue;
              }

              const delivery = buildDeliveryUrl(upload.bucket, upload.key);
              const deliveryCheck = await verifyDeliveryCompatibility({
                delivery,
                storageKey: upload.key,
              });
              if (!deliveryCheck.ok) {
                rendered = {
                  segmentNo: input.segmentNo,
                  status: "failed",
                  accent: accentCandidate,
                  voiceId,
                  provider: synth.provider,
                  providerVersion: synth.providerVersion,
                  errorCode: "DELIVERY_VERIFICATION_FAILED",
                  errorMessage: deliveryCheck.reason,
                  validatorCode: "DELIVERY_VERIFICATION_FAILED",
                  validatorReason: deliveryCheck.reason,
                  attempts: segmentAttempts,
                  fallbackUsed: fallbackUsedForSegment,
                };
                validationDetections += 1;
                continue;
              }
              rendered = {
                segmentNo: input.segmentNo,
                status: "success",
                url: delivery.url,
                durationSec: quality.durationSec,
                accent: accentCandidate,
                voiceId,
                provider: synth.provider,
                providerVersion: synth.providerVersion,
                checksumSha256: upload.checksumSha256 ?? checksumSha256,
                storageKey: upload.key,
                urlMode: delivery.mode,
                urlExpiresAt: delivery.expiresAt,
                retrievalVerified: true,
                pipelineVersion: postProcessing.pipelineVersion,
                durationSource: quality.durationSource,
                attempts: segmentAttempts,
                fallbackUsed: fallbackUsedForSegment,
              };
              break;
            } catch (error) {
              const normalized = providerCandidate.normalizeError(error);
              rendered = {
                segmentNo: input.segmentNo,
                status: "failed",
                accent: accentCandidate,
                voiceId,
                provider: providerCandidate.provider,
                providerVersion: providerCandidate.version,
                errorCode: normalized.code,
                errorMessage: normalized.message,
                attempts: segmentAttempts,
                fallbackUsed: fallbackUsedForSegment,
              };

              const isLastProvider = providerIndex >= providerChain.length - 1;
              const canFallbackProvider =
                !isLastProvider &&
                (normalized.retryable || normalized.code === "AUTH_ERROR" || normalized.code === "PROVIDER_UNAVAILABLE");
              if (canFallbackProvider) {
                fallbackUsedForSegment = true;
                fallbackUsages += 1;
                continue;
              }
            }
          }

          if (rendered?.status === "success") {
            break;
          }
        }

        if (rendered?.status === "success") {
          break;
        }
      }

      if (rendered?.status === "success") {
        break;
      }
    }

    results.push(
      rendered ?? {
        segmentNo: input.segmentNo,
        status: "failed",
        accent: normalizeAccent(input.accent ?? params.sectionAccent ?? DEFAULT_ACCENT),
        provider: provider.provider,
        providerVersion: provider.version,
        errorCode: "UNKNOWN",
        errorMessage: "Segment render failed with no provider output",
        attempts: segmentAttempts,
        fallbackUsed: false,
      },
    );
  }

  const successResults = results.filter((item) => item.status === "success");
  const failureCodes = results
    .filter((item) => item.status === "failed")
    .reduce<Record<string, number>>((acc, item) => {
      const code = item.errorCode ?? "UNKNOWN";
      acc[code] = (acc[code] ?? 0) + 1;
      return acc;
    }, {});
  const averageDurationSec =
    successResults.length > 0
      ? Number(
          (
            successResults.reduce((sum, entry) => sum + Number(entry.durationSec ?? 0), 0) /
            successResults.length
          ).toFixed(2),
        )
      : 0;
  const synthSuccessRate =
    params.segmentInputs.length > 0
      ? Number((successResults.length / params.segmentInputs.length).toFixed(4))
      : 0;
  const retryCount = Math.max(0, totalAttempts - params.segmentInputs.length);

  try {
    await publishTtsQualityMetric({
      taskProgressId: params.taskId,
      userId: params.userId,
      sectionNo: params.sectionNo,
      synthSuccessRate,
      averageDurationSec,
      retryCount,
      failureCodes,
      silenceOrCorruptionDetections: validationDetections,
      fallbackUsages,
      provider: provider.provider,
      providerVersion: provider.version,
      pipelineVersion: AUDIO_PIPELINE_VERSION,
    });
  } catch (error: any) {
    console.error("[TTS][QualityMetric][EmitFailed]", {
      taskId: params.taskId,
      sectionNo: params.sectionNo,
      message: error?.message ?? "unknown",
    });
  }

  await finishListeningStageSpan(audioSpan, {
    success: results.every((item) => item.status === "success"),
    errorClass: results.every((item) => item.status === "success") ? null : "AUDIO_RENDER_FAILED",
    metadata: {
      segment_count: params.segmentInputs.length,
      success_count: successResults.length,
      retry_count: retryCount,
      fallback_usages: fallbackUsages,
    },
  });

  return {
    success: results.every((item) => item.status === "success"),
    sectionNo: params.sectionNo,
    promptVersion,
    results,
  };
};

export async function generateAudioFromScript(
  scriptText: string,
  accent: string,
  userId: string,
  taskId: string,
  weekNumber: number,
  context?: {
    sessionId?: string;
    sectionNo?: number;
    promptVersion?: string;
    correlationId?: string;
    sectionFallbackAccents?: string[];
  },
): Promise<{
  success: boolean;
  audioUrl?: string;
  duration?: number;
  error?: string;
  metadata?: SegmentRenderResult;
}> {
  if (!process.env.AWS_ACCESS_KEY_ID?.trim() || !process.env.AWS_SECRET_ACCESS_KEY?.trim()) {
    return {
      success: false,
      error: "AWS credentials not configured for Polly synthesis",
      metadata: {
        segmentNo: 1,
        status: "failed",
        accent: normalizeAccent(accent),
        provider: "aws-polly",
        providerVersion: "neural-v1",
        errorCode: "AUTH_ERROR",
        errorMessage: "AWS credentials missing",
      },
    };
  }

  const render = await renderSectionAudioAssets({
    userId,
    taskId,
    weekNumber,
    sectionNo: context?.sectionNo ?? 1,
    sessionId: context?.sessionId ?? taskId,
    correlationId: context?.correlationId,
    promptVersion: context?.promptVersion ?? DEFAULT_PROMPT_VERSION,
    sectionAccent: accent,
    sectionFallbackAccents: context?.sectionFallbackAccents ?? [],
    segmentInputs: [
      {
        segmentNo: 1,
        transcript: scriptText,
        accent,
      },
    ],
  });

  const first = render.results[0];
  if (!first || first.status !== "success" || !first.url || !first.durationSec) {
    return {
      success: false,
      error: first?.errorMessage ?? "Failed to generate audio",
      metadata: first,
    };
  }

  return {
    success: true,
    audioUrl: first.url,
    duration: first.durationSec,
    metadata: first,
  };
}

export const getTtsProviderHealth = async () => {
  let providerChain: TtsProviderAdapter[];
  try {
    providerChain = resolveProviderChain();
  } catch (error: any) {
    return {
      ok: false,
      provider: "unconfigured",
      providerVersion: "n/a",
      configuredProvider: (process.env.LISTENING_TTS_PROVIDER || "polly").trim().toLowerCase(),
      audioUrlMode: isSignedMode() ? "signed" : "public",
      details: {
        code: "INPUT_INVALID",
        message: error?.message ?? "Provider misconfiguration",
      },
    };
  }
  const checks = await Promise.all(
    providerChain.map(async (provider) => {
      const health = await provider.healthcheck();
      return {
        provider: provider.provider,
        providerVersion: provider.version,
        ok: health.ok,
        details: health.details,
      };
    }),
  );
  const primary = checks[0];
  const backupProviders = checks.slice(1);

  return {
    ok: checks.every((check) => check.ok),
    provider: primary?.provider ?? "unconfigured",
    providerVersion: primary?.providerVersion ?? "n/a",
    configuredProvider: (process.env.LISTENING_TTS_PROVIDER || "polly").trim().toLowerCase(),
    fallbackProviders: backupProviders.map((entry) => ({
      provider: entry.provider,
      version: entry.providerVersion,
      ok: entry.ok,
    })),
    audioUrlMode: isSignedMode() ? "signed" : "public",
    details: {
      primary: primary?.details ?? {},
      backups: backupProviders.map((entry) => entry.details),
    },
  };
};

export async function checkAudioExists(audioUrl: string): Promise<boolean> {
  try {
    if (!audioUrl) {
      return false;
    }

    if (audioUrl.includes("/api/listening/audio/signed")) {
      const tokenMatch = audioUrl.match(/[?&]token=([^&]+)/);
      if (!tokenMatch || !tokenMatch[1]) {
        return false;
      }
      const payload = parseSignedAudioTokenPayload(decodeURIComponent(tokenMatch[1]));
      if (!payload?.key) {
        return false;
      }
      const head = await s3Client.send(
        new HeadObjectCommand({
          Bucket: payload.bucket || audioBucket,
          Key: payload.key,
        }),
      );
      return (head.ContentLength ?? 0) > 0;
    }

    const urlParts = audioUrl.split("/");
    const bucketIndex = urlParts.findIndex((part) => part.includes(".s3."));
    if (bucketIndex === -1) {
      return false;
    }

    const s3Key = urlParts.slice(bucketIndex + 1).join("/");
    const head = await s3Client.send(
      new HeadObjectCommand({
        Bucket: audioBucket,
        Key: s3Key,
      }),
    );

    return (head.ContentLength ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function checkAudioObjectByKey(key: string): Promise<boolean> {
  try {
    const head = await s3Client.send(
      new HeadObjectCommand({
        Bucket: audioBucket,
        Key: key,
      }),
    );
    return (head.ContentLength ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function checkAudioAssetsExist(audioUrls: string[]): Promise<{ ok: boolean; missing: string[] }> {
  const uniqueUrls = [...new Set((audioUrls ?? []).filter((url) => typeof url === "string" && url.trim().length > 0))];
  const checks = await Promise.all(
    uniqueUrls.map(async (url) => ({
      url,
      exists: await checkAudioExists(url),
    })),
  );

  const missing = checks.filter((item) => !item.exists).map((item) => item.url);
  return {
    ok: missing.length === 0,
    missing,
  };
}

export const verifyAudioFetchability = async (url: string): Promise<boolean> => {
  if (!url) return false;

  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
};

export const createSectionAudioAssetMetadata = (params: {
  render: SectionRenderResult;
  sectionNo: number;
}) => {
  return params.render.results
    .filter((result) => result.status === "success" && result.url && result.durationSec)
    .map((result) => ({
      segment_no: result.segmentNo,
      accent: result.accent,
      voice_id: result.voiceId ?? null,
      url: result.url as string,
      duration_seconds: result.durationSec as number,
      provider: result.provider,
      provider_version: result.providerVersion,
      pipeline_version: result.pipelineVersion ?? AUDIO_PIPELINE_VERSION,
      checksum_sha256: result.checksumSha256 ?? null,
      status: result.status,
      url_mode: result.urlMode ?? "public",
      url_expires_at: result.urlExpiresAt ?? null,
      retrieval_verified: result.retrievalVerified ?? false,
      section_no: params.sectionNo,
      duration_source: result.durationSource ?? null,
      validator_code: result.validatorCode ?? null,
      validator_reason: result.validatorReason ?? null,
    }));
};

export const createSectionAudioQaLog = (params: {
  render: SectionRenderResult;
  sectionNo: number;
}) => {
  const generatedAt = new Date().toISOString();
  const entries = params.render.results.map((result) => ({
    segment_no: result.segmentNo,
    status: result.status,
    error_code: result.errorCode ?? null,
    error_message: result.errorMessage ?? null,
    validator_code: result.validatorCode ?? null,
    validator_reason: result.validatorReason ?? null,
    attempts: result.attempts ?? 0,
    fallback_used: result.fallbackUsed ?? false,
    retrieval_verified: result.retrievalVerified ?? false,
    duration_seconds: result.durationSec ?? null,
    duration_source: result.durationSource ?? null,
    voice_id: result.voiceId ?? null,
    accent: result.accent,
  }));

  return {
    section_no: params.sectionNo,
    generated_at: generatedAt,
    entries,
    summary: {
      total: entries.length,
      success: entries.filter((entry) => entry.status === "success").length,
      failed: entries.filter((entry) => entry.status === "failed").length,
      validator_failures: entries.filter((entry) => Boolean(entry.validator_code)).length,
      retrieval_failures: entries.filter((entry) => entry.retrieval_verified === false).length,
    },
  };
};

export const getAudioAssetPolicy = () => {
  const enforcedSampleRate = process.env.LISTENING_AUDIO_SAMPLE_RATE?.trim() || DEFAULT_SAMPLE_RATE;
  const enforcedLoudness = process.env.LISTENING_AUDIO_LOUDNESS_BASELINE?.trim() || AUDIO_LOUDNESS_BASELINE;
  return {
    outputFormat: AUDIO_OUTPUT_FORMAT,
    sampleRate: enforcedSampleRate,
    loudnessBaseline: enforcedLoudness,
    pipelineVersion: AUDIO_PIPELINE_VERSION,
    urlMode: isSignedMode() ? "signed" : "public",
    signedTtlSeconds: isSignedMode() ? signedUrlTtlSeconds : null,
  };
};

export async function fetchAudioObjectByKey(key: string): Promise<Buffer | null> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: audioBucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      return null;
    }

    return await streamToBuffer(response.Body as any);
  } catch {
    return null;
  }
}

export const buildCorrelationId = () => `aud_${randomUUID()}`;
