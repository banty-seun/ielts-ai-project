import type { Express } from "express";
import { regenerateAndVerify, FAILING_TASK_ID } from "../regenerateAudio";

export function registerRegenerateRoutes(app: Express) {
  // Route to regenerate failing audio with SSE-S3 enforcement
  app.post('/api/regenerate/audio/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;
      console.log(`[API] Regenerating audio for task ${taskId}`);
      
      const result = await regenerateAndVerify(taskId);
      
      if (!result) {
        return res.status(500).json({
          success: false,
          error: "No result from regenerateAudio"
        });
      }

      if (result.ok) {
        res.json({
          success: true,
          taskId: result.taskId,
          url: result.url,
          message: "Audio regenerated successfully with SSE-S3"
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error: unknown) {
      console.error('[API] Error in regenerate route:', error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: message
      });
    }
  });

  // Quick route to regenerate the specific failing task
  app.post('/api/regenerate/failing-task', async (req, res) => {
    try {
      console.log(`[API] Regenerating failing task ${FAILING_TASK_ID}`);
      
      const result = await regenerateAndVerify(FAILING_TASK_ID);
      
      if (!result) {
        return res.status(500).json({
          success: false,
          error: "No result from regenerateAudio"
        });
      }

      if (result.ok) {
        res.json({
          success: true,
          taskId: result.taskId,
          url: result.url,
          message: `Audio regenerated successfully for failing task ${FAILING_TASK_ID}`
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error: unknown) {
      console.error('[API] Error regenerating failing task:', error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: message
      });
    }
  });
}
