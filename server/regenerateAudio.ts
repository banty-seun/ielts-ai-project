import { S3Client, PutObjectCommand, HeadObjectCommand, GetBucketPolicyCommand } from "@aws-sdk/client-s3";
import { storage } from "./storage";
import { generateAudioFromScript } from "./audioService";

const BUCKET = "ielts-ai-audio";
const REGION = "eu-west-2";
const FAILING_TASK_ID = "e6ba6c5e-a3c2-47b2-a0d1-f66cb91df020";

const s3 = new S3Client({ region: REGION });

// Helper: verify public HEAD and Range (no creds)
async function verifyPublicAccess(url: string) {
  try {
    const headRes = await fetch(url, { method: "HEAD" });
    console.log("[PUBLIC][HEAD]", {
      url,
      status: headRes.status,
      ct: headRes.headers.get("content-type"),
      ar: headRes.headers.get("accept-ranges"),
      cr: headRes.headers.get("content-range"),
      xAmzErr: headRes.headers.get("x-amz-error-code"),
    });

    const rangeRes = await fetch(url, { headers: { Range: "bytes=0-1" } });
    let bodyPreview: string | null = null;
    if (!rangeRes.ok) {
      try { 
        bodyPreview = (await rangeRes.text()).slice(0, 300); 
      } catch { 
        bodyPreview = "(no body)"; 
      }
    }
    console.log("[PUBLIC][RANGE]", {
      status: rangeRes.status,
      ct: rangeRes.headers.get("content-type"),
      cr: rangeRes.headers.get("content-range"),
      bodyPreview,
    });

    if (headRes.status === 403 || rangeRes.status === 403) {
      console.warn("[PUBLIC] 403 detected. Dumping bucket policy...");
      try {
        const pol = await s3.send(new GetBucketPolicyCommand({ Bucket: BUCKET }));
        console.log("[S3][BucketPolicy]", pol?.Policy);
      } catch (e) {
        console.warn("[S3][BucketPolicy] Unable to read bucket policy:", (e as Error)?.message);
      }
      
      const errRes = await fetch(url);
      let errBody = null;
      if (errRes) { 
        try { 
          errBody = (await errRes.text()).slice(0, 1000); 
        } catch { 
          errBody = "(no body)"; 
        } 
      }
      console.log("[PUBLIC][GET][Body]", { status: errRes?.status, errBody });
    }
  } catch (e) {
    console.error("[PUBLIC] Verification failed:", (e as Error)?.message);
  }
}

// Main: regenerate and verify for the failing task
export async function regenerateAndVerify(taskId: string) {
  console.log(`[REGEN] Starting regeneration for task ${taskId}`);
  
  try {
    // Get task progress to find user and week info
    const taskProgress = await storage.getTaskProgress(taskId);
    if (!taskProgress) {
      console.error(`[REGEN] Task progress not found for ${taskId}`);
      return;
    }
    
    // Get task content for script text
    const taskWithContent = await storage.getTaskWithContent(taskId);
    if (!taskWithContent || !taskWithContent.scriptText) {
      console.error(`[REGEN] Task content or script not found for ${taskId}`);
      return;
    }
    
    console.log(`[REGEN] Found task for user ${taskProgress.userId}, week ${taskProgress.weekNumber}`);
    
    // Generate audio with British accent using existing service
    const audioResult = await generateAudioFromScript(
      taskWithContent.scriptText,
      "British",
      taskProgress.userId,
      taskId,
      taskProgress.weekNumber
    );
    
    if (audioResult.success) {
      console.log(`[AUDIO][REGEN OK]`, { 
        taskId, 
        url: audioResult.audioUrl, 
        duration: audioResult.duration 
      });
      
      // Test public access immediately
      await verifyPublicAccess(audioResult.audioUrl);
      
      return {
        ok: true,
        taskId,
        url: audioResult.audioUrl,
      };
    } else {
      console.error(`[REGEN] Failed to generate audio for ${taskId}`);
      return { ok: false, error: "Audio generation failed" };
    }
  } catch (error) {
    console.error(`[REGEN] Error regenerating ${taskId}:`, error.message);
    return { ok: false, error: error.message };
  }
}

// Export the failing task ID for external use
export { FAILING_TASK_ID };