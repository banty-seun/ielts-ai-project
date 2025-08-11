import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const AUDIO_BUCKET = "ielts-ai-audio";
const AUDIO_REGION = "eu-west-2";

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
  }));

  // Verify metadata
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: AUDIO_BUCKET, Key }));
    console.log("[S3][HEAD OK]", {
      Key,
      contentType: head.ContentType,
      cacheControl: head.CacheControl,
      acceptRanges: head.AcceptRanges,
      contentLength: head.ContentLength,
    });
  } catch (e) {
    console.warn("[S3][HEAD ERROR]", { Key, error: (e as Error)?.message });
  }

  const publicUrl = `https://${AUDIO_BUCKET}.s3.${AUDIO_REGION}.amazonaws.com/${Key}`;
  return { bucket: AUDIO_BUCKET, key: Key, url: publicUrl };
}