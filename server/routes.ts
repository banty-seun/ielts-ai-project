import express, { type Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { verifyFirebaseAuth, ensureFirebaseUser } from "./firebaseAuth";
import { batchInitializeTaskProgress } from "./controllers/taskProgressController";
import { getTaskProgressById } from "./controllers/getTaskProgressController";
import { v4 as uuidv4 } from 'uuid';
import { generateIELTSPlan, generateIELTSPlan_debugWrapper, generateListeningScriptForTask, generateQuestionsFromScript } from "./openai";
import { generateAudioFromScript, checkAudioExists } from "./audioService";
import { registerRegenerateRoutes } from "./routes/regenerate";

/**
 * Helper function to pre-generate scripts for listening tasks
 * Called during plan creation to ensure scripts are ready when users start tasks
 */
async function preGenerateScriptsForListeningTasks(
  userId: string, 
  weeklyPlanId: string, 
  weekNumber: number, 
  listeningTasks: any[], 
  userLevel: number, 
  targetBand: number
) {
  console.log(`[Script Pre-Generation] Starting script generation for ${listeningTasks.length} listening tasks`);
  
  const scriptGenerationPromises = listeningTasks.map(async (task, index) => {
    try {
      // Create a minimal task object for script generation
      const taskForScript = {
        taskTitle: task.title,
        weekNumber: weekNumber,
        accent: task.accent || "British",
        progressData: { description: task.description }
      };

      // Generate the script
      const scriptResult = await generateListeningScriptForTask(taskForScript as any, userLevel, targetBand);
      
      if (scriptResult.success) {
        console.log(`[Script Pre-Generation] Generated script for "${task.title}": ${scriptResult.scriptText?.split(' ').length} words`);
        return {
          taskTitle: task.title,
          scriptText: scriptResult.scriptText,
          accent: scriptResult.accent,
          scriptType: scriptResult.scriptType,
          difficulty: scriptResult.difficulty,
          duration: scriptResult.estimatedDuration
        };
      } else {
        console.error(`[Script Pre-Generation] Failed to generate script for "${task.title}":`, scriptResult.error);
        return null;
      }
    } catch (error) {
      console.error(`[Script Pre-Generation] Error generating script for "${task.title}":`, error);
      return null;
    }
  });

  // Wait for all script generations to complete
  const scriptResults = await Promise.allSettled(scriptGenerationPromises);
  const successfulScripts = scriptResults
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => (result as PromiseFulfilledResult<any>).value);

  console.log(`[Script Pre-Generation] Successfully generated ${successfulScripts.length}/${listeningTasks.length} scripts`);
  return successfulScripts;
}
import { onboardingSchema } from "@shared/schema";

export async function registerRoutes(app: express.Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // =====================================================================
  // Task Progress API Endpoints
  // =====================================================================
  
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
  
  // Generate listening script for a specific task (Firebase Auth version)
  app.post('/api/task/:taskId/generate-script', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskId } = req.params;
      
      console.log(`[Script Generation API] Request to generate script for task ${taskId} by user ${userId}`);
      
      // Get the task from database
      const task = await storage.getTaskProgress(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Verify task belongs to the authenticated user
      if (task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied - task does not belong to user"
        });
      }
      
      // Check if script already exists to prevent duplicate generation
      if (task.scriptText && task.scriptText.trim().length > 0) {
        return res.status(400).json({
          success: false,
          message: "Script already exists for this task",
          data: {
            hasScript: true,
            scriptLength: task.scriptText.length,
            accent: task.accent,
            duration: task.duration
          }
        });
      }
      
      // Get user's onboarding data to determine skill level and target
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Get study plan to extract skill ratings and target band
      const studyPlans = await storage.getStudyPlansByUserId(userId);
      const latestPlan = studyPlans[0]; // Assume most recent plan
      
      if (!latestPlan) {
        return res.status(400).json({
          success: false,
          message: "No study plan found - onboarding required"
        });
      }
      
      const skillRatings = latestPlan.skillRatings as Record<string, number>;
      const userLevel = skillRatings?.listening || 1; // Default to 1 if not found
      const targetBand = parseFloat(latestPlan.targetBandScore) || 7; // Default to 7 if not found
      
      console.log(`[Script Generation API] User skill level: ${userLevel}, Target band: ${targetBand}`);
      
      // Generate the script using OpenAI
      const scriptResult = await generateListeningScriptForTask(task, userLevel, targetBand);
      
      if (!scriptResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to generate script",
          error: scriptResult.error
        });
      }
      
      // Import title builder
      const { makeListeningTaskTitle, needsTitleUpdate } = require('./services/title');
      
      // Generate dynamic title if needed
      let updatedTitle = task.taskTitle;
      if (needsTitleUpdate(task.taskTitle) && scriptResult.contextLabel) {
        updatedTitle = makeListeningTaskTitle({
          scriptType: scriptResult.scriptType,
          contextLabel: scriptResult.contextLabel,
          topicDomain: scriptResult.topicDomain,
          scenarioOverview: scriptResult.scenarioOverview
        });
        console.log(`[Script Generation API] Updated title from "${task.taskTitle}" to "${updatedTitle}"`);
      }
      
      // Update the task with generated content and metadata (no taskTitle in updateTaskContent)
      const updateData = {
        scriptText: scriptResult.scriptText!,
        accent: scriptResult.accent!,
        scriptType: scriptResult.scriptType!,
        difficulty: scriptResult.difficulty!,
        duration: scriptResult.estimatedDurationSec || 180,
        ieltsPart: scriptResult.ieltsPart,
        topicDomain: scriptResult.topicDomain,
        contextLabel: scriptResult.contextLabel,
        scenarioOverview: scriptResult.scenarioOverview,
        estimatedDurationSec: scriptResult.estimatedDurationSec
      };
      
      const updatedTask = await storage.updateTaskContent(taskId, updateData);
      
      // Note: Task title is updated in the task progress table via updateTaskContent
      // The title is part of the task progress record, not the weekly plan
      
      // Update task status to indicate script is generated
      await storage.updateTaskStatus(taskId, "script-generated");
      
      console.log(`[Script Generation API] Successfully generated script for task ${taskId}`);
      
      res.json({
        success: true,
        message: "Script generated successfully",
        data: {
          taskId: taskId,
          scriptText: scriptResult.scriptText,
          accent: scriptResult.accent,
          scriptType: scriptResult.scriptType,
          difficulty: scriptResult.difficulty,
          estimatedDuration: scriptResult.estimatedDurationSec,
          wordCount: scriptResult.scriptText!.split(/\s+/).length,
          status: "script-generated"
        }
      });
      
    } catch (error) {
      console.error('[Script Generation API] Error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error during script generation",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Generate audio from script for a specific task (Firebase Auth version)
  app.post('/api/task/:taskId/generate-audio', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskId } = req.params;
      
      console.log(`[Audio Generation API] Request to generate audio for task ${taskId} by user ${userId}`);
      
      // Get the task from database
      const task = await storage.getTaskProgress(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Verify task belongs to the authenticated user
      if (task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied - task does not belong to user"
        });
      }
      
      // INVESTIGATION: Comprehensive script text validation for silent audio debugging
      console.log(`[AUDIO INVESTIGATION] Script text analysis for task ${taskId}:`, {
        hasScriptText: !!task.scriptText,
        scriptTextType: typeof task.scriptText,
        scriptTextLength: task.scriptText ? task.scriptText.length : 0,
        scriptTextTrimmedLength: task.scriptText ? task.scriptText.trim().length : 0,
        scriptTextWordCount: task.scriptText ? task.scriptText.trim().split(/\s+/).length : 0,
        scriptTextPreview: task.scriptText ? task.scriptText.substring(0, 150) + (task.scriptText.length > 150 ? '...' : '') : 'NO SCRIPT',
        isEmptyOrWhitespace: !task.scriptText || task.scriptText.trim().length === 0
      });
      
      // Check if task has script text
      if (!task.scriptText || task.scriptText.trim().length === 0) {
        console.error(`[AUDIO INVESTIGATION] ❌ No valid script text found for task ${taskId}`);
        return res.status(400).json({
          success: false,
          message: "No script available for audio generation. Generate script first."
        });
      }
      
      // Additional validation for meaningful content
      const trimmedScript = task.scriptText.trim();
      if (trimmedScript.length < 10) {
        console.warn(`[AUDIO INVESTIGATION] ⚠️  Script text is very short (${trimmedScript.length} chars): "${trimmedScript}"`);
      }
      
      // Check if audio already exists to prevent duplicate generation
      if (task.audioUrl && task.audioUrl.trim().length > 0) {
        console.log(`[AUDIO INVESTIGATION] Checking if audio already exists: ${task.audioUrl}`);
        const audioExists = await checkAudioExists(task.audioUrl);
        if (audioExists) {
          return res.status(409).json({
            success: false,
            message: "Audio already exists for this task",
            data: {
              hasAudio: true,
              audioUrl: task.audioUrl,
              duration: task.duration,
              accent: task.accent
            }
          });
        }
      }
      
      // Use accent from task or default to British
      const accent = task.accent || "British";
      
      console.log(`[Audio Generation API] Generating audio with accent: ${accent}`);
      console.log(`[AUDIO INVESTIGATION] Final script to be synthesized (${trimmedScript.length} chars):`, 
        JSON.stringify(trimmedScript));
      
      // Generate audio using AWS Polly
      const audioResult = await generateAudioFromScript(
        task.scriptText,
        accent,
        userId,
        taskId,
        task.weekNumber
      );
      
      if (!audioResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to generate audio",
          error: audioResult.error
        });
      }
      
      // Update the task with generated audio URL and duration
      const updateData = {
        audioUrl: audioResult.audioUrl!,
        duration: audioResult.duration!,
        accent: accent // Ensure accent is saved
      };
      
      await storage.updateTaskContent(taskId, updateData);
      
      // Update task status to indicate audio is ready
      await storage.updateTaskStatus(taskId, "audio-ready");
      
      console.log(`[Audio Generation API] Successfully generated audio for task ${taskId}`);
      
      res.json({
        success: true,
        message: "Audio generated successfully",
        data: {
          taskId: taskId,
          audioUrl: audioResult.audioUrl,
          duration: audioResult.duration,
          accent: accent,
          scriptLength: task.scriptText.length,
          status: "audio-ready"
        }
      });
      
    } catch (error) {
      console.error('[Audio Generation API] Error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error during audio generation",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // =====================================================================
  // Plan Generation Endpoints
  // =====================================================================
  
  // Generate IELTS study plan based on onboarding data (Firebase Auth version)
  app.post('/api/plan/generate', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const payload = req.body;
      
      // Use the database user ID from the ensureFirebaseUser middleware
      const user = req.user;
      // Always use the database ID, not Firebase UID for database operations
      const userId = user.id;
      const firebaseUid = req.firebaseUser.uid;
      
      // Log the payload and user information to the server console
      console.log(`[Plan API] Received onboarding data for plan generation for user: ${userId} (Firebase UID: ${firebaseUid})`);
      console.log('[Plan API] Onboarding payload summary:', {
        firstName: payload.firstName,
        targetBandScore: payload.targetBandScore,
        testDate: payload.testDate
      });
      
      // Preprocess the date format if it's a string
      if (payload.testDate && typeof payload.testDate === 'string') {
        try {
          payload.testDate = new Date(payload.testDate);
          console.log('[Plan API] Converted testDate from string to Date:', payload.testDate);
        } catch (e) {
          console.error('[Plan API] Error parsing test date:', e);
          payload.testDate = null;
        }
      }
      
      // Validate request data with detailed error reporting
      const validation = onboardingSchema.safeParse(payload);
      
      if (!validation.success) {
        const formattedErrors = validation.error.flatten();
        console.error('[Plan API] Onboarding validation failed:', {
          fieldErrors: formattedErrors.fieldErrors,
          formErrors: formattedErrors.formErrors
        });
        return res.status(400).json({ 
          success: false, 
          message: "Invalid onboarding data", 
          errors: formattedErrors
        });
      }
      
      const onboardingData = validation.data;
      
      // Update onboarding status in database
      await storage.updateOnboardingStatus(userId, true);
      
      try {
        // Check debug mode flag
        if (process.env.ENABLE_PLAN_DEBUG === "1") {
          console.log('[Plan API] Debug mode enabled - calling debug wrapper...');
          const report = await generateIELTSPlan_debugWrapper(onboardingData);
          console.log('[PlanGen][REPORT]', report); // server-side visibility
          return res.status(200).json({
            success: true,
            message: "Debug diagnostics completed",
            debug: report,
          });
        }

        // Normal behavior (non-debug)
        console.log('[Plan API] Calling OpenAI to generate IELTS plan...');
        const plan = await generateIELTSPlan(onboardingData);
        
        // Save the main study plan to database
        const studyPlanId = uuidv4();
        const studyPlanData = {
          id: studyPlanId,
          userId: userId,
          fullName: onboardingData.fullName,
          phoneNumber: onboardingData.phoneNumber || '',
          targetBandScore: onboardingData.targetBandScore.toString(),
          testDate: onboardingData.testDate,
          notDecided: onboardingData.notDecided ? 'true' : 'false',
          skillRatings: onboardingData.skillRatings,
          immigrationGoal: onboardingData.immigrationGoal,
          studyPreferences: onboardingData.studyPreferences,
          plan: plan
        };
        
        console.log('[Plan API] Saving main study plan to database...');
        await storage.createStudyPlan(studyPlanData);
        
        // Extract and save weekly plans if they exist
        if (plan.weeklyPlans && Array.isArray(plan.weeklyPlans)) {
          console.log('[Plan API] Processing weekly plans for persistence...');
          
          for (const weeklyPlan of plan.weeklyPlans) {
            const weekNumber = weeklyPlan.week;
            
            // Group activities by skill for each week
            const skillActivities: {
              listening: any[];
              reading: any[];
              writing: any[];
              speaking: any[];
              [key: string]: any[];
            } = {
              listening: [],
              reading: [],
              writing: [],
              speaking: []
            };
            
            // Process daily activities
            if (weeklyPlan.days && Array.isArray(weeklyPlan.days)) {
              for (const day of weeklyPlan.days) {
                if (day.activities && Array.isArray(day.activities)) {
                  for (const activity of day.activities) {
                    const skill = activity.skill?.toLowerCase();
                    if (skill && skill in skillActivities) {
                      // Map day number to day name
                      const dayName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][day.day - 1] || `Day ${day.day}`;
                      
                      skillActivities[skill].push({
                        title: activity.title,
                        day: dayName,
                        duration: activity.duration || '30 min',
                        status: 'not-started',
                        skill: skill,
                        accent: 'British', // Default accent
                        description: activity.description,
                        contextType: 'general',
                        resources: activity.resources
                      });
                    }
                  }
                }
              }
            }
            
            // Save a weekly plan for each skill that has activities
            for (const [skillFocus, activities] of Object.entries(skillActivities)) {
              if (activities.length > 0) {
                const weekFocus = weeklyPlan.goals?.join(', ') || `Week ${weekNumber} focus`;
                const planData = {
                  weekFocus: weekFocus,
                  plan: activities,
                  progressMetrics: weeklyPlan.progressMetrics || []
                };
                
                console.log(`[Plan API] Saving weekly plan: Week ${weekNumber} - ${skillFocus}`);
                const createdWeeklyPlan = await storage.createOrUpdateWeeklyStudyPlan(userId, weekNumber, skillFocus, weekFocus, planData);
                
                // Pre-generate scripts for listening tasks
                if (skillFocus === 'listening' && activities.length > 0) {
                  const userLevel = onboardingData.skillRatings.listening || 1;
                  const targetBand = onboardingData.targetBandScore || 7;
                  
                  console.log(`[Plan API] Pre-generating scripts for ${activities.length} listening tasks`);
                  const generatedScripts = await preGenerateScriptsForListeningTasks(
                    userId, 
                    createdWeeklyPlan.id, 
                    weekNumber, 
                    activities, 
                    userLevel, 
                    targetBand
                  );
                  
                  // Store the generated scripts in the plan data for later use during task initialization
                  if (generatedScripts.length > 0) {
                    const updatedPlanData = {
                      ...planData,
                      preGeneratedScripts: generatedScripts
                    };
                    
                    // Update the weekly plan with pre-generated scripts
                    await storage.createOrUpdateWeeklyStudyPlan(userId, weekNumber, skillFocus, weekFocus, updatedPlanData);
                    console.log(`[Plan API] Stored ${generatedScripts.length} pre-generated scripts in weekly plan`);
                  }
                }
              }
            }
          }
        }
        
        console.log('[Plan API] Study plan and weekly plans saved successfully');
        
        // Return success with plan ID
        return res.status(200).json({
          success: true,
          planId: studyPlanId,
          message: "Study plan generated and saved successfully",
          plan
        });
      } catch (aiError: any) {
        console.error('[Plan API] Error generating IELTS plan with OpenAI:', aiError);
        return res.status(500).json({
          success: false,
          message: "Failed to generate IELTS plan",
          error: typeof aiError === 'object' ? aiError.message || "Unknown OpenAI error" : String(aiError)
        });
      }
    } catch (error: any) {
      console.error('[Plan API] Error in plan generation endpoint:', error);
      return res.status(500).json({
        success: false,
        message: "Server error while processing plan generation",
        error: error.message
      });
    }
  });
  
  // Get weekly study plan by week number (Firebase Auth version)
  app.get('/api/plan/weekly/:weekNumber', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weekNumber } = req.params;
      const weekNum = parseInt(weekNumber);
      
      if (isNaN(weekNum) || weekNum < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid week number. Must be a positive integer."
        });
      }
      
      console.log(`[Weekly Plan API] GET weekly plans for user ${userId}, week ${weekNum}`);
      
      // Fetch all weekly plans for this user and week
      const weeklyPlans = await storage.getWeeklyStudyPlansByWeek(userId, weekNum);
      
      if (weeklyPlans.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No study plans found for week ${weekNum}`,
          week: weekNum,
          skills: {}
        });
      }
      
      // Group plans by skill
      const skillsData: { [key: string]: any } = {};
      for (const plan of weeklyPlans) {
        skillsData[plan.skillFocus] = {
          id: plan.id,
          weekNumber: plan.weekNumber,
          skillFocus: plan.skillFocus,
          weekFocus: plan.weekFocus,
          planData: plan.planData,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt
        };
      }
      
      console.log(`[Weekly Plan API] Found ${weeklyPlans.length} plans for week ${weekNum}`);
      
      return res.status(200).json({
        success: true,
        week: weekNum,
        skills: skillsData
      });
    } catch (error: any) {
      console.error('[Weekly Plan API] Error fetching weekly plans:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch weekly plans",
        error: error.message
      });
    }
  });

  // Get user onboarding data (Firebase Auth version)
  app.get('/api/user/onboarding', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      console.log(`[User Onboarding API] GET onboarding data for user ${userId}`);
      
      // Get the most recent study plan for this user
      const studyPlans = await storage.getStudyPlansByUserId(userId);
      
      if (studyPlans.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No onboarding data found. Please complete onboarding first."
        });
      }
      
      // Get the most recent study plan
      const latestPlan = studyPlans[0]; // Assuming getStudyPlansByUserId returns in descending order
      
      console.log(`[User Onboarding API] Found onboarding data for user ${userId}`);
      
      return res.status(200).json({
        success: true,
        data: {
          fullName: latestPlan.fullName,
          phoneNumber: latestPlan.phoneNumber,
          targetBandScore: parseFloat(latestPlan.targetBandScore),
          testDate: latestPlan.testDate,
          notDecided: latestPlan.notDecided === 'true',
          skillRatings: latestPlan.skillRatings,
          immigrationGoal: latestPlan.immigrationGoal,
          studyPreferences: latestPlan.studyPreferences,
          createdAt: latestPlan.createdAt,
          updatedAt: latestPlan.updatedAt
        }
      });
    } catch (error: any) {
      console.error('[User Onboarding API] Error fetching onboarding data:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch onboarding data",
        error: error.message
      });
    }
  });

  // Get a specific task progress by ID (Firebase Auth version)
  app.get('/api/firebase/task-progress/:progressId', verifyFirebaseAuth, ensureFirebaseUser, getTaskProgressById);
  
  // Get onboarding status (Firebase Auth version)
  app.get('/api/firebase/auth/onboarding-status', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      console.log(`[Onboarding API] GET onboarding status for user ${userId}`);
      
      // Get the user from the database
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Return the onboarding status
      return res.status(200).json({
        success: true,
        onboardingCompleted: user.onboardingCompleted || false,
        userId: user.id,
        firebaseUid: user.firebaseUid,
        source: 'database'
      });
    } catch (error: any) {
      console.error('[Onboarding API] Error fetching onboarding status:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch onboarding status",
        error: error.message
      });
    }
  });
  
  // Complete onboarding (Firebase Auth version)
  app.post('/api/firebase/auth/complete-onboarding', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      console.log(`[Onboarding API] POST complete onboarding for user ${userId}`);
      
      // Update the user's onboarding status
      const updatedUser = await storage.updateOnboardingStatus(userId, true);
      
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Return success
      return res.status(200).json({
        success: true,
        message: "Onboarding marked complete",
        userId: updatedUser.id
      });
    } catch (error: any) {
      console.error('[Onboarding API] Error completing onboarding:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to complete onboarding",
        error: error.message
      });
    }
  });
  
  // Get task content (Firebase Auth version)
  app.get('/api/firebase/task-content/:id', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      // 4) Server route tracing
      console.log('[Task Content API] hit', { taskId: id, uid: userId });
      console.log(`[Task Content API] HIT for taskId: ${id}`);
      console.log(`[Task Content API] Fetching task content for task ID: ${id}`);
      
      // Get the task with all its content
      const taskWithContent = await storage.getTaskWithContent(id);
      
      // 4) Log found task status
      console.log('[Task Content API] found task?', !!taskWithContent, 'status', taskWithContent?.status, { 
        hasScript: !!taskWithContent?.scriptText, 
        hasAudio: !!taskWithContent?.audioUrl 
      });
      
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
      
      // STEP 1: Auto-generate script if missing (for listening tasks only)
      if (!taskWithContent.scriptText && taskWithContent.taskTitle && 
          taskWithContent.skill && taskWithContent.skill.toLowerCase() === 'listening') {
        
        console.log(`[Pipeline Stage 1] Starting script generation for listening task ${id}`);
        
        try {
          // Generate script using OpenAI
          const scriptResult = await generateListeningScriptForTask(
            taskWithContent,
            5, // Default user level if not available
            7.0 // Default target band if not available
          );
          
          if (scriptResult && scriptResult.success && scriptResult.scriptText && scriptResult.scriptText.trim().length > 0) {
            // Import title builder
            const { makeListeningTaskTitle, needsTitleUpdate } = require('./services/title');
            
            // Generate dynamic title if needed
            let updatedTitle = taskWithContent.taskTitle;
            if (needsTitleUpdate(taskWithContent.taskTitle) && scriptResult.contextLabel) {
              updatedTitle = makeListeningTaskTitle({
                scriptType: scriptResult.scriptType,
                contextLabel: scriptResult.contextLabel,
                topicDomain: scriptResult.topicDomain,
                scenarioOverview: scriptResult.scenarioOverview
              });
              console.log(`[Pipeline Stage 1] Updated title from "${taskWithContent.taskTitle}" to "${updatedTitle}"`);
            }
            
            // Update task with generated script and metadata
            await storage.updateTaskContent(id, {
              scriptText: scriptResult.scriptText,
              scriptType: scriptResult.scriptType || 'dialogue',
              difficulty: scriptResult.difficulty || 'intermediate',
              accent: scriptResult.accent,
              ieltsPart: scriptResult.ieltsPart,
              topicDomain: scriptResult.topicDomain,
              contextLabel: scriptResult.contextLabel,
              scenarioOverview: scriptResult.scenarioOverview,
              estimatedDurationSec: scriptResult.estimatedDurationSec
            });
            
            // Update the task object with new metadata (but not scriptText for API response)
            taskWithContent.taskTitle = updatedTitle;
            taskWithContent.scriptType = scriptResult.scriptType || 'dialogue';
            taskWithContent.difficulty = scriptResult.difficulty || 'intermediate';
            taskWithContent.accent = scriptResult.accent || null;
            taskWithContent.ieltsPart = scriptResult.ieltsPart || null;
            taskWithContent.topicDomain = scriptResult.topicDomain || null;
            taskWithContent.contextLabel = scriptResult.contextLabel || null;
            taskWithContent.scenarioOverview = scriptResult.scenarioOverview || null;
            taskWithContent.estimatedDurationSec = scriptResult.estimatedDurationSec || null;
            
            console.log(`[Pipeline Stage 1] ✅ Script generation completed for task ${id} (${scriptResult.scriptText.length} chars)`);
          } else {
            console.error(`[Pipeline Stage 1] ❌ Script generation failed for task ${id}: ${scriptResult?.error || 'Unknown error'}`);
          }
        } catch (scriptError) {
          console.error(`[Pipeline Stage 1] ❌ Script generation error for task ${id}:`, scriptError);
        }
      } else if (taskWithContent.scriptText) {
        console.log(`[Pipeline Stage 1] ✅ Script already exists for task ${id} (${taskWithContent.scriptText.length} chars)`);
      }

      // STEP 2: Auto-generate questions if missing (when scriptText exists and skill is listening)
      if (taskWithContent.scriptText && taskWithContent.skill && 
          taskWithContent.skill.toLowerCase() === 'listening' && !taskWithContent.questions) {
        
        console.log(`[Pipeline Stage 2] Starting question generation for task ${id}`);
        
        try {
          const questionResult = await generateQuestionsFromScript(
            taskWithContent.scriptText,
            taskWithContent.taskTitle || "IELTS Listening Practice",
            taskWithContent.difficulty || "intermediate"
          );
          
          if (questionResult.success && questionResult.questions && questionResult.questions.length > 0) {
            // Update task with generated questions
            await storage.updateTaskContent(id, {
              questions: questionResult.questions
            });
            
            // Update the task object to return the new questions
            taskWithContent.questions = questionResult.questions;
            
            console.log(`[Pipeline Stage 2] ✅ Question generation completed for task ${id} (${questionResult.questions.length} questions)`);
          } else {
            console.warn(`[Pipeline Stage 2] ❌ Question generation failed for task ${id}: ${questionResult.error}`);
            // Set empty array as fallback instead of null
            taskWithContent.questions = [];
          }
        } catch (questionError) {
          console.error(`[Pipeline Stage 2] ❌ Question generation error for task ${id}:`, questionError);
          // Set empty array as fallback instead of null
          taskWithContent.questions = [];
        }
      } else if (taskWithContent.questions) {
        console.log(`[Pipeline Stage 2] ✅ Questions already exist for task ${id} (${Array.isArray(taskWithContent.questions) ? taskWithContent.questions.length : 'unknown'} questions)`);
      }

      // STEP 3: Auto-generate audio if missing (when scriptText exists and skill is listening)
      if (taskWithContent.scriptText && taskWithContent.skill && 
          taskWithContent.skill.toLowerCase() === 'listening' && !taskWithContent.audioUrl) {
        
        console.log(`[Pipeline Stage 3] Starting audio generation for task ${id}`);
        
        try {
          const accent = taskWithContent.accent || "British";
          const audioResult = await generateAudioFromScript(
            taskWithContent.scriptText,
            accent,
            userId,
            id,
            taskWithContent.weekNumber
          );
          
          if (audioResult.success && audioResult.audioUrl && audioResult.duration) {
            // Update task with audio URL and duration
            await storage.updateTaskContent(id, {
              audioUrl: audioResult.audioUrl,
              duration: audioResult.duration,
              accent: accent
            });
            
            // Update the task object to return the new audio info
            taskWithContent.audioUrl = audioResult.audioUrl;
            taskWithContent.duration = audioResult.duration;
            taskWithContent.accent = accent;
            
            console.log(`[Pipeline Stage 3] ✅ Audio generation completed for task ${id} (${audioResult.duration}s)`);
          } else {
            console.warn(`[Pipeline Stage 3] ❌ Audio generation failed for task ${id}: ${audioResult.error}`);
          }
        } catch (audioError) {
          console.error(`[Pipeline Stage 3] ❌ Audio generation error for task ${id}:`, audioError);
        }
      } else if (taskWithContent.audioUrl) {
        console.log(`[Pipeline Stage 3] ✅ Audio already exists for task ${id} (${taskWithContent.duration || 'unknown'}s)`);
      }
      
      // Optional: Normalize questions for client compatibility
      const normalizeQuestionsForClient = (qs: any): any[] => {
        return (Array.isArray(qs) ? qs : []).map((q: any, i: number) => {
          const id = String(q?.id ?? `q${i + 1}`);
          const text = typeof q?.text === 'string' ? q.text : (q?.question ?? '');
          const type = q?.type ?? 'multiple-choice';
          const options = Array.isArray(q?.options)
            ? q.options.map((o: any, oi: number) => ({
                id: String(o?.id ?? `o${oi + 1}`),
                label: String(o?.label ?? o?.text ?? ''),
              }))
            : undefined;

          return {
            ...q,
            id,
            text, // Add text field for UI compatibility 
            type,
            options,
          };
        });
      };

      // Apply normalization if questions exist
      if (taskWithContent.questions) {
        taskWithContent.questions = normalizeQuestionsForClient(taskWithContent.questions);
      }

      // Remove scriptText from API response (keep it in DB but don't expose to client)
      if (taskWithContent.scriptText !== undefined) {
        taskWithContent.scriptText = undefined;
      }
      
      // Log final payload keys before response
      console.log(`[Task Content API] Final response payload keys for ${id}:`, {
        hasTaskContent: !!taskWithContent,
        hasScriptText: false, // Explicitly removed from response
        hasAudioUrl: !!taskWithContent.audioUrl,
        questionsCount: Array.isArray(taskWithContent.questions) ? taskWithContent.questions.length : 0,
        taskTitle: taskWithContent.taskTitle,
        ieltsPart: taskWithContent.ieltsPart,
        contextLabel: taskWithContent.contextLabel,
        topicDomain: taskWithContent.topicDomain
      });
      
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
  
  // Get all weekly plans for a specific week (Firebase Auth version)
  app.get('/api/firebase/weekly-plans/week/:weekNumber', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const weekNumber = parseInt(req.params.weekNumber, 10);
      
      console.log(`[Weekly Plans API] GET weekly plans for week ${weekNumber} for user ${userId}`);
      
      // Validate week number
      if (isNaN(weekNumber) || weekNumber < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid week number. Week number must be a positive integer."
        });
      }
      
      // Get all weekly plans for this week
      const plans = await storage.getWeeklyStudyPlansByWeek(userId, weekNumber);
      
      console.log(`[Weekly Plans API] Found ${plans.length} weekly plans for week ${weekNumber}`);
      
      return res.status(200).json({
        success: true,
        plans,
        weekNumber
      });
    } catch (error: any) {
      console.error(`[Weekly Plans API] Error fetching weekly plans for week:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch weekly plans",
        error: error.message
      });
    }
  });

  // POST task attempt submission for AI Coach analytics
  app.post('/api/firebase/task-progress/:id/attempt', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { startedAt, submittedAt, durationMs, answers } = req.body ?? {};
      if (!startedAt || !submittedAt || typeof durationMs !== 'number' || !Array.isArray(answers)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid attempt payload. Required fields: startedAt, submittedAt, durationMs, answers' 
        });
      }

      // Load task content for correctness calculation with ownership validation
      const task = await storage.getTaskProgressById(id, userId);
      if (!task) {
        return res.status(404).json({ 
          success: false, 
          message: 'Task not found or access denied' 
        });
      }

      console.log(`[Task Attempt API] Processing attempt submission for task ${id}`, {
        userId,
        answersCount: answers.length,
        durationMs
      });

      // Normalize server questions to calculate correctness
      const LETTERS = ['A', 'B', 'C', 'D'];
      const normalizedQs = (Array.isArray(task.questions) ? task.questions : []).map((q: any, qi: number) => {
        const options = Array.isArray(q.options)
          ? q.options.map((opt: any, oi: number) =>
              typeof opt === 'string' 
                ? { id: `option${oi+1}`, text: opt } 
                : { id: opt?.id ?? `option${oi+1}`, text: opt?.text ?? '' }
            )
          : [];
        
        const letter = (q?.correctAnswer ?? '').toString().trim().toUpperCase();
        const idx = LETTERS.indexOf(letter);
        const correctOptionId = idx >= 0 && options[idx] ? options[idx].id : null;

        return {
          id: q?.id ?? `q${qi+1}`,
          text: q?.text ?? q?.question ?? '',
          options,
          correctOptionId,
          explanation: q?.explanation ?? '',
        };
      });

      const byId = new Map(normalizedQs.map(q => [q.id, q]));

      // Add type for attempt answer details
      type AttemptAnswerDetail = {
        questionId: string;
        isCorrect: boolean;
        pickedOptionId: string | null;
        pickedOptionText: string | null;
        correctOptionId: string;
        correctOptionText: string;
        explanation?: string;
      };

      // Calculate detailed results per question with resolved option text
      const detailed: AttemptAnswerDetail[] = answers.map((a: any) => {
        const q = byId.get(a.questionId);
        const correctOptionId = q?.correctOptionId ?? '';
        const pickedOptionId = a?.pickedOptionId ?? null;
        
        // Find the actual option objects to get their text
        const pickedOption = pickedOptionId ? q?.options?.find((opt: any) => opt.id === pickedOptionId) : null;
        const correctOption = correctOptionId ? q?.options?.find((opt: any) => opt.id === correctOptionId) : null;
        
        const isCorrect = !!(pickedOptionId && correctOptionId && pickedOptionId === correctOptionId);
        
        return {
          questionId: String(a.questionId),
          isCorrect,
          pickedOptionId,
          pickedOptionText: pickedOption?.text ?? null,
          correctOptionId,
          correctOptionText: correctOption?.text ?? '',
          explanation: q?.explanation ?? undefined,
        };
      });

      const correct = detailed.filter(d => d.isCorrect).length;
      const total = detailed.length;
      const percent = total ? Math.round((correct / total) * 100) : 0;

      const attempt = {
        id: crypto.randomUUID(),
        taskProgressId: id,
        userId,
        startedAt,
        submittedAt,
        durationMs,
        answers: detailed.map(d => ({
          questionId: d.questionId,
          pickedOptionId: d.pickedOptionId,
          correctOptionId: d.correctOptionId,
          isCorrect: d.isCorrect,
        })), // Keep simpler structure for database storage
        score: { correct, total, percent },
      };

      // Persist attempt to database
      await storage.insertTaskAttempt(attempt);

      console.log(`[Task Attempt API] Successfully saved attempt ${attempt.id}`, {
        score: attempt.score,
        detailedCount: detailed.length
      });

      return res.json({
        success: true,
        attemptId: attempt.id,
        score: attempt.score,
        detailed
      });

    } catch (err: any) {
      console.error('[POST /task-progress/:id/attempt] error', err);
      return res.status(500).json({ 
        success: false, 
        message: err?.message ?? 'Server error processing attempt submission' 
      });
    }
  });

  // Register regenerate routes for SSE-S3 audio fixing
  registerRegenerateRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}