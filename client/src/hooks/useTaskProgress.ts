import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getQueryFn } from "@/lib/queryClient";
import { queryClient, tokenManager } from "@/lib/queryClient";
import { sharedTracker } from "@/lib/trackers";

// Debug toggle
const DEBUG = Boolean((window as any).__DEBUG__);

// Mock API response types for type safety
type ApiResponse = Response | { ok?: boolean; status?: number; statusText?: string; json?: () => Promise<any> } | null;

// Progress tracking entity
export interface TaskProgress {
  id: string;
  userId: string;
  weeklyPlanId: string;
  weekNumber: number;
  dayNumber: number;
  taskTitle: string;
  status: 'not-started' | 'in-progress' | 'completed';
  progressData?: any;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Hook options
export interface UseTaskProgressOptions {
  weeklyPlanId?: string; // Now optional - use either weeklyPlanId OR progressId
  progressId?: string;   // New option - specific progress ID for individual task
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
  enabled?: boolean;
}

// API response types
export interface TaskProgressResponse {
  success: boolean;
  message?: string;
  taskProgress?: TaskProgress;
  missingRecords?: boolean;
}

// Return type for our hook
export interface UseTaskProgressResult {
  taskProgress: TaskProgress[];
  isLoading: boolean;
  isUpdating: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<any>;
  createTaskProgress: (data: { weeklyPlanId: string; weekNumber: number; dayNumber: number; taskTitle: string }) => Promise<TaskProgressResponse>;
  updateTaskStatus: (data: { taskId: string; status: 'not-started' | 'in-progress' | 'completed'; progressData?: any }) => Promise<TaskProgressResponse>;
  startTask: (data: { taskId: string; progressData?: any }) => Promise<TaskProgressResponse>;
  completeTask: (data: { taskId: string; progressData?: any }) => Promise<TaskProgressResponse>;
}

// Default result for error states 
const defaultTaskProgressResult: UseTaskProgressResult = {
  taskProgress: [],
  isLoading: false,
  isUpdating: false,
  isFetching: false,
  error: null,
  refetch: async () => ({}),
  createTaskProgress: async () => ({ success: false }),
  updateTaskStatus: async () => ({ success: false }),
  startTask: async () => ({ success: false }),
  completeTask: async () => ({ success: false }),
};

/**
 * Custom hook to fetch and update task progress records
 * Optimized version with more efficient caching and state management
 * 
 * @param weeklyPlanId ID of the weekly plan to fetch tasks for
 * @param onSuccess Optional callback when data is loaded successfully
 * @param onError Optional callback when an error occurs
 * @param enabled Flag to enable/disable the query (defaults to true)
 */
export function useTaskProgress({ 
  weeklyPlanId, 
  progressId,
  onSuccess, 
  onError, 
  enabled 
}: UseTaskProgressOptions): UseTaskProgressResult {
  // Add hasFetchedRef to track if we've already fetched
  const hasFetchedRef = useRef(false);
  
  // Reference to the initialize function from useInitializeTaskProgress
  // This will be set after that hook is called
  const initializeRef = useRef<((weekNum: number) => Promise<any>) | null>(null);
  // Refs for component lifecycle and debouncing
  const componentMountedRef = useRef(true);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Clean up on unmount
  useEffect(() => {
    componentMountedRef.current = true;
    
    return () => {
      componentMountedRef.current = false;
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Memoize the query key to prevent unnecessary re-renders
  // Using useMemo to memoize the query key and avoid the LSP warnings
  const queryKey = useMemo(() => {
    // If we have a progressId, use that for single-task fetching
    if (progressId) {
      return [`/api/firebase/task-progress/${progressId}`];
    }
    // Otherwise use weeklyPlanId for batch fetching
    else if (weeklyPlanId) {
      return [`/api/firebase/task-progress/${weeklyPlanId}`];
    }
    // Empty array if we don't have either ID
    return [];
  }, [weeklyPlanId, progressId]);

  // Query to fetch task progress records - either for a single task or a weekly plan
  const taskProgressQuery = useQuery({
    queryKey,
    // Custom query function to handle 404 errors gracefully
    queryFn: async (ctx) => {
      // Skip if we don't have a valid query key
      if (!ctx.queryKey[0]) {
        console.warn('[useTaskProgress] No valid query key, skipping fetch');
        return { success: true, taskProgress: [] };
      }
      
      // Add one-time network fetch log (only in debug mode)
      if (DEBUG) console.log('[useTaskProgress] NETWORK FETCH - this should only appear once');
      
      try {
        // Log the endpoint URL we're fetching
        const endpointUrl = ctx.queryKey[0] as string;
        const fetchingType = progressId ? 'single task' : 'weekly plan';
        console.log(`[useTaskProgress] fetching ${fetchingType}:`, endpointUrl);
        
        // Use the default query function
        const result = await getQueryFn({ on401: "returnNull" })(ctx);
        
        // Set hasFetchedRef to true immediately after fetch completes successfully
        hasFetchedRef.current = true;
        
        return result;
      } catch (err: any) {
        // Set hasFetchedRef to true on any error to prevent retries
        hasFetchedRef.current = true;
        
        // If this is a 404 or 403 (not found or forbidden), don't throw - handle gracefully
        if (err?.status === 404 || err?.response?.status === 404 ||
            err?.status === 403 || err?.response?.status === 403) {
          console.warn('[useTaskProgress] 404/403 error — returning empty result');
          const id = progressId || weeklyPlanId;
          console.warn(`[useTaskProgress] Access denied or not found for ${id}`);
          
          // Return empty result to avoid error toast
          return { success: true, taskProgress: [], missingRecords: true };
        }
        
        console.error(`[useTaskProgress] Error fetching task progress:`, err);
        // Extract error message for more useful error display
        const errorMessage = err?.message || 'Unknown error occurred';
        throw new Error(`Task progress error: ${errorMessage}`);
        // Don't just re-throw the original error - provide a better message
      }
    },
    retry: 0, // Don't retry at all
    staleTime: Infinity, // Never consider data stale
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retryOnMount: false,
    enabled: !!(progressId || weeklyPlanId) && enabled !== false,
    select: (data: any) => {
      if (!data || !data.success || !data.taskProgress) {
        return [];
      }
      return data.taskProgress as TaskProgress[];
    },
  });
  
  // Track if we've already attempted initialization this mount
  const hasAttemptedInitRef = useRef(false);
  
  // Callbacks for success and error handling
  useEffect(() => {
    if (taskProgressQuery.isSuccess && taskProgressQuery.data) {
      // Check if the success response has the missingRecords flag from a 404
      const data = taskProgressQuery.data as any;
      
      // Only attempt initialization if:
      // 1. We have missing records (from a 404)
      // 2. We have an initialization function
      // 3. We haven't already tried initialization
      // 4. We are using the weeklyPlanId mode (not individual progressId)
      if (data && data.missingRecords && initializeRef.current && !hasAttemptedInitRef.current && weeklyPlanId && !progressId) {
        console.warn('[useTaskProgress] 404 detected as missingRecords flag, triggering initialization');
        
        // Mark that we've attempted initialization to prevent loops
        hasAttemptedInitRef.current = true;
        
        // Extract week number from weeklyPlanId or use a default
        const weekMatch = weeklyPlanId.match(/week-(\d+)/i);
        const weekNumber = weekMatch ? parseInt(weekMatch[1]) : 1;
        
        // Call initialize function with the extracted week number
        initializeRef.current(weekNumber)
          .then(() => {
            console.log('[useTaskProgress] Initialization triggered after 404');
            // Invalidate queries to refresh with new data
            queryClient.invalidateQueries({ queryKey });
          })
          .catch(err => {
            console.error('[useTaskProgress] Failed to initialize after 404:', err);
          });
      } else if (onSuccess) {
        // Normal success case
        onSuccess(taskProgressQuery.data);
      }
    }
    
    if (taskProgressQuery.isError && taskProgressQuery.error) {
      // Check if this is a 404 error - we want to suppress the error toast in this case
      const is404 = taskProgressQuery.error.message?.includes('404') || 
                    taskProgressQuery.error.message?.toLowerCase().includes('not found');
      
      // Only attempt initialization for 404 errors on weekly plan mode (not individual progressId)
      if (is404 && initializeRef.current && !hasAttemptedInitRef.current && weeklyPlanId && !progressId) {
        console.warn('[useTaskProgress] 404 error detected, suppressing toast and triggering initialization');
        
        // Mark that we've attempted initialization to prevent loops
        hasAttemptedInitRef.current = true;
        
        // Extract week number and trigger initialization
        const weekMatch = weeklyPlanId.match(/week-(\d+)/i);
        const weekNumber = weekMatch ? parseInt(weekMatch[1]) : 1;
        
        initializeRef.current(weekNumber)
          .then(() => {
            console.log('[useTaskProgress] Initialization triggered after 404 error');
            queryClient.invalidateQueries({ queryKey });
          })
          .catch(err => {
            console.error('[useTaskProgress] Failed to initialize after 404 error:', err);
          });
      } 
      // For individual progressId 404s, suppress the toast but don't try initialization
      else if (is404 && progressId) {
        console.warn(`[useTaskProgress] 404 for individual task progress (${progressId}), suppressing toast`);
      }
      else if (onError) {
        // Only call onError for non-404 errors or if not handled above
        onError(taskProgressQuery.error);
      }
    }
  }, [taskProgressQuery.isSuccess, taskProgressQuery.isError, taskProgressQuery.data, taskProgressQuery.error, onSuccess, onError, queryKey, weeklyPlanId, progressId]);

  // Re-enable task progress creation mutation
  const createTaskProgressMutation = useMutation<
    TaskProgressResponse,
    Error,
    { weeklyPlanId: string; weekNumber: number; dayNumber: number; taskTitle: string }
  >({
    mutationFn: async (data) => {
      console.log('[TaskProgress] Creating task progress:', data);
      // Track the request in Firestore tracking
      sharedTracker.trackWrite('task_progress', 1);
      
      // Token is now retrieved directly in the header
      
      const response = await fetch('/api/firebase/task-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenManager.getToken()}`
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        let msg: string;
        try {
          const body = await response.json();
          msg = body.message || JSON.stringify(body);
        } catch {
          msg = response.statusText || await response.text() || 'Unknown error';
        }
        throw new Error(`Failed to create task progress (${response.status}): ${msg}`);
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      console.log('[TaskProgress] Task progress created successfully:', data);
      // Invalidate the query to refresh the data
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateTaskStatusMutation = useMutation<
    TaskProgressResponse,
    Error,
    { taskId: string; status: 'not-started' | 'in-progress' | 'completed'; progressData?: any }
  >({
    mutationFn: async (data) => {
      console.log('[TaskProgress] Updating task status:', data);
      // Track this operation
      sharedTracker.trackWrite('task_progress', 1);
      
      const response = await fetch(`/api/firebase/task-progress/${data.taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenManager.getToken()}`
        },
        body: JSON.stringify({ status: data.status, progressData: data.progressData }),
      });
      
      if (!response.ok) {
        let msg: string;
        try {
          const body = await response.json();
          msg = body.message || JSON.stringify(body);
        } catch {
          msg = response.statusText || await response.text() || 'Unknown error';
        }
        throw new Error(`Failed to update task status (${response.status}): ${msg}`);
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      console.log('[TaskProgress] Task status updated successfully:', data);
      // Invalidate the query to refresh the data
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const startTaskMutation = useMutation<
    TaskProgressResponse,
    Error,
    { taskId: string; progressData?: any }
  >({
    mutationFn: async (data) => {
      console.log('[TaskProgress] Starting task:', data);
      // Track this operation
      sharedTracker.trackWrite('task_progress', 1);
      
      const response = await fetch(`/api/firebase/task-progress/${data.taskId}/start`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenManager.getToken()}`
        },
        body: JSON.stringify({ progressData: data.progressData }),
      });
      
      if (!response.ok) {
        let msg: string;
        try {
          const body = await response.json();
          msg = body.message || JSON.stringify(body);
        } catch {
          msg = response.statusText || await response.text() || 'Unknown error';
        }
        throw new Error(`Failed to start task (${response.status}): ${msg}`);
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      console.log('[TaskProgress] Task started successfully:', data);
      // Invalidate the query to refresh the data
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const completeTaskMutation = useMutation<
    TaskProgressResponse,
    Error,
    { taskId: string; progressData?: any }
  >({
    mutationFn: async (data) => {
      console.log('[TaskProgress] Completing task:', data);
      // Track this operation
      sharedTracker.trackWrite('task_progress', 1);
      
      const response = await fetch(`/api/firebase/task-progress/${data.taskId}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenManager.getToken()}`
        },
        body: JSON.stringify({ progressData: data.progressData }),
      });
      
      if (!response.ok) {
        let msg: string;
        try {
          const body = await response.json();
          msg = body.message || JSON.stringify(body);
        } catch {
          msg = response.statusText || await response.text() || 'Unknown error';
        }
        throw new Error(`Failed to complete task (${response.status}): ${msg}`);
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      console.log('[TaskProgress] Task completed successfully:', data);
      // Invalidate the query to refresh the data
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Define stable function versions with useCallback to prevent re-renders
  const createTaskProgress = useCallback(
    async (data: { weeklyPlanId: string; weekNumber: number; dayNumber: number; taskTitle: string }): Promise<TaskProgressResponse> => {
      console.log('[TaskProgress] Creating task progress via callback:', data);
      return createTaskProgressMutation.mutateAsync(data);
    },
    [createTaskProgressMutation]
  );

  const updateTaskStatus = useCallback(
    async (data: { taskId: string; status: 'not-started' | 'in-progress' | 'completed'; progressData?: any }): Promise<TaskProgressResponse> => {
      console.log('[TaskProgress] Updating task status via callback:', data);
      return updateTaskStatusMutation.mutateAsync(data);
    },
    [updateTaskStatusMutation]
  );

  const startTask = useCallback(
    async (data: { taskId: string; progressData?: any }): Promise<TaskProgressResponse> => {
      console.log('[TaskProgress] Starting task via callback:', data);
      return startTaskMutation.mutateAsync(data);
    },
    [startTaskMutation]
  );

  const completeTask = useCallback(
    async (data: { taskId: string; progressData?: any }): Promise<TaskProgressResponse> => {
      console.log('[TaskProgress] Completing task via callback:', data);
      return completeTaskMutation.mutateAsync(data);
    },
    [completeTaskMutation]
  );

  // Create an enhanced refetch function that also exposes a way to set the initialize func
  const enhancedRefetch = useCallback(async () => {
    return await taskProgressQuery.refetch();
  }, [taskProgressQuery]);
  
  // Add a method to set the initialize function
  (enhancedRefetch as any).setInitializeFunc = (initFunc: any) => {
    console.log('[useTaskProgress] Received initialize function from TaskList');
    initializeRef.current = initFunc;
  };
  
  // Return the result
  return {
    // Query state
    taskProgress: taskProgressQuery.data || [],
    isLoading: taskProgressQuery.isLoading,
    isUpdating: createTaskProgressMutation.isPending || 
                updateTaskStatusMutation.isPending ||
                startTaskMutation.isPending || 
                completeTaskMutation.isPending,
    isFetching: taskProgressQuery.isFetching,
    error: taskProgressQuery.error as Error,
    refetch: enhancedRefetch,
    
    // Mutations
    createTaskProgress,
    updateTaskStatus,
    startTask,
    completeTask,
  };
}

/**
 * Hook to initialize task progress records for a weekly plan
 * This is used when a user first views a weekly plan, to ensure all tasks have associated progress records
 * 
 * @param weeklyPlanId The ID of the weekly plan to initialize tasks for
 * @param tasks The list of tasks to ensure have progress records
 */
export function useInitializeTaskProgress(weeklyPlanId: string, tasks: any[] = []) {
  // Track initialization state
  const [isInitializing, setIsInitializing] = useState(false);
  // Use a ref to ensure we only initialize once per component mount
  const hasInitializedRef = useRef(false);
  
  // Track this initialization with the shared tracker
  useEffect(() => {
    console.log(`[TaskProgress] useInitializeTaskProgress mounted with weeklyPlanId: ${weeklyPlanId}`);
    console.log(`[TaskProgress] Tasks array: length=${tasks?.length || 0}, isArray=${Array.isArray(tasks)}`);
    console.log(`[TaskProgress] Has already initialized: ${hasInitializedRef.current}`);
    
    // Reset the initialization flag when the hook unmounts
    return () => {
      console.log(`[TaskProgress] useInitializeTaskProgress unmounting, resetting initialization flag`);
      hasInitializedRef.current = false;
    };
  }, [weeklyPlanId, tasks]);

  // Mutation for batch initialization
  const batchInitializeMutation = useMutation({
    mutationFn: async (tasksData: {
      weeklyPlanId: string;
      tasks: Array<{ taskTitle: string; dayNumber: number; weekNumber: number; initialStatus?: string }>;
    }) => {
      console.log('[TaskProgress] Batch initializing tasks:', tasksData);
      sharedTracker.trackWrite('task_progress', tasksData.tasks.length);
      
      const response = await fetch('/api/firebase/task-progress/batch-initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('firebase_token')}`
        },
        body: JSON.stringify(tasksData),
      });
      
      if (!response.ok) {
        let msg: string;
        try {
          const body = await response.json();
          msg = body.message || JSON.stringify(body);
        } catch {
          msg = response.statusText || await response.text() || 'Unknown error';
        }
        console.error('[batchInit] failed with status:', response.status, msg);
        throw new Error(`Failed to initialize tasks (${response.status}): ${msg}`);
      }
      
      return await response.json();
    }
  });
  
  // Function to initialize all tasks - accepts either tasks array or week number
  const initialize = useCallback(async (weekNumberOrTasks: number | any[] = tasks) => {
    // If we've already initialized during this component lifecycle, don't do it again
    if (hasInitializedRef.current) {
      console.log('[TaskProgress] Skipping duplicate initialization - already initialized');
      return { success: true, message: 'Already initialized', skipped: true };
    }
    
    // Handle case where weekNumber is passed instead of tasks array
    const tasksToInitialize = typeof weekNumberOrTasks === 'number' ? tasks : weekNumberOrTasks;
    // Always set initializing state to true when we start
    setIsInitializing(true);
    
    console.log('[TaskProgress] Initializing tasks:', {
      weeklyPlanId,
      tasksCount: tasksToInitialize?.length || 0
    });
    
    try {
      // Safety check for empty data
      if (!weeklyPlanId) {
        throw new Error('Weekly plan ID is required for task initialization');
      }
      
      // Ensure we're working with an array before mapping
      const safeTasksArray = Array.isArray(tasksToInitialize) ? tasksToInitialize : [];
      
      if (safeTasksArray.length === 0) {
        console.log('[TaskProgress] No tasks to initialize');
        return { success: true, message: 'No tasks to initialize' };
      }
      
      // Format tasks for the API
      const formattedTasks = safeTasksArray.map(task => ({
        taskTitle: task.title,
        dayNumber: task.dayNumber,
        weekNumber: task.weekNumber,
        skill: task.skill || 'listening', // Include skill type for content generation trigger
        initialStatus: 'not-started'
      }));
      
      // Call the batch initialize mutation
      const result = await batchInitializeMutation.mutateAsync({
        weeklyPlanId,
        tasks: formattedTasks
      });
      
      // Mark as initialized so we don't do it again this session
      hasInitializedRef.current = true;
      
      // Invalidate all task progress queries to force a refresh with the new data
      queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-progress/${weeklyPlanId}`] });
      
      console.log('[TaskProgress] Tasks initialized successfully:', result);
      console.log('[TaskProgress] Invalidated queries to refresh with new data');
      return result;
    } catch (err: any) {
      console.error('[TaskProgress] Error initializing tasks:', err);
      const errorMessage = err?.message || 'Unknown error occurred';
      return { 
        success: false,
        message: `Task initialization failed: ${errorMessage}`
      };
    } finally {
      // Set initializing to false when we're done (success or error)
      setIsInitializing(false);
    }
  }, [weeklyPlanId, tasks, batchInitializeMutation]);
  
  // Return the same hook interface
  return { 
    initializeTasks: initialize, 
    isInitializing 
  };
}