import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getQueryFn } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { sharedTracker } from "@/lib/trackers";

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
  weeklyPlanId: string;
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
  enabled?: boolean;
}

// API response types
export interface TaskProgressResponse {
  success: boolean;
  message?: string;
  taskProgress?: TaskProgress;
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
  onSuccess, 
  onError, 
  enabled 
}: UseTaskProgressOptions): UseTaskProgressResult {
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
    return [`/api/firebase/task-progress/${weeklyPlanId}`];
  }, [weeklyPlanId]);

  // Query to fetch all task progress records for a weekly plan
  const taskProgressQuery = useQuery({
    queryKey,
    queryFn: async () => {
      // DISABLED FOR RENDER LOOP TESTING
      console.log('[Hook DIAG] taskProgressQuery.queryFn DISABLED for render loop testing');
      
      // Return mock data without making any API calls
      return {
        success: true,
        taskProgress: []
      };
    },
    retry: false,
    // Prevent any stale time refetches
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    // FORCE DISABLED for render loop testing
    enabled: false,
    select: (data: any) => {
      if (!data || !data.success || !data.taskProgress) {
        return [];
      }
      return data.taskProgress as TaskProgress[];
    },
  });
  
  // Callbacks with debounce to prevent render loops
  // DISABLED FOR RENDER LOOP TESTING
  useEffect(() => {
    console.log('[Hook DIAG] Callback useEffect DISABLED for render loop testing');
    
    // No-op for render loop testing
    return () => { /* No-op cleanup */ };
  }, []); // Empty dependency array - only run once on mount

  // All mutations are DISABLED FOR RENDER LOOP TESTING
  const createTaskProgressMutation = useMutation<
    TaskProgressResponse,
    Error,
    any
  >({
    mutationFn: async (): Promise<TaskProgressResponse> => {
      console.log('[Hook DIAG] createTaskProgressMutation DISABLED');
      // Return full mock task progress object to satisfy type constraints
      return { 
        success: true, 
        taskProgress: {
          id: 'mock-id',
          userId: 'mock-user-id',
          weeklyPlanId: 'mock-weekly-plan-id',
          weekNumber: 1,
          dayNumber: 1,
          taskTitle: 'Mock Task',
          status: 'not-started' as 'not-started' | 'in-progress' | 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    },
    onSuccess: () => {
      console.log('[Hook DIAG] createTaskProgressMutation.onSuccess DISABLED');
    },
  });

  const updateTaskStatusMutation = useMutation<
    TaskProgressResponse,
    Error,
    any
  >({
    mutationFn: async (): Promise<TaskProgressResponse> => {
      console.log('[Hook DIAG] updateTaskStatusMutation DISABLED');
      // Return full mock task progress object to satisfy type constraints
      return { 
        success: true, 
        taskProgress: {
          id: 'mock-id',
          userId: 'mock-user-id',
          weeklyPlanId: 'mock-weekly-plan-id',
          weekNumber: 1,
          dayNumber: 1,
          taskTitle: 'Mock Task',
          status: 'not-started' as 'not-started' | 'in-progress' | 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    },
    onSuccess: () => {
      console.log('[Hook DIAG] updateTaskStatusMutation.onSuccess DISABLED');
    },
  });

  const startTaskMutation = useMutation<
    TaskProgressResponse,
    Error,
    any
  >({
    mutationFn: async (): Promise<TaskProgressResponse> => {
      console.log('[Hook DIAG] startTaskMutation DISABLED');
      // Return full mock task progress object to satisfy type constraints
      return { 
        success: true, 
        taskProgress: {
          id: 'mock-id',
          userId: 'mock-user-id',
          weeklyPlanId: 'mock-weekly-plan-id',
          weekNumber: 1,
          dayNumber: 1,
          taskTitle: 'Mock Task',
          status: 'in-progress' as 'not-started' | 'in-progress' | 'completed',
          startedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    },
    onSuccess: () => {
      console.log('[Hook DIAG] startTaskMutation.onSuccess DISABLED');
    },
  });

  const completeTaskMutation = useMutation<
    TaskProgressResponse,
    Error,
    any
  >({
    mutationFn: async (): Promise<TaskProgressResponse> => {
      console.log('[Hook DIAG] completeTaskMutation DISABLED');
      // Return full mock task progress object to satisfy type constraints
      return { 
        success: true, 
        taskProgress: {
          id: 'mock-id',
          userId: 'mock-user-id',
          weeklyPlanId: 'mock-weekly-plan-id',
          weekNumber: 1,
          dayNumber: 1,
          taskTitle: 'Mock Task',
          status: 'completed' as 'not-started' | 'in-progress' | 'completed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    },
    onSuccess: () => {
      console.log('[Hook DIAG] completeTaskMutation.onSuccess DISABLED');
    },
  });

  // Define stable function versions with useCallback to prevent re-renders
  const createTaskProgress = useCallback(
    async (data: { weeklyPlanId: string; weekNumber: number; dayNumber: number; taskTitle: string }): Promise<TaskProgressResponse> => {
      console.log('[Hook DIAG] createTaskProgress DISABLED', data);
      return { 
        success: true, 
        taskProgress: {
          id: 'mock-id',
          userId: 'mock-user-id',
          weeklyPlanId: data.weeklyPlanId,
          weekNumber: data.weekNumber,
          dayNumber: data.dayNumber,
          taskTitle: data.taskTitle,
          status: 'not-started' as 'not-started' | 'in-progress' | 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    },
    []
  );

  const updateTaskStatus = useCallback(
    async (data: { taskId: string; status: 'not-started' | 'in-progress' | 'completed'; progressData?: any }): Promise<TaskProgressResponse> => {
      console.log('[Hook DIAG] updateTaskStatus DISABLED', data);
      return { 
        success: true, 
        taskProgress: {
          id: data.taskId,
          userId: 'mock-user-id',
          weeklyPlanId: 'mock-weekly-plan-id',
          weekNumber: 1,
          dayNumber: 1,
          taskTitle: 'Mock Task',
          status: data.status as 'not-started' | 'in-progress' | 'completed',
          progressData: data.progressData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    },
    []
  );

  const startTask = useCallback(
    async (data: { taskId: string; progressData?: any }): Promise<TaskProgressResponse> => {
      console.log('[Hook DIAG] startTask DISABLED', data);
      return { 
        success: true, 
        taskProgress: {
          id: data.taskId,
          userId: 'mock-user-id',
          weeklyPlanId: 'mock-weekly-plan-id',
          weekNumber: 1,
          dayNumber: 1,
          taskTitle: 'Mock Task',
          status: 'in-progress' as 'not-started' | 'in-progress' | 'completed',
          progressData: data.progressData,
          startedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    },
    []
  );

  const completeTask = useCallback(
    async (data: { taskId: string; progressData?: any }): Promise<TaskProgressResponse> => {
      console.log('[Hook DIAG] completeTask DISABLED', data);
      return { 
        success: true, 
        taskProgress: {
          id: data.taskId,
          userId: 'mock-user-id',
          weeklyPlanId: 'mock-weekly-plan-id',
          weekNumber: 1,
          dayNumber: 1,
          taskTitle: 'Mock Task',
          status: 'completed' as 'not-started' | 'in-progress' | 'completed',
          progressData: data.progressData,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    },
    []
  );

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
    refetch: taskProgressQuery.refetch,
    
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
 * DISABLED FOR RENDER LOOP TESTING - BUT MAINTAINS ORIGINAL SIGNATURE
 * 
 * @param weeklyPlanId The ID of the weekly plan to initialize tasks for
 * @param tasks The list of tasks to ensure have progress records
 */
export function useInitializeTaskProgress(weeklyPlanId: string, tasks: any[] = []) {
  // Track initialization state
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Simple debugging for component mount/unmount
  useEffect(() => {
    console.log(`[DIAG] useInitializeTaskProgress mounted with weeklyPlanId: ${weeklyPlanId}`);
    console.log(`[DIAG] Tasks array: length=${tasks?.length || 0}, isArray=${Array.isArray(tasks)}`);
    
    return () => {
      console.log(`[DIAG] useInitializeTaskProgress unmounted`);
    };
  }, [weeklyPlanId]); // Only log on weeklyPlanId change

  // Function to initialize all tasks - strictly following original signature
  const initialize = useCallback(async (tasksToInitialize: any[] = tasks) => {
    // Always set initializing state to true when we start
    setIsInitializing(true);
    
    console.log('[DIAG] initialize called with:', {
      hasTasksParam: !!tasksToInitialize, 
      paramIsArray: Array.isArray(tasksToInitialize),
      length: tasksToInitialize?.length || 0
    });
    
    try {
      // CRUCIAL FIX: Always ensure we're working with an array before map()
      const safeTasksArray = Array.isArray(tasksToInitialize) ? tasksToInitialize : [];
      
      // Process tasks with map() as the original would - but just for logging
      const processedTasks = safeTasksArray.map(task => {
        console.log(`[Mock Init] Processing task:`, task?.title || task);
        return task; // return the task unchanged
      });
      
      console.log(`[Mock Init] Successfully processed ${processedTasks.length} tasks`);
      
      // Return success status that matches original API
      return { 
        success: true,
        message: `Mocked task initialization for ${weeklyPlanId}`
      };
    } catch (error) {
      console.error('[useInitializeTaskProgress] Error:', error);
      return { 
        success: false,
        message: 'Error in task initialization'
      };
    } finally {
      // Set initializing to false when we're done (success or error)
      setIsInitializing(false);
    }
  }, [weeklyPlanId, tasks]); // match original dependencies
  
  // Return the exact same object structure as the original hook
  // Use proper name 'initializeTasks' to match what component expects
  return { 
    initializeTasks: initialize, 
    isInitializing 
  };
}