import { PollyClient, SynthesizeSpeechCommand, Engine, OutputFormat, VoiceId } from "@aws-sdk/client-polly";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { uploadPollyMp3 } from "./audio/uploadPollyMp3";

// Initialize AWS clients
const awsRegion = (process.env.AWS_REGION || "eu-west-2").trim();

const pollyClient = new PollyClient({ 
  region: awsRegion 
});

const s3Client = new S3Client({ 
  region: awsRegion 
});

// Accent to Neural voice mapping
const accentVoiceMap: Record<string, VoiceId> = {
  British: VoiceId.Amy,         // en-GB, Female, Neural
  Canadian: VoiceId.Joanna,     // en-CA, Female, Neural  
  Australian: VoiceId.Olivia,   // en-AU, Female, Neural
  American: VoiceId.Matthew,    // en-US, Male, Neural
  NewZealand: VoiceId.Aria,     // en-NZ, Female, Neural
};

/**
 * Generate audio from script text using Amazon Polly Neural TTS
 * @param scriptText - The text to convert to speech
 * @param accent - The accent preference (maps to voice)
 * @param userId - User ID for S3 path organization
 * @param taskId - Task ID for unique file naming
 * @param weekNumber - Week number for folder organization
 * @returns Object with success status, audio URL, and duration
 */
export async function generateAudioFromScript(
  scriptText: string,
  accent: string,
  userId: string,
  taskId: string,
  weekNumber: number
): Promise<{
  success: boolean;
  audioUrl?: string;
  duration?: number;
  error?: string;
}> {
  try {
    // Validate required AWS environment variables
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
    }

    if (!process.env.AWS_S3_BUCKET) {
      throw new Error("AWS S3 bucket not configured. Please set AWS_S3_BUCKET environment variable");
    }

    // Map accent to Neural voice (default to British if not found)
    const voiceId = accentVoiceMap[accent] || accentVoiceMap.British;
    
    console.log(`[Audio Generation] Generating audio for task ${taskId}:`, {
      accent,
      voiceId,
      scriptLength: scriptText.length,
      weekNumber,
      awsRegion: awsRegion
    });

    // DEBUG: Log the actual script text content
    console.log(`[Audio Generation] Script text content:`, JSON.stringify(scriptText));
    
    // DEBUG: Test with hardcoded text if script is empty or problematic
    const testText = "Welcome to the IELTS Listening Test. This is a practice task about student accommodation.";
    const textToUse = scriptText && scriptText.trim().length > 0 ? scriptText : testText;
    
    if (textToUse === testText) {
      console.log(`[Audio Generation] Using hardcoded test text due to empty/invalid scriptText`);
    }

    // Prepare Polly synthesis parameters
    const pollyParams = {
      Engine: Engine.NEURAL,
      OutputFormat: OutputFormat.MP3,
      SampleRate: "22050",
      Text: textToUse,
      VoiceId: voiceId,
    };

    // DEBUG: Log full Polly request parameters
    console.log(`[Audio Generation] Polly request parameters:`, {
      Engine: pollyParams.Engine,
      OutputFormat: pollyParams.OutputFormat,
      SampleRate: pollyParams.SampleRate,
      VoiceId: pollyParams.VoiceId,
      TextLength: pollyParams.Text.length,
      TextPreview: pollyParams.Text.substring(0, 100) + (pollyParams.Text.length > 100 ? '...' : '')
    });

    // Generate speech using Amazon Polly
    const synthesizeCommand = new SynthesizeSpeechCommand(pollyParams);
    const pollyResponse = await pollyClient.send(synthesizeCommand);

    console.log(`[Audio Generation] Polly response received:`, {
      hasAudioStream: !!pollyResponse.AudioStream,
      requestId: pollyResponse.$metadata?.requestId,
      httpStatusCode: pollyResponse.$metadata?.httpStatusCode
    });

    if (!pollyResponse.AudioStream) {
      throw new Error("Polly returned no audio stream");
    }

    // Convert audio stream to buffer using Node.js stream methods
    const audioBuffer = await streamToBuffer(pollyResponse.AudioStream);
    
    // INVESTIGATION: Comprehensive buffer analysis for silent audio debugging
    const bufferSizeKB = audioBuffer.length / 1024;
    const isSuspiciouslySmall = audioBuffer.length < 2048; // Less than 2KB indicates likely silence
    const expectedMinSize = textToUse.length * 10; // Rough estimate: 10 bytes per character minimum
    
    console.log(`[AUDIO INVESTIGATION] Complete buffer analysis:`, {
      bufferSizeBytes: audioBuffer.length,
      bufferSizeKB: Math.round(bufferSizeKB * 100) / 100,
      isSuspiciouslySmall,
      expectedMinSizeBytes: expectedMinSize,
      scriptTextLength: textToUse.length,
      scriptTextWordCount: textToUse.split(/\s+/).length,
      scriptTextPreview: textToUse.substring(0, 200) + (textToUse.length > 200 ? '...' : ''),
      isUsingFallbackText: textToUse.includes("Welcome to your IELTS Listening practice"),
      voice: voiceId,
      engine: Engine.NEURAL,
      sampleRate: "22050"
    });
    
    // DEBUG: Log buffer size after conversion
    console.log(`[Audio Generation] Audio buffer size after conversion: ${audioBuffer.length} bytes`);
    
    if (audioBuffer.length === 0) {
      console.error(`[Audio Generation] ERROR: Audio buffer is empty! Polly may have failed silently.`);
      throw new Error("Generated audio buffer is empty");
    }
    
    if (isSuspiciouslySmall) {
      console.warn(`[AUDIO INVESTIGATION] ⚠️  WARNING: Audio buffer is suspiciously small!`);
      console.warn(`[AUDIO INVESTIGATION] Buffer size: ${audioBuffer.length} bytes (${bufferSizeKB.toFixed(2)} KB)`);
      console.warn(`[AUDIO INVESTIGATION] This likely indicates SILENT AUDIO generation`);
      console.warn(`[AUDIO INVESTIGATION] Script text being synthesized:`);
      console.warn(`[AUDIO INVESTIGATION] "${textToUse}"`);
      console.warn(`[AUDIO INVESTIGATION] Voice: ${voiceId}, Engine: ${Engine.NEURAL}`);
    }
    
    // Calculate estimated duration based on word count (165 words per minute)
    const wordCount = textToUse.split(/\s+/).length;
    const estimatedDuration = Math.ceil((wordCount / 165) * 60); // Duration in seconds

    // Upload to S3 using clean uploadPollyMp3 function
    const { url: audioUrl } = await uploadPollyMp3({
      userId,
      weekNumber,
      taskId,
      accent: accent.toLowerCase(),
      audioBuffer, // Buffer returned from Polly
    });

    console.log(`[Audio Generation] Successfully generated audio for task ${taskId}:`, {
      audioUrl,
      duration: estimatedDuration,
      fileSize: audioBuffer.length,
      voice: voiceId
    });

    return {
      success: true,
      audioUrl,
      duration: estimatedDuration
    };

  } catch (error: any) {
    // Enhanced error logging for debugging silent failures
    console.error(`[Audio Debug] COMPREHENSIVE ERROR ANALYSIS for task ${taskId}:`);
    console.error(`[Audio Debug] Error name: ${error.name}`);
    console.error(`[Audio Debug] Error message: ${error.message}`);
    console.error(`[Audio Debug] Error code: ${error.code || 'N/A'}`);
    console.error(`[Audio Debug] Error statusCode: ${error.statusCode || 'N/A'}`);
    console.error(`[Audio Debug] Full error object:`, JSON.stringify(error, null, 2));
    
    // Log the script content and parameters that caused the error
    console.error(`[Audio Debug] Script text that failed: "${scriptText}"`);
    console.error(`[Audio Debug] Script length: ${scriptText.length} characters`);
    console.error(`[Audio Debug] Requested accent: ${accent}`);
    console.error(`[Audio Debug] Selected voice ID: ${accentVoiceMap[accent] || accentVoiceMap.British}`);
    console.error(`[Audio Debug] AWS Region: ${awsRegion}`);
    console.error(`[Audio Debug] S3 Bucket: ${process.env.AWS_S3_BUCKET}`);
    
    // Check AWS credentials availability (without exposing them)
    console.error(`[Audio Debug] AWS credentials check:`, {
      hasAccessKeyId: !!process.env.AWS_ACCESS_KEY_ID,
      hasSecretAccessKey: !!process.env.AWS_SECRET_ACCESS_KEY,
      hasBucket: !!process.env.AWS_S3_BUCKET,
      accessKeyLength: process.env.AWS_ACCESS_KEY_ID?.length || 0,
      secretKeyLength: process.env.AWS_SECRET_ACCESS_KEY?.length || 0
    });
    
    // Provide specific error messages for common issues
    let errorMessage = "Failed to generate audio";
    
    if (error.name === "InvalidParameterValueException") {
      errorMessage = "Invalid text or voice parameters for Polly";
      console.error(`[Audio Debug] Polly parameter validation failed - check voice ID and text content`);
    } else if (error.name === "TextLengthExceededException") {
      errorMessage = "Script text is too long for Polly synthesis";
      console.error(`[Audio Debug] Text length: ${scriptText.length} characters exceeds Polly limits`);
    } else if (error.name === "NoSuchBucket") {
      errorMessage = "S3 bucket not found";
      console.error(`[Audio Debug] Bucket ${process.env.AWS_S3_BUCKET} does not exist or access denied`);
    } else if (error.name === "AccessDenied" || error.code === "AccessDenied") {
      errorMessage = "AWS permissions denied";
      console.error(`[Audio Debug] AWS credentials lack required permissions for Polly/S3 operations`);
    } else if (error.name === "CredentialsError" || error.message?.includes("credentials")) {
      errorMessage = "AWS credentials not properly configured";
      console.error(`[Audio Debug] AWS credential configuration error`);
    } else if (error.name === "NetworkingError" || error.code === "NetworkingError") {
      errorMessage = "Network error connecting to AWS services";
      console.error(`[Audio Debug] Network connectivity issue with AWS services`);
    } else if (error.message) {
      errorMessage = error.message;
    }

    console.error(`[Audio Debug] Final error message to return: "${errorMessage}"`);

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Helper function to convert Node.js Readable stream to Buffer
 */
async function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    console.log(`[Audio Stream] Starting buffer collection from Polly stream`);
    
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      console.log(`[Audio Stream] Received chunk: ${chunk.length} bytes`);
    });
    
    stream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      console.log(`[Audio Stream] ✅ Stream processing complete: ${buffer.length} bytes total`);
      resolve(buffer);
    });
    
    stream.on('error', (error: Error) => {
      console.error(`[Audio Stream] ❌ Stream processing error:`, error);
      reject(error);
    });
  });
}

/**
 * Check if audio already exists for a task
 * @param audioUrl - The S3 URL to check
 * @returns Promise<boolean> - true if audio exists
 */
export async function checkAudioExists(audioUrl: string): Promise<boolean> {
  try {
    // INVESTIGATION: Log audio URL validation for silent audio debugging
    console.log(`[AUDIO INVESTIGATION] Checking if audio exists:`, {
      audioUrl,
      urlProvided: !!audioUrl,
      urlLength: audioUrl ? audioUrl.length : 0
    });
    
    if (!audioUrl) {
      console.log(`[AUDIO INVESTIGATION] No audio URL provided`);
      return false;
    }
    
    // Extract S3 key from URL
    const urlParts = audioUrl.split('/');
    const bucketIndex = urlParts.findIndex(part => part.includes('.s3.'));
    
    console.log(`[AUDIO INVESTIGATION] URL parsing:`, {
      urlParts: urlParts.length,
      bucketIndex,
      hasS3Pattern: bucketIndex !== -1
    });
    
    if (bucketIndex === -1) {
      console.warn(`[AUDIO INVESTIGATION] Invalid S3 URL format: ${audioUrl}`);
      return false;
    }
    
    const s3Key = urlParts.slice(bucketIndex + 1).join('/');
    
    console.log(`[AUDIO INVESTIGATION] S3 validation:`, {
      bucket: process.env.AWS_S3_BUCKET,
      s3Key,
      keyLength: s3Key.length
    });
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: s3Key
    });
    
    const response = await s3Client.send(getObjectCommand);
    
    console.log(`[AUDIO INVESTIGATION] ✅ Audio file exists in S3:`, {
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified
    });
    
    return true;
  } catch (error: any) {
    console.log(`[AUDIO INVESTIGATION] ❌ Audio file check failed:`, {
      errorName: error.name,
      errorCode: error.$metadata?.httpStatusCode,
      errorMessage: error.message,
      audioUrl
    });
    return false;
  }
}