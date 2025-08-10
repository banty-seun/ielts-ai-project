import express, { type Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { verifyFirebaseAuth, ensureFirebaseUser } from "./firebaseAuth";
import { batchInitializeTaskProgress } from "./controllers/taskProgressController";
import { v4 as uuidv4 } from 'uuid';

export async function registerRoutes(app: express.Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // =====================================================================
  // Task Progress API Endpoints
  // =====================================================================
  
  // Get a specific task progress by ID (Firebase Auth version)
  app.get('/api/firebase/task-progress/:progressId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { progressId } = req.params;
      
      console.log(`[Task Progress API] GET task progress by ID: ${progressId} for user ${userId}`);
      
      // Get the task progress record by ID
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
        message: "Failed to fetch task progress record"
      });
    }
  });
  
  // Get task progress for a weekly plan (Firebase Auth version)
  app.get('/api/firebase/task-progress/weekly-plan/:weeklyPlanId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weeklyPlanId } = req.params;
      
      console.log(`[Task Progress API] GET task progress by weekly plan: ${weeklyPlanId} for user ${userId}`);
      
      // Fetch the weekly plan first to verify user has access
      const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
      
      if (!weeklyPlan) {
        return res.status(404).json({
          success: false,
          message: "Weekly plan not found"
        });
      }
      
      // Ensure the user owns this weekly plan
      if (weeklyPlan.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this weekly plan"
        });
      }
      
      // Get all task progress records for this weekly plan
      const taskProgressRecords = await storage.getTaskProgressByWeeklyPlan(weeklyPlanId);
      
      console.log(`[Task Progress API] Found ${taskProgressRecords.length} task progress records for weekly plan ${weeklyPlanId}`);
      
      return res.status(200).json({
        success: true,
        taskProgress: taskProgressRecords
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error fetching task progress by weekly plan:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch task progress',
        message: error.message
      });
    }
  });
  
  // Create a task progress record (Firebase Auth version)
  app.post('/api/firebase/task-progress', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weeklyPlanId, weekNumber, dayNumber, taskTitle } = req.body;
      
      // Enhanced debugging logs for task creation
      console.log('[Task Progress API] POST task progress request:', {
        endpoint: '/api/firebase/task-progress',
        method: 'POST',
        userId,
        weeklyPlanId,
        weekNumber,
        dayNumber,
        taskTitle: taskTitle ? (typeof taskTitle === 'string' ? taskTitle.substring(0, 30) + '...' : 'non-string') : 'missing'
      });
      
      // Validate required fields
      if (!weeklyPlanId || !weekNumber || dayNumber === undefined || !taskTitle) {
        console.error('[Task Progress API] Missing required fields:', {
          weeklyPlanId: !!weeklyPlanId,
          weekNumber: !!weekNumber,
          dayNumber: dayNumber !== undefined,
          taskTitle: !!taskTitle
        });
        
        return res.status(400).json({
          success: false,
          message: "Missing required fields: weeklyPlanId, weekNumber, dayNumber, taskTitle are required"
        });
      }
      
      // Validate weekly plan exists before creating progress
      const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
      
      if (!weeklyPlan) {
        console.error('[Task Progress API] Weekly plan not found:', { weeklyPlanId });
        return res.status(404).json({
          success: false,
          message: "Weekly plan not found. Cannot create task progress for non-existent plan."
        });
      }
      
      // Check if a task progress record already exists
      const existingProgress = await storage.getTaskProgressByUserAndTask(
        userId,
        weekNumber,
        dayNumber
      );
      
      if (existingProgress) {
        console.log('[Task Progress API] Existing progress found:', {
          id: existingProgress.id,
          status: existingProgress.status
        });
        
        return res.status(200).json({
          success: true,
          message: "Task progress record already exists",
          taskProgress: existingProgress
        });
      }
      
      // Create a new task progress record
      const taskProgressData = {
        id: uuidv4(),
        userId,
        weeklyPlanId,
        weekNumber,
        dayNumber,
        taskTitle,
        status: 'not-started',
        progressData: null,
        startedAt: null,
        completedAt: null,
      };
      
      const createdTaskProgress = await storage.createTaskProgress(taskProgressData);
      
      console.log('[Task Progress API] Task progress created successfully:', {
        id: createdTaskProgress.id,
        status: createdTaskProgress.status
      });
      
      return res.status(201).json({
        success: true,
        message: "Task progress record created successfully",
        taskProgress: createdTaskProgress
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error creating task progress:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to create task progress record"
      });
    }
  });
  
  // Mark task as in progress (Firebase Auth version)
  app.patch('/api/firebase/task-progress/:id/start', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { progressData } = req.body;
      
      console.log(`[Task Progress API] PATCH start task: ${id} for user ${userId}`);
      
      // Get the task progress record
      const taskProgressRecord = await storage.getTaskProgress(id);
      
      if (!taskProgressRecord) {
        return res.status(404).json({
          success: false,
          message: "Task progress record not found"
        });
      }
      
      // Ensure the user owns this task progress record
      if (taskProgressRecord.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this task progress record"
        });
      }
      
      // Mark the task as in progress
      const updatedTaskProgress = await storage.markTaskAsInProgress(id, progressData);
      
      console.log('[Task Progress API] Task successfully marked as in progress:', {
        id: updatedTaskProgress.id,
        status: updatedTaskProgress.status
      });
      
      return res.status(200).json({
        success: true,
        message: "Task marked as in progress",
        taskProgress: updatedTaskProgress
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error marking task as in progress:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark task as in progress"
      });
    }
  });
  
  // Mark task as completed (Firebase Auth version)
  app.patch('/api/firebase/task-progress/:id/complete', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      console.log(`[Task Progress API] PATCH complete task: ${id} for user ${userId}`);
      
      // Get the task progress record
      const taskProgressRecord = await storage.getTaskProgress(id);
      
      if (!taskProgressRecord) {
        return res.status(404).json({
          success: false,
          message: "Task progress record not found"
        });
      }
      
      // Ensure the user owns this task progress record
      if (taskProgressRecord.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this task progress record"
        });
      }
      
      // Mark the task as completed
      const updatedTaskProgress = await storage.markTaskAsCompleted(id);
      
      return res.status(200).json({
        success: true,
        message: "Task marked as completed",
        taskProgress: updatedTaskProgress
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error marking task as completed:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark task as completed"
      });
    }
  });
  
  // Batch initialize task progress records (Firebase Auth version)
  app.post('/api/firebase/task-progress/batch-initialize', verifyFirebaseAuth, ensureFirebaseUser, batchInitializeTaskProgress);
  
  // Create a task progress record (Firebase Auth version)
  app.get('/api/firebase/task-content/:id', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      console.log(`[Task Content API] Fetching task content for task ID: ${id}`);
      
      // Get the task with all its content
      const taskWithContent = await storage.getTaskWithContent(id);
      
      if (!taskWithContent) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Ensure the user owns this task
      if (taskWithContent.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this task content"
        });
      }
      
      return res.status(200).json({
        success: true,
        taskContent: taskWithContent
      });
    } catch (error: any) {
      console.error('[Task Content API] Error fetching task content:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch task content"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}