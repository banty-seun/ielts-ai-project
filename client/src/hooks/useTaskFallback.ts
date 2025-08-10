/**
 * This is a fallback utility for task progress handling to prevent 404 errors
 * when there are issues with task progress API endpoints.
 */

import { createComponentTracker } from '../lib/firestoreTracker';

// Create a tracker for this utility
const fallbackTracker = createComponentTracker('useTaskFallback');

/**
 * Gets task progress data from weekly plan data when direct task progress fetch fails
 * This helps avoid 404 errors when clicking Start on tasks
 * 
 * @param weeklyPlanId The weekly plan ID
 * @param weekNumber The week number
 * @param dayNumber The day number
 * @param taskTitle The task title
 * @returns Object with task progress ID or undefined
 */
export async function getTaskProgressIdFromWeeklyPlan(
  weeklyPlanId: string,
  weekNumber: number,
  dayNumber: number,
  taskTitle: string
): Promise<string | undefined> {
  // Log the operation
  fallbackTracker.trackRead('task_progress', 1);
  console.log(`[Fallback] Attempting to find task progress ID for week ${weekNumber}, day ${dayNumber}, task "${taskTitle}"`);
  
  try {
    // Try to get all task progress records for this weekly plan
    const response = await fetch(`/api/firebase/task-progress/weekly-plan/${weeklyPlanId}`);
    
    if (!response.ok) {
      console.error(`[Fallback] Failed to fetch task progress records for weekly plan ${weeklyPlanId}`);
      return undefined;
    }
    
    const data = await response.json();
    
    // Check if we have valid data
    if (!data || !data.success || !Array.isArray(data.taskProgress)) {
      console.error(`[Fallback] Invalid response from weekly plan endpoint`);
      return undefined;
    }
    
    // Try to find a matching task progress record
    const matchingRecord = data.taskProgress.find(
      (tp: any) => 
        tp.weekNumber === weekNumber && 
        tp.dayNumber === dayNumber &&
        tp.taskTitle === taskTitle
    );
    
    if (matchingRecord?.id) {
      console.log(`[Fallback] Found matching task progress ID: ${matchingRecord.id}`);
      return matchingRecord.id;
    }
    
    // If no exact match, try finding by week and day only
    const dayMatch = data.taskProgress.find(
      (tp: any) => tp.weekNumber === weekNumber && tp.dayNumber === dayNumber
    );
    
    if (dayMatch?.id) {
      console.log(`[Fallback] Found day matching task progress ID: ${dayMatch.id}`);
      return dayMatch.id;
    }
    
    console.log(`[Fallback] No matching task progress found`);
    return undefined;
  } catch (error) {
    console.error(`[Fallback] Error finding task progress:`, error);
    return undefined;
  }
}

/**
 * Helper function to extract task progress ID from URL parameters
 * 
 * @returns The task progress ID or undefined
 */
export function getTaskProgressIdFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  
  const url = new URL(window.location.href);
  const params = url.searchParams;
  
  // First try progressId parameter
  const progressId = params.get('progressId');
  if (progressId) {
    console.log(`[Fallback] Found progressId in URL: ${progressId}`);
    return progressId;
  }
  
  // If no progressId, try taskId
  const taskId = params.get('taskId');
  if (taskId) {
    console.log(`[Fallback] Found taskId in URL: ${taskId}`);
    return taskId;
  }
  
  console.log(`[Fallback] No task progress ID found in URL`);
  return undefined;
}