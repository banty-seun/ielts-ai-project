import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const DEFAULT_AUDIO_BUCKET = "ielts-ai-audio";
const DEFAULT_AUDIO_REGION = "eu-west-2";

const resolvedBucket = process.env.AWS_S3_BUCKET?.trim();
const resolvedRegion = process.env.AWS_REGION?.trim();

const AUDIO_BUCKET = resolvedBucket && resolvedBucket.length > 0 ? resolvedBucket : DEFAULT_AUDIO_BUCKET;
const AUDIO_REGION = resolvedRegion && resolvedRegion.length > 0 ? resolvedRegion : DEFAULT_AUDIO_REGION;

const s3 = new S3Client({ region: AUDIO_REGION });

export async function uploadPollyMp3(params: {
  userId: string;
  weekNumber: number;
  taskId: string;
  accent: string;      // e.g., "british"
  audioBuffer: Buffer; // Polly MP3 buffer
}) {
  const { userId, weekNumber, taskId, accent, audioBuffer } = params;

  const Key = `audio/${userId}/week-${weekNumber}/task-${taskId}-${accent}.mp3`;

  // Bucket has "Bucket owner enforced" → DO NOT set ACL
  await s3.send(new PutObjectCommand({
    Bucket: AUDIO_BUCKET,
    Key,
    Body: audioBuffer,
    ContentType: "audio/mpeg",
    CacheControl: "public, max-age=86400",
    ServerSideEncryption: "AES256", // Force SSE-S3 (not KMS)
  }));

  // Verify metadata
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: AUDIO_BUCKET, Key }));
    console.log("[S3][HEAD OK]", {
      Key,
      contentType: head.ContentType,
      sse: head.ServerSideEncryption,
      acceptRanges: head.AcceptRanges,
      contentLength: head.ContentLength,
    });
  } catch (e) {
    console.warn("[S3][HEAD ERROR]", { Key, error: (e as Error)?.message });
  }

  const publicUrl = `https://${AUDIO_BUCKET}.s3.${AUDIO_REGION}.amazonaws.com/${Key}`;
  return { bucket: AUDIO_BUCKET, key: Key, url: publicUrl };
}
