import { v4 as uuidv4 } from 'uuid';
import { storage } from '../storage';
import { makeListeningTaskTitle } from './title';

export async function createFollowUpListeningTask(opts: {
  userId: string;
  from: { progressId: string; taskId: string };
}): Promise<{ progressId: string; taskId: string }> {
  const { userId, from } = opts;
  
  // Read current task content to inherit properties
  const currentTask = await storage.getTaskProgress(from.progressId);
  if (!currentTask || currentTask.userId !== userId) {
    throw new Error('Invalid task or access denied');
  }
  
  // Get the weekly plan info to maintain week context
  const weeklyPlan = await storage.getWeeklyStudyPlan(currentTask.weeklyPlanId);
  if (!weeklyPlan) {
    throw new Error('Weekly plan not found');
  }
  
  // Build title with inherited context
  const title = makeListeningTaskTitle({
    scriptType: (currentTask.scriptType || 'dialogue') as 'dialogue' | 'monologue',
    contextLabel: currentTask.contextLabel || 'conversation',
    topicDomain: currentTask.topicDomain || 'general',
    scenarioOverview: currentTask.scenarioOverview || ''
  });
  
  // Create new task progress with inherited properties
  const newProgressId = uuidv4();
  const newTaskId = uuidv4();
  
  const newTaskProgress = {
    id: newProgressId,
    userId,
    weeklyPlanId: currentTask.weeklyPlanId,
    weekNumber: currentTask.weekNumber,
    dayNumber: currentTask.dayNumber, // Same day, continuing session
    taskTitle: title,
    skill: 'listening' as const,
    status: 'not-started' as const,
    
    // Inherit key properties for continuity
    accent: currentTask.accent || 'British',
    ieltsPart: currentTask.ieltsPart,
    topicDomain: currentTask.topicDomain,
    contextLabel: currentTask.contextLabel,
    scriptType: currentTask.scriptType || 'dialogue',
    
    // These will be populated by the pipeline
    scriptText: null,
    audioUrl: null,
    questions: null,
    difficulty: null,
    duration: 0,
    replayLimit: 3,
    progressData: null,
    startedAt: null,
    completedAt: null,
    scenarioOverview: null,
    estimatedDurationSec: null,
    
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  await storage.createTaskProgress(newTaskProgress);
  
  console.log('[TASK_FACTORY][createFollowUp]', {
    userId,
    fromProgressId: from.progressId,
    newProgressId,
    newTaskId,
    title,
    inheritedAccent: currentTask.accent,
    inheritedPart: currentTask.ieltsPart
  });
  
  return {
    progressId: newProgressId,
    taskId: newTaskId
  };
}