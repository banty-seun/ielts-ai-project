import { Request, Response } from 'express';
import { storage } from '../storage';
import { v4 as uuidv4 } from 'uuid';
import { generateListeningScriptForTask } from '../openai';

// Batch initialize task progress records
export const batchInitializeTaskProgress = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const { weeklyPlanId, tasks } = req.body;
    
    console.log(`[Task Progress API] Batch initializing tasks for user ${userId}, plan ${weeklyPlanId}`);
    console.log(`[Task Progress API] Tasks to initialize:`, tasks.length);
    
    // Validate required fields
    if (!weeklyPlanId || !Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: weeklyPlanId and tasks array are required"
      });
    }
    
    // Extract the week number from the first task, assuming all tasks are for the same week
    const weekNumber = tasks[0].weekNumber || 1;
    
    // Format tasks for batch initialization
    const formattedTasks = tasks.map(task => ({
      taskTitle: task.taskTitle,
      dayNumber: task.dayNumber,
      skill: task.skill || 'listening', // Default to 'listening' for all practice tasks
      initialStatus: task.initialStatus || 'not-started'
    }));
    
    // Get weekly plan to check for pre-generated scripts
    const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
    const preGeneratedScripts = (weeklyPlan?.planData as any)?.preGeneratedScripts || [];
    
    // Batch initialize task progress records
    const results = await storage.batchInitializeTaskProgress(
      userId,
      weeklyPlanId,
      weekNumber,
      formattedTasks
    );
    
    // Apply pre-generated scripts to listening tasks
    if (preGeneratedScripts.length > 0) {
      console.log(`[Task Progress API] Applying ${preGeneratedScripts.length} pre-generated scripts to tasks`);
      
      for (const task of results) {
        const matchingScript = preGeneratedScripts.find(
          (script: any) => script.taskTitle === task.taskTitle
        );
        
        if (matchingScript) {
          try {
            await storage.updateTaskContent(task.id, {
              scriptText: matchingScript.scriptText,
              accent: matchingScript.accent,
              scriptType: matchingScript.scriptType,
              difficulty: matchingScript.difficulty,
              duration: matchingScript.duration
            });
            
            await storage.updateTaskStatus(task.id, "script-ready");
            console.log(`[Task Progress API] Applied pre-generated script to "${task.taskTitle}"`);
          } catch (error) {
            console.error(`[Task Progress API] Error applying script to "${task.taskTitle}":`, error);
          }
        }
      }
    }
    
    console.log(`[Task Progress API] Successfully initialized ${results.length} task progress records`);
    
    return res.status(200).json({
      success: true,
      message: `Successfully initialized ${results.length} task progress records`,
      results
    });
  } catch (error: any) {
    console.error('[Task Progress API] Error in batch initialize:', error);
    return res.status(500).json({
      success: false,
      message: "Failed to initialize task progress records",
      error: error.message
    });
  }
};

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

// Create a new task progress record
export const createTaskProgress = async (req: any, res: Response) => {
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
      message: "Failed to create task progress record",
      error: error.message
    });
  }
};

// Start a task (mark as in-progress)
export const startTask = async (req: any, res: Response) => {
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
    
    // Check if this is a listening task that needs script generation
    const isListeningTask = taskProgressRecord.taskTitle.toLowerCase().includes('listening') || 
                            taskProgressRecord.taskTitle.toLowerCase().includes('audio') ||
                            taskProgressRecord.taskTitle.toLowerCase().includes('conversation');
    
    // Fallback trigger: Generate script if missing for listening tasks
    if (isListeningTask && (!taskProgressRecord.scriptText || taskProgressRecord.scriptText.trim().length === 0)) {
      console.log(`[Task Progress API] Listening task missing script, triggering fallback generation for "${taskProgressRecord.taskTitle}"`);
      
      try {
        // Get user's skill level and target from study plan
        const studyPlans = await storage.getStudyPlansByUserId(userId);
        const latestPlan = studyPlans[0];
        
        if (latestPlan) {
          const skillRatings = latestPlan.skillRatings as Record<string, number>;
          const userLevel = skillRatings?.listening || 1;
          const targetBand = parseFloat(latestPlan.targetBandScore) || 7;
          
          // Generate script using fallback trigger
          const scriptResult = await generateListeningScriptForTask(taskProgressRecord, userLevel, targetBand);
          
          if (scriptResult.success) {
            // Update task with generated script
            await storage.updateTaskContent(id, {
              scriptText: scriptResult.scriptText!,
              accent: scriptResult.accent!,
              scriptType: scriptResult.scriptType!,
              difficulty: scriptResult.difficulty!,
              duration: scriptResult.estimatedDuration!
            });
            
            console.log(`[Task Progress API] Fallback script generated successfully for "${taskProgressRecord.taskTitle}"`);
          } else {
            console.error(`[Task Progress API] Fallback script generation failed for "${taskProgressRecord.taskTitle}":`, scriptResult.error);
          }
        }
      } catch (scriptError) {
        console.error(`[Task Progress API] Error in fallback script generation:`, scriptError);
        // Continue with task start even if script generation fails
      }
    }
    
    // Mark the task as in progress
    const updatedTaskProgress = await storage.markTaskAsInProgress(id, progressData);
    
    console.log('[Task Progress API] Task successfully marked as in progress:', {
      id: updatedTaskProgress.id,
      status: updatedTaskProgress.status,
      hasScript: !!updatedTaskProgress.scriptText
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
      message: "Failed to mark task as in progress",
      error: error.message
    });
  }
};

// Complete a task
export const completeTask = async (req: any, res: Response) => {
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
      message: "Failed to mark task as completed",
      error: error.message
    });
  }
};