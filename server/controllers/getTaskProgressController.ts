import { Request, Response } from 'express';
import { storage } from '../storage';

// Get task progress by ID
export const getTaskProgressById = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const { progressId } = req.params;
    
    console.log(`[Task Progress API] GET task progress by ID: ${progressId} for user ${userId}`);
    
    // Get the task progress record
    const taskProgress = await storage.getTaskProgress(progressId);
    
    // Log detailed debugging info about the task progress fetching attempt
    console.log('[Task Progress API] GET result:', {
      taskId: progressId,
      found: !!taskProgress,
      userId: userId,
      taskUserId: taskProgress?.userId,
      ownerMatch: taskProgress?.userId === userId
    });
    
    // If task progress not found, return 404
    if (!taskProgress) {
      return res.status(404).json({
        success: false,
        message: "Task progress record not found",
        detail: `No record found with ID: ${progressId}`
      });
    }
    
    // Ensure the user owns this task progress record
    if (taskProgress.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to access this task progress record"
      });
    }
    
    // Return the task progress record
    return res.status(200).json({
      success: true,
      taskProgress
    });
  } catch (error: any) {
    console.error('[Task Progress API] Error fetching task progress by ID:', error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch task progress record",
      error: error.message
    });
  }
};