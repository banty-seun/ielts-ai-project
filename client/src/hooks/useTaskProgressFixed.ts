import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@lib/queryClient";
import { getToken } from "@lib/tokenManager";
import { patchFreshWithAuth } from "@lib/freshFetch";
import { useFirestoreOpTracker } from "./useFirestoreOps";

// Define task progress types
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

export interface UseTaskProgressOptions {
  weeklyPlanId: string;
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
}

export interface TaskProgressResponse {
  success: boolean;
  message?: string;
  taskProgress?: TaskProgress | TaskProgress[];
}

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

/**
 * Hook to manage task progress for a specific weekly plan
 * @param options Object containing weeklyPlanId and optional success/error callbacks
 * @returns Object with task progress data and mutation functions
 */
export function useTaskProgress({ weeklyPlanId, onSuccess, onError }: UseTaskProgressOptions): UseTaskProgressResult {
  const queryClient = useQueryClient();
  const taskProgressTracker = useFirestoreOpTracker('task_progress_module');
  
  // Check if we're dealing with a task progress ID or weekly plan ID
  // Task progress IDs are UUID format with hyphens, weekly plan IDs can be similar but we check both
  const isTaskId = weeklyPlanId && (weeklyPlanId.includes('-') || weeklyPlanId.length > 10);
  
  // Use dedicated endpoint based on the ID type
  const endpoint = isTaskId
    ? `/api/firebase/task-progress/${weeklyPlanId}` // Single task progress by ID
    : `/api/firebase/task-progress/weekly-plan/${weeklyPlanId}`; // All tasks for a weekly plan
    
  console.log(`[useTaskProgress] Using endpoint with ID: ${weeklyPlanId} (ID type: ${isTaskId ? 'task progress' : 'weekly plan'})`);
  console.log(`[useTaskProgress] Full endpoint URL: ${endpoint}`);
  
  const taskProgressQuery = useQuery({
    queryKey: [endpoint],
    queryFn: async (ctx) => {
      // Track the firestore read that will occur
      taskProgressTracker.trackRead('task_progress', 1);
      console.log(`[useTaskProgress] Fetching from endpoint: ${endpoint}`);
      
      try {
        // Use the existing query function
        const result = await getQueryFn({ on401: "returnNull" })(ctx);
        console.log('[useTaskProgress] Fetch result:', result);
        return result;
      } catch (error: any) {
        // If this is a 404 (not found) for a task ID, don't throw - return empty array
        // This prevents infinite retry loops
        if (isTaskId && (error?.status === 404 || error?.response?.status === 404)) {
          console.warn(`[useTaskProgress] Task progress ID ${weeklyPlanId} not found, returning empty result`);
          return { success: true, taskProgress: [] };
        }
        
        console.error(`[useTaskProgress] Error fetching task progress:`, error);
        throw error;
      }
    },
    select: (data): { taskProgress: TaskProgress[] } => {
      // If we requested a single task progress by ID and got a single object,
      // wrap it in an array for consistent handling
      if (isTaskId && data?.success && !Array.isArray(data?.taskProgress)) {
        return { taskProgress: [data.taskProgress].filter(Boolean) };
      }
      
      // If task progress is array, use it, otherwise ensure we return an array
      return { 
        taskProgress: Array.isArray(data?.taskProgress) 
          ? data.taskProgress 
          : (data?.taskProgress ? [data.taskProgress] : [])
      };
    }
  });

  // Function to create a new task progress
  const createTaskProgressMutation = useMutation({
    mutationFn: async (data: { weeklyPlanId: string; weekNumber: number; dayNumber: number; taskTitle: string }) => {
      // Track the firestore write that will occur
      taskProgressTracker.trackWrite('task_progress', 1);
      
      console.log(`[useTaskProgress] Creating task progress:`, data);
      
      return apiRequest('/api/firebase/task-progress', {
        method: 'POST',
        body: data,
      });
    },
    onSuccess: (data: TaskProgressResponse) => {
      console.log('[useTaskProgress] Task progress created successfully:', data);
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      
      if (onSuccess) onSuccess(data);
    },
    onError: (error: Error) => {
      console.error("[useTaskProgress] Error creating task progress:", error);
      if (onError) onError(error);
    }
  });

  // Function to start a task
  const startTaskMutation = useMutation({
    mutationFn: async ({ taskId, progressData }: { taskId: string; progressData?: any }) => {
      // Track write operation
      taskProgressTracker.trackWrite('task_progress', 1);
      
      console.log(`[useTaskProgress] Starting task: taskId=${taskId}`);
      
      return apiRequest(`/api/firebase/task-progress/${taskId}/start`, {
        method: 'PATCH',
        body: { progressData },
      });
    },
    onSuccess: (data: TaskProgressResponse) => {
      console.log('[useTaskProgress] Task started successfully:', data);
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      if (onSuccess) onSuccess(data);
    },
    onError: (error: Error) => {
      console.error("[useTaskProgress] Error starting task:", error);
      if (onError) onError(error);
    }
  });

  // Function to complete a task
  const completeTaskMutation = useMutation({
    mutationFn: async ({ taskId, progressData }: { taskId: string; progressData?: any }) => {
      // Track write operation
      taskProgressTracker.trackWrite('task_progress', 1);
      
      console.log(`[useTaskProgress] Completing task: taskId=${taskId}`);
      
      return apiRequest(`/api/firebase/task-progress/${taskId}/complete`, {
        method: 'PATCH',
        body: { progressData },
      });
    },
    onSuccess: (data: TaskProgressResponse) => {
      console.log('[useTaskProgress] Task completed successfully:', data);
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      if (onSuccess) onSuccess(data);
    },
    onError: (error: Error) => {
      console.error("[useTaskProgress] Error completing task:", error);
      if (onError) onError(error);
    }
  });

  // Function to update a task status (generic)
  const updateTaskStatusMutation = useMutation({
    mutationFn: async ({ taskId, status, progressData }: { taskId: string; status: 'not-started' | 'in-progress' | 'completed'; progressData?: any }) => {
      // Track write operation
      taskProgressTracker.trackWrite('task_progress', 1);
      
      console.log(`[useTaskProgress] Updating task status: taskId=${taskId}, status=${status}`);
      
      // Determine the appropriate endpoint based on status
      let endpoint;
      if (status === 'in-progress') {
        endpoint = `/api/firebase/task-progress/${taskId}/start`;
      } else if (status === 'completed') {
        endpoint = `/api/firebase/task-progress/${taskId}/complete`;
      } else {
        // Fallback for 'not-started' or any other status
        console.warn(`[useTaskProgress] Using generic status update for status: ${status}`);
        endpoint = `/api/firebase/task-progress/${taskId}/status`;
      }
      
      return apiRequest(endpoint, {
        method: 'PATCH',
        body: { status, progressData },
      });
    },
    onSuccess: (data: TaskProgressResponse) => {
      console.log('[useTaskProgress] Task status updated successfully:', data);
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      if (onSuccess) onSuccess(data);
    },
    onError: (error: Error) => {
      console.error("[useTaskProgress] Error updating task status:", error);
      if (onError) onError(error);
    }
  });

  return {
    // Task progress data and query state
    taskProgress: taskProgressQuery.data?.taskProgress || [],
    isLoading: taskProgressQuery.isLoading,
    isFetching: taskProgressQuery.isFetching,
    isUpdating: 
      createTaskProgressMutation.isPending || 
      startTaskMutation.isPending || 
      completeTaskMutation.isPending || 
      updateTaskStatusMutation.isPending,
    error: taskProgressQuery.error,
    refetch: taskProgressQuery.refetch,
    
    // Mutation functions
    createTaskProgress: createTaskProgressMutation.mutateAsync,
    startTask: startTaskMutation.mutateAsync,
    completeTask: completeTaskMutation.mutateAsync,
    updateTaskStatus: updateTaskStatusMutation.mutateAsync,
  };
}

/**
 * Hook to initialize task progress for a new weekly plan
 * This creates progress records for each task in the plan
 * 
 * @param weeklyPlanId Weekly plan ID
 * @param tasks Array of tasks to initialize
 * @returns Loading, error, and refetch function
 */
export function useInitializeTaskProgress(weeklyPlanId: string, tasks: any[]) {
  const queryClient = useQueryClient();
  const taskProgressTracker = useFirestoreOpTracker('task_progress_module');
  
  const initializeTaskProgressMutation = useMutation({
    mutationFn: async () => {
      // Track write operations - one for each task
      taskProgressTracker.trackWrite('task_progress', tasks.length);
      
      console.log(`[useInitializeTaskProgress] Initializing task progress for ${tasks.length} tasks in plan ${weeklyPlanId}`);
      
      // Map tasks to a format expected by the API
      const formattedTasks = tasks.map(task => ({
        taskTitle: task.title,
        dayNumber: parseInt(task.day.replace('Day ', '')),
        initialStatus: 'not-started'
      }));
      
      return apiRequest('/api/firebase/task-progress/batch-initialize', {
        method: 'POST',
        body: {
          weeklyPlanId,
          tasks: formattedTasks
        },
      });
    },
    onSuccess: (data: any) => {
      console.log('[useInitializeTaskProgress] Tasks initialized successfully:', data);
      
      // Invalidate any queries for this weekly plan
      queryClient.invalidateQueries({ 
        queryKey: [`/api/firebase/task-progress/weekly-plan/${weeklyPlanId}`]
      });
    },
    onError: (error: Error) => {
      console.error("[useInitializeTaskProgress] Error initializing task progress:", error);
    }
  });
  
  return {
    initialize: initializeTaskProgressMutation.mutate,
    isInitializing: initializeTaskProgressMutation.isPending,
    error: initializeTaskProgressMutation.error,
  };
}