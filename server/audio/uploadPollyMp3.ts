import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const DEFAULT_AUDIO_BUCKET = "ielts-ai-audio";
const DEFAULT_AUDIO_REGION = "eu-west-2";

const resolvedBucket = process.env.AWS_S3_BUCKET?.trim();
const resolvedRegion = process.env.AWS_REGION?.trim();

const AUDIO_BUCKET = resolvedBucket && resolvedBucket.length > 0 ? resolvedBucket : DEFAULT_AUDIO_BUCKET;
const AUDIO_REGION = resolvedRegion && resolvedRegion.length > 0 ? resolvedRegion : DEFAULT_AUDIO_REGION;

const s3 = new S3Client({ region: AUDIO_REGION });

const buildLegacyKey = (params: {
  userId: string;
  weekNumber: number;
  taskId: string;
  accent: string;
}) => {
  return `audio/${params.userId}/week-${params.weekNumber}/task-${params.taskId}-${params.accent}.mp3`;
};

export type UploadPollyMp3Params =
  | {
      userId: string;
      weekNumber: number;
      taskId: string;
      accent: string;
      audioBuffer: Buffer;
      metadata?: Record<string, string>;
      checkExisting?: boolean;
    }
  | {
      key: string;
      audioBuffer: Buffer;
      metadata?: Record<string, string>;
      checkExisting?: boolean;
    };

export type UploadPollyMp3Result = {
  bucket: string;
  key: string;
  url: string;
  existing: boolean;
  etag: string | null;
  contentLength: number | null;
  checksumSha256?: string;
};

const normalizeMetadata = (metadata?: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 128);
    const cleanValue = String(value).slice(0, 1024);
    if (!cleanKey || !cleanValue) continue;
    out[cleanKey] = cleanValue;
  }
  return out;
};

const buildPublicUrl = (bucket: string, key: string) => {
  return `https://${bucket}.s3.${AUDIO_REGION}.amazonaws.com/${key}`;
};

const resolveKey = (params: UploadPollyMp3Params) => {
  if ("key" in params) {
    return params.key;
  }
  return buildLegacyKey(params);
};

export async function uploadPollyMp3(params: UploadPollyMp3Params): Promise<UploadPollyMp3Result> {
  const key = resolveKey(params);
  const metadata = normalizeMetadata(params.metadata);
  const shouldCheckExisting = params.checkExisting !== false;

  if (shouldCheckExisting) {
    try {
      const head = await s3.send(new HeadObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: key,
      }));

      return {
        bucket: AUDIO_BUCKET,
        key,
        url: buildPublicUrl(AUDIO_BUCKET, key),
        existing: true,
        etag: head.ETag ?? null,
        contentLength: typeof head.ContentLength === "number" ? head.ContentLength : null,
        checksumSha256: head.Metadata?.checksum_sha256,
      };
    } catch {
      // Object does not exist (or HEAD not allowed), continue with upload.
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: key,
      Body: params.audioBuffer,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=86400",
      ServerSideEncryption: "AES256",
      Metadata: metadata,
    }),
  );

  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: key,
    }),
  );

  return {
    bucket: AUDIO_BUCKET,
    key,
    url: buildPublicUrl(AUDIO_BUCKET, key),
    existing: false,
    etag: head.ETag ?? null,
    contentLength: typeof head.ContentLength === "number" ? head.ContentLength : null,
    checksumSha256: head.Metadata?.checksum_sha256,
  };
}
