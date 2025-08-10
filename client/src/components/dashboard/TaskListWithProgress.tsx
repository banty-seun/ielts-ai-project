import React, { useEffect, useState, useRef } from 'react';
import { cn } from '../../lib/utils';
import { Button } from '@/components/ui/button';
import { Circle, CheckCircle, PauseCircle, Play, CheckCheck } from 'lucide-react';
import { WeeklyPlanTask } from '../../hooks/useWeeklyPlan';
import { useLocation } from 'wouter';
import { useTaskProgress } from '../../hooks/useTaskProgress';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '../../hooks/use-toast';
import { useFirebaseAuthContext } from '../../contexts/FirebaseAuthContext';

// Debug log to verify useTaskProgress is properly imported and is a function
console.log('useTaskProgress imported:', typeof useTaskProgress === 'function');

interface TaskListWithProgressProps {
  tasks: WeeklyPlanTask[];
  weeklyPlanId: string;
  weekNumber: number;
  className?: string;
}

// Interface for the batch initialization API response
interface BatchInitResult {
  success: boolean;
  results?: {
    id: string;
    taskTitle: string;
    dayNumber: number;
    status: string;
    weeklyPlanId: string;
  }[];
  message?: string;
}

// Interface to track progress IDs for each task
interface ProgressIdMap {
  [key: string]: {
    progressId: string;
    status: string;
  };
}

export function TaskListWithProgress({ 
  tasks, 
  weeklyPlanId, 
  weekNumber, 
  className 
}: TaskListWithProgressProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Create a helper to format task titles consistently
  const formatTaskTitle = (title: string) => {
    // If title already contains a colon, assume it's properly formatted
    if (title.includes(':')) {
      return title;
    }
    
    // For older titles without formatting, create a formatted version
    // Extract scenario and conversation type from the title or create defaults
    if (title.toLowerCase().includes('introduction')) {
      return 'Office Dialogue: Introduction to IELTS Listening';
    } else if (title.toLowerCase().includes('listening practice')) {
      return 'Study Center: Listening Practice Session';
    } else if (title.toLowerCase().includes('academic')) {
      return 'University Campus: Academic Discussion';
    } else if (title.toLowerCase().includes('conversation')) {
      return 'Social Setting: Everyday Conversation';
    } else if (title.toLowerCase().includes('job') || title.toLowerCase().includes('work')) {
      return 'Workplace: Professional Discussion';
    } else if (title.toLowerCase().includes('travel') || title.toLowerCase().includes('booking')) {
      return 'Travel Agency: Booking Consultation';
    } else {
      // Use the original title as conversationType with a default scenario
      return `Listening Practice: ${title}`;
    }
  };
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);

  // Store task progress IDs from batch initialization 
  const [progressIdMap, setProgressIdMap] = useState<ProgressIdMap>({});
  
  // Track initialization state
  const [isInitializing, setIsInitializing] = useState(false);
  const [initializationComplete, setInitializationComplete] = useState(false);
  
  // Use a ref to ensure we only initialize once per component mount
  const hasInitializedRef = useRef(false);
  
  // Get Firebase auth context at component level (follow React hooks rules)
  const { getToken } = useFirebaseAuthContext();

  // Helper function to extract day number from the task.day property
  const getDayNumber = (day: string): number => {
    // Extract numbers from the day string (e.g., "Day 3" -> 3)
    const match = day.match(/\d+/);
    return match ? parseInt(match[0]) : 1; // Default to 1 if no number found
  };

  // Generate a unique key for each task based on title and day
  const getTaskKey = (title: string, dayNumber: number): string => {
    return `${title}__day${dayNumber}`;
  };

  // We'll move this hook call inside functions to avoid breaking React hooks rules
  
  // Initialize all task progress records in one batch API call
  const batchInitializeTasks = async (): Promise<BatchInitResult> => {
    setIsInitializing(true);
    
    try {
      console.log('[TaskList] Batch initializing tasks for', tasks.length, 'tasks in week', weekNumber);
      
      // Log localStorage token before API call
      const localStorageToken = localStorage.getItem('firebase_token');
      console.log('[TokenDebug] localStorage firebase_token type:', typeof localStorageToken);
      console.log('[TokenDebug] localStorage firebase_token value:', localStorageToken ? localStorageToken.substring(0, 10) + '...' : 'null');
      
      // Log direct getToken calls (using the hook from component level)
      const regularToken = await getToken();
      console.log('[TokenDebug] getToken() result type:', typeof regularToken);
      console.log('[TokenDebug] getToken() result value:', regularToken ? regularToken.substring(0, 10) + '...' : 'null');
      
      // Use the token directly (not localStorage)
      const token = regularToken;
      
      // Log what token we're actually using
      console.log('[TokenDebug] Using token value:', token ? token.substring(0, 10) + '...' : 'null');
      
      // Format tasks for batch initialization
      const tasksToInitialize = tasks.map(task => ({
        taskTitle: task.title,
        dayNumber: getDayNumber(task.day),
        weekNumber: weekNumber,
        skill: task.skill || 'listening', // Include skill type for content generation trigger
        initialStatus: 'not-started'
      }));
      
      // First attempt with token from getToken()
      const response = await fetch('/api/firebase/task-progress/batch-initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          weeklyPlanId,
          weekNumber,
          tasks: tasksToInitialize
        })
      });
      
      // Handle 401 Unauthorized - refresh token and retry
      if (response.status === 401) {
        console.warn('[TaskList] Got 401 unauthorized, refreshing token and retrying');
        
        // Get a fresh token for retry
        const retryToken = await getToken();
        
        // Update localStorage with the fresh token to ensure it's available for future calls
        if (retryToken) {
          localStorage.setItem('firebase_token', retryToken);
        }
        
        // Debug logs for token investigation
        console.log('[TokenDebug] retry token type:', typeof retryToken);
        console.log('[TokenDebug] retry token value:', retryToken ? retryToken.substring(0, 10) + '...' : 'null');
        
        if (retryToken) {
          console.log('[TaskList] Retrying batch initialization with fresh token');
          
          // Retry with fresh token
          const retryResponse = await fetch('/api/firebase/task-progress/batch-initialize', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${retryToken}`
            },
            body: JSON.stringify({
              weeklyPlanId,
              weekNumber,
              tasks: tasksToInitialize
            })
          });
          
          if (!retryResponse.ok) {
            const errorText = await retryResponse.text();
            throw new Error(`Failed to initialize tasks after token refresh: ${retryResponse.status} ${errorText}`);
          }
          
          const result = await retryResponse.json();
          return result;
        }
      }
      
      // Handle other errors
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to initialize tasks: ${response.status} ${errorText}`);
      }
      
      // Parse successful response
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('[TaskList] Error batch initializing tasks:', error);
      throw error;
    } finally {
      setIsInitializing(false);
    }
  };
  
  // Initialize tasks on component mount - only once
  useEffect(() => {
    // Only run once per component mount
    if (tasks?.length > 0 && !hasInitializedRef.current && !isInitializing) {
      console.log('[TaskList] First mount - initializing all tasks at once');
      
      // Mark as initialized immediately to prevent duplicate calls
      hasInitializedRef.current = true;
      
      batchInitializeTasks()
        .then((result) => {
          console.log('[TaskList] Batch initialization complete:', result);
          
          if (result.success && Array.isArray(result.results)) {
            // Map task progress IDs to their corresponding tasks
            const newProgressIdMap: ProgressIdMap = {};
            
            result.results.forEach((progress) => {
              const taskKey = getTaskKey(progress.taskTitle, progress.dayNumber);
              newProgressIdMap[taskKey] = {
                progressId: progress.id,
                status: progress.status
              };
            });
            
            // Store progress IDs in state for component to use
            setProgressIdMap(newProgressIdMap);
            setInitializationComplete(true);
            console.log('[TaskList] Stored progress IDs for', Object.keys(newProgressIdMap).length, 'tasks');
          } else {
            console.error('[TaskList] Batch initialization failed or returned unexpected format');
            // Reset initialization flag to allow retry
            hasInitializedRef.current = false;
          }
        })
        .catch((error) => {
          console.error('[TaskList] Batch initialization failed:', error);
          toast({
            title: 'Error preparing tasks',
            description: 'Unable to prepare your tasks. Please try refreshing the page.',
            variant: 'destructive'
          });
          
          // Reset initialization flag to allow retry
          hasInitializedRef.current = false;
        });
    }
  }, []); // Empty deps array ensures this only runs once on mount
  
  // Start or continue a task
  const navigateToPractice = async (task: WeeklyPlanTask, dayNumber: number) => {
    try {
      // Get task key and look up the progress ID
      const taskKey = getTaskKey(task.title, dayNumber);
      const progressData = progressIdMap[taskKey];
      
      if (!progressData || !progressData.progressId) {
        console.error('[TaskList] No progress ID found for task:', task.title);
        toast({
          title: 'Cannot start task',
          description: 'Task data not found. Please try refreshing the page.',
          variant: 'destructive'
        });
        return;
      }
      
      const progressId = progressData.progressId;
      const status = progressData.status;
      
      // Set loading state for this task
      setStartingTaskId(progressId);
      
      // Log the task we're starting
      console.log('[TaskList] Starting practice for:', {
        task: task.title,
        dayNumber,
        progressId,
        status
      });
      
      // If task is not started, mark it as in progress first
      if (status === 'not-started') {
        console.log('[TaskList] Marking task as in-progress:', progressId);
        
        try {
          // Log token for debugging
          console.log('[TokenDebug startTask] Using token from component level');
          
          // Get the latest token at the time we need it
          const token = await getToken();
          
          // First attempt with fresh token
          const response = await fetch(`/api/firebase/task-progress/${progressId}/start`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
              progressData: { lastActivity: new Date().toISOString() }
            })
          });
          
          // Handle 401 Unauthorized - refresh token and retry
          if (response.status === 401) {
            console.warn('[TaskList] Got 401 unauthorized when starting task, refreshing token and retrying');
            
            // Get a fresh token for retry
            const retryToken = await getToken();
            
            // Update localStorage with the fresh token to ensure it's available for future calls
            if (retryToken) {
              localStorage.setItem('firebase_token', retryToken);
            }
            
            // Debug logs for token investigation
            console.log('[TokenDebug startTask] retry token type:', typeof retryToken);
            console.log('[TokenDebug startTask] retry token value:', retryToken ? retryToken.substring(0, 10) + '...' : 'null');
            
            if (retryToken) {
              console.log('[TaskList] Retrying start task with fresh token');
              
              // Retry with fresh token
              const retryResponse = await fetch(`/api/firebase/task-progress/${progressId}/start`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${retryToken}`
                },
                body: JSON.stringify({
                  progressData: { lastActivity: new Date().toISOString() }
                })
              });
              
              if (!retryResponse.ok) {
                const errorText = await retryResponse.text();
                throw new Error(`Failed to start task after token refresh: ${retryResponse.status} ${errorText}`);
              }
              
              // Parse successful response
              const result = await retryResponse.json();
              console.log('[TaskList] Task marked as in-progress after retry:', result);
            } else {
              throw new Error('Failed to refresh token for starting task');
            }
          } else if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to start task: ${response.status} ${errorText}`);
          } else {
            // Parse successful response
            const result = await response.json();
            console.log('[TaskList] Task marked as in-progress:', result);
          }
          
          // Update local state to reflect the new status
          setProgressIdMap(prev => ({
            ...prev,
            [taskKey]: {
              ...prev[taskKey],
              status: 'in-progress'
            }
          }));
        } catch (error) {
          console.error('[TaskList] Error starting task:', error);
          toast({
            title: 'Error starting task',
            description: 'Unable to start the task. Please try again.',
            variant: 'destructive'
          });
          setStartingTaskId(null);
          return;
        }
      }

      // Navigate to practice page with all necessary params
      const target = `/practice/${weekNumber}/${dayNumber}?title=${encodeURIComponent(task.title)}&skill=${encodeURIComponent(task.skill)}&progressId=${progressId}&taskId=${progressId}&weeklyPlanId=${weeklyPlanId}`;
      
      console.log('[TASK ROUTING] Dashboard navigation details:', {
        taskTitle: task.title,
        weekNumber,
        dayNumber,
        progressId,
        taskId: progressId, // Using progressId as taskId
        weeklyPlanId,
        targetUrl: target
      });
      
      setLocation(target);
    } catch (error) {
      console.error('[TaskList] Navigation error:', error);
      toast({
        title: 'Error',
        description: 'We couldn\'t start this task. Please try again.',
        variant: 'destructive'
      });
      setStartingTaskId(null);
    }
  };

  // Helper to get task status label


  // Helper to get task action button text based on status
  const getActionButtonText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Review';
      case 'in-progress':
        return 'Resume';
      default:
        return 'Start';
    }
  };

  // Render empty state if no tasks
  if (!tasks || tasks.length === 0) {
    return (
      <div className={cn("py-4 text-center", className)}>
        <p className="text-gray-500">No tasks found for this week.</p>
      </div>
    );
  }

  // Render loading skeleton while initializing
  if (isInitializing || !initializationComplete) {
    return (
      <div className={cn("space-y-4", className)}>
        {[1, 2, 3, 4, 5].map((idx) => (
          <div key={idx} className="flex items-center justify-between p-2 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-9 w-16" />
          </div>
        ))}
      </div>
    );
  }

  // Render task list with proper progress IDs
  return (
    <div className={cn("space-y-1", className)}>
      {tasks.map((task, index) => {
        const dayNumber = getDayNumber(task.day);
        const taskKey = getTaskKey(task.title, dayNumber);
        const progressData = progressIdMap[taskKey];
        
        // Each task uses its stored progress ID and status
        const progressId = progressData?.progressId;
        const status = progressData?.status || 'not-started';
        
        // Use the status from our local state
        const currentStatus = status;

        return (
          <div 
            key={`${task.day}-${task.title}`} 
            className={cn(
              "flex items-center justify-between p-2 border-b border-gray-100 hover:bg-gray-50/50 transition-colors",
              currentStatus === 'completed' && "bg-gray-50/70"
            )}
          >
            <div className="flex items-center gap-3">
              {/* Status icon */}
              {currentStatus === 'completed' ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : currentStatus === 'in-progress' ? (
                <PauseCircle className="h-5 w-5 text-blue-500" />
              ) : (
                <Circle className="h-5 w-5 text-gray-300" />
              )}

              <div>
                <div className="font-medium text-sm">
                  {formatTaskTitle(task.title)}
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                  <span>{task.day}</span>
                  <span className="inline-block h-1 w-1 rounded-full bg-gray-300"></span>
                  <span>{task.duration}</span>
                </div>
              </div>
            </div>

            <div>
              <Button
                size="sm"
                variant={currentStatus === 'completed' ? "outline" : "default"}
                className={cn(
                  "rounded-md py-1 px-4 flex items-center gap-1",
                  currentStatus === 'completed' ? "border border-gray-200 hover:bg-gray-50" : ""
                )}
                onClick={() => navigateToPractice(task, dayNumber)}
                disabled={startingTaskId === progressId || isInitializing}
              >
                {startingTaskId === progressId ? (
                  <svg className="animate-spin h-3 w-3 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : currentStatus === 'completed' ? (
                  <CheckCheck className="h-3 w-3 mr-1" />
                ) : currentStatus === 'in-progress' ? (
                  <Play className="h-3 w-3 mr-1" />
                ) : (
                  <Play className="h-3 w-3 mr-1" />
                )}
                {startingTaskId === progressId ? 'Starting...' : getActionButtonText(currentStatus)}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}