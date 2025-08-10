import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import { getQueryFn } from "../lib/queryClient";
import { postFreshWithAuth, patchFreshWithAuth } from "../lib/apiClient";
import { useFirebaseAuthContext } from '../contexts/FirebaseAuthContext';
import { createComponentTracker } from '../lib/firestoreTracker';

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

// Define return type for API response
export interface TaskProgressResponse {
  success: boolean;
  message?: string;
  taskProgress?: TaskProgress;
}

// Create a tracker for this hook
const taskProgressTracker = createComponentTracker('useTaskProgress');

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

export function useTaskProgress({ weeklyPlanId, onSuccess, onError }: UseTaskProgressOptions): UseTaskProgressResult {
  const { getToken } = useFirebaseAuthContext();
  const queryClient = useQueryClient();
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  // Add debounce timeout ref and component mounted ref
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const componentMountedRef = useRef<boolean>(true);
  
  // Component unmount tracking
  useEffect(() => {
    return () => {
      componentMountedRef.current = false;
      // Clear any pending timeouts on unmount
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Query to fetch all task progress records for a weekly plan
  const taskProgressQuery = useQuery({
    queryKey: [`/api/firebase/task-progress/${weeklyPlanId}`],
    queryFn: async (ctx) => {
      // Track the firestore read that will occur
      taskProgressTracker.trackRead('task_progress', 1);
      
      // Use the existing query function
      return getQueryFn({ on401: "returnNull" })(ctx);
    },
    retry: false,
    // Increase stale time to reduce backend calls
    staleTime: 3 * 60 * 1000, // 3 minutes (up from 1 minute)
    enabled: !!weeklyPlanId,
    select: (data: any) => {
      if (!data || !data.success || !data.taskProgress) {
        return [];
      }
      console.log("Task progress data loaded/updated successfully");
      return data.taskProgress as TaskProgress[];
    },
  });
  
  // Add tracking for hook initializations
  console.count("useTaskProgressFixedTemp initialized");
  
  // Add ref guards to prevent multiple executions for the same data/error
  const dataSignatureRef = useRef<string>('');
  const errorSignatureRef = useRef<string>('');
  const hasHandledSuccessRef = useRef<boolean>(false);
  const hasHandledErrorRef = useRef<boolean>(false);
  
  // Tracking effect execution with a ref
  const effectRenderCountRef = useRef(0);
  
  // Handle success and error states manually with guards against re-runs
  useEffect(() => {
    // Increment and log the effect run count
    effectRenderCountRef.current += 1;
    console.log(`[useTaskProgressFixedTemp] Effect run #${effectRenderCountRef.current}`);
    
    // FIXED: Skip the callback execution entirely if onSuccess/onError are not defined
    if (!onSuccess && !onError) {
      console.log('[useTaskProgressFixedTemp] Callbacks are disabled, skipping effect execution');
      return;
    }
    
    // We're done loading when the query finishes
    if (!taskProgressQuery.isLoading && isInitialLoading) {
      setIsInitialLoading(false);
    }
    
    // Handle success callback - only once per unique data
    if (taskProgressQuery.isSuccess && onSuccess && !taskProgressQuery.isLoading) {
      // Generate a signature for the current data - FIXED: properly handle array data
      const currentDataSignature = taskProgressQuery.data ? 
        (Array.isArray(taskProgressQuery.data) ? 
          `array-${taskProgressQuery.data.length}` : 
          'object') : 'empty';
      
      // Only trigger if the data signature is different or not handled yet
      if (dataSignatureRef.current !== currentDataSignature || !hasHandledSuccessRef.current) {
        console.log('[useTaskProgressFixedTemp] Handling new success state:', currentDataSignature);
        
        // Update the ref to mark this data signature as handled
        dataSignatureRef.current = currentDataSignature;
        hasHandledSuccessRef.current = true;
        
        // Use setTimeout to break synchronous execution cycle
        setTimeout(() => {
          if (onSuccess && componentMountedRef.current) {
            onSuccess(taskProgressQuery.data);
          }
        }, 50); // Increased delay for more reliable async behavior
      }
    }
    
    // Handle error callback - only once per unique error
    if (taskProgressQuery.isError && onError) {
      // Generate a signature for the current error
      const currentErrorSignature = taskProgressQuery.error ? 
        taskProgressQuery.error.message : 'unknown-error';
      
      // Only trigger if the error signature is different or not handled yet
      if (errorSignatureRef.current !== currentErrorSignature || !hasHandledErrorRef.current) {
        console.log('[useTaskProgressFixedTemp] Handling new error state:', currentErrorSignature);
        
        // Update the ref to mark this error signature as handled
        errorSignatureRef.current = currentErrorSignature;
        hasHandledErrorRef.current = true;
        
        // Use setTimeout to break synchronous execution cycle
        setTimeout(() => {
          if (onError && componentMountedRef.current) {
            onError(taskProgressQuery.error);
          }
        }, 50); // Increased delay for more reliable async behavior
      }
    }
  }, [
    // FIXED: Minimized dependencies to essential ones
    taskProgressQuery.isSuccess, 
    taskProgressQuery.isError, 
    taskProgressQuery.isLoading, 
    isInitialLoading
  ]); // Removed onSuccess, onError from deps to prevent re-runs when they change
  // Removed data and error from deps array to prevent loops

  // Mutation to create a new task progress record
  const createTaskProgressMutation = useMutation<
    TaskProgressResponse, // Success response type
    Error,               // Error type
    {                    // Variables type
      weeklyPlanId: string;
      weekNumber: number;
      dayNumber: number;
      taskTitle: string;
    }
  >({
    mutationFn: async ({
      weeklyPlanId,
      weekNumber,
      dayNumber,
      taskTitle
    }) => {
      // Track write operation
      taskProgressTracker.trackWrite('task_progress', 1);
      
      return postFreshWithAuth(
        `/api/firebase/task-progress`,
        { weeklyPlanId, weekNumber, dayNumber, taskTitle },
        getToken
      );
    },
    onSuccess: (data: TaskProgressResponse) => {
      // Optimize by updating the cache directly instead of invalidating
      // This reduces the need for a refetch
      const currentData = queryClient.getQueryData([`/api/firebase/task-progress/${weeklyPlanId}`]) as any;
      
      if (currentData?.success && Array.isArray(currentData?.taskProgress) && data?.success && data?.taskProgress) {
        const updatedTaskProgress = [...currentData.taskProgress, data.taskProgress];
        
        // Update the cache with the new data
        queryClient.setQueryData(
          [`/api/firebase/task-progress/${weeklyPlanId}`],
          {
            ...currentData,
            taskProgress: updatedTaskProgress
          }
        );
      } else {
        // Fall back to invalidation if direct update fails
        // TEMPORARILY COMMENTED OUT FOR DEBUGGING
        // queryClient.invalidateQueries({
        //   queryKey: [`/api/firebase/task-progress/${weeklyPlanId}`],
        // });
        console.log('[Task Progress Debug] Cache invalidation disabled for debugging createTaskProgress');
      }
      
      if (onSuccess) {
        onSuccess('Task progress created successfully');
      }
    },
    onError: (error: Error) => {
      if (onError) {
        onError(error);
      }
    },
  });

  // Mutation to mark a task as in progress
  const startTaskMutation = useMutation<
    TaskProgressResponse, // Success response type
    Error,               // Error type
    {                    // Variables type
      taskId: string;
      progressData?: any;
      callback?: (data: TaskProgressResponse) => void;  // Add optional callback parameter
    }
  >({
    mutationFn: async ({
      taskId,
      progressData,
    }) => {
      // Track write operation
      taskProgressTracker.trackWrite('task_progress', 1);
      
      // Use patchFreshWithAuth instead of postFreshWithAuth to match server PATCH endpoint
      console.log('[Task Progress] Starting task with PATCH request:', {
        endpoint: `/api/firebase/task-progress/${taskId}/start`,
        taskId,
        hasProgressData: !!progressData
      });
      
      return patchFreshWithAuth(
        `/api/firebase/task-progress/${taskId}/start`,
        { progressData },
        getToken
      );
    },
    onSuccess: (data: TaskProgressResponse, variables) => {
      console.log('[startTaskMutation] Task started successfully:', data);
      
      // Clear any pending invalidation
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      
      // Optimistic update of cache
      const currentData = queryClient.getQueryData([`/api/firebase/task-progress/${weeklyPlanId}`]) as any;
      
      if (currentData?.success && Array.isArray(currentData?.taskProgress) && data?.success && data?.taskProgress) {
        // Use type assertion to handle the undefined check properly
        const responseTaskProgress = data.taskProgress as TaskProgress;
        
        // Find and update the task in the cache
        const updatedTaskProgress = currentData.taskProgress.map((task: TaskProgress) => 
          task.id === responseTaskProgress.id ? responseTaskProgress : task
        );
        
        // Update the cache with the new data
        queryClient.setQueryData(
          [`/api/firebase/task-progress/${weeklyPlanId}`],
          {
            ...currentData,
            taskProgress: updatedTaskProgress
          }
        );
      } else {
        // Fall back to invalidation if direct update fails - but completely disabled for now
        console.log('[Task Progress Debug] Cache invalidation disabled for debugging startTask');
      }
      
      // Set a debounced timeout for onSuccess callback
      debounceTimeoutRef.current = setTimeout(() => {
        // Only execute if component is still mounted
        if (componentMountedRef.current) {
          console.log('[startTaskMutation] Running debounced success callback');
          
          // Call the success callback if needed
          if (onSuccess) {
            onSuccess('Task marked as in progress');
          }
          
          // Call the optional callback from variables
          if (variables.callback) {
            variables.callback(data);
          }
        }
      }, 100);
    },
    onError: (error: Error) => {
      console.error('[startTaskMutation] Error:', error);
      
      // Clear any pending timeouts
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      
      // Set a debounced timeout for error callback
      debounceTimeoutRef.current = setTimeout(() => {
        if (componentMountedRef.current && onError) {
          onError(error);
        }
      }, 100);
    },
  });

  // Mutation to mark a task as completed
  const completeTaskMutation = useMutation<
    TaskProgressResponse, // Success response type
    Error,               // Error type
    {                    // Variables type
      taskId: string;
      progressData?: any;
    }
  >({
    mutationFn: async ({
      taskId,
      progressData,
    }) => {
      // Track write operation
      taskProgressTracker.trackWrite('task_progress', 1);
      
      return patchFreshWithAuth(
        `/api/firebase/task-progress/${taskId}/complete`,
        { progressData },
        getToken
      );
    },
    onSuccess: (data: TaskProgressResponse) => {
      // Optimize by updating the cache directly
      const currentData = queryClient.getQueryData([`/api/firebase/task-progress/${weeklyPlanId}`]) as any;
      
      if (currentData?.success && Array.isArray(currentData?.taskProgress) && data?.success && data?.taskProgress) {
        // Use type assertion to handle the undefined check properly
        const responseTaskProgress = data.taskProgress as TaskProgress;
        
        // Find and update the task in the cache
        const updatedTaskProgress = currentData.taskProgress.map((task: TaskProgress) => 
          task.id === responseTaskProgress.id ? responseTaskProgress : task
        );
        
        // Update the cache with the new data
        queryClient.setQueryData(
          [`/api/firebase/task-progress/${weeklyPlanId}`],
          {
            ...currentData,
            taskProgress: updatedTaskProgress
          }
        );
      } else {
        // Fall back to invalidation if direct update fails
        // TEMPORARILY COMMENTED OUT FOR DEBUGGING
        // queryClient.invalidateQueries({
        //   queryKey: [`/api/firebase/task-progress/${weeklyPlanId}`],
        // });
        console.log('[Task Progress Debug] Cache invalidation disabled for debugging completeTask');
      }
      
      if (onSuccess) {
        onSuccess('Task status updated successfully');
      }
    },
    onError: (error: Error) => {
      if (onError) {
        onError(error);
      }
    },
  });

  // Mutation to update the status of a task
  const updateTaskStatusMutation = useMutation<
    TaskProgressResponse, // Success response type
    Error,               // Error type
    {                    // Variables type
      taskId: string;
      status: 'not-started' | 'in-progress' | 'completed';
      progressData?: any;
    }
  >({
    mutationFn: async ({
      taskId,
      status,
      progressData,
    }) => {
      // Track write operation
      taskProgressTracker.trackWrite('task_progress', 1);
      
      return patchFreshWithAuth(
        `/api/firebase/task-progress/${taskId}/status`,
        { status, progressData },
        getToken
      );
    },
    onSuccess: (data: TaskProgressResponse) => {
      // Optimize by updating the cache directly
      const currentData = queryClient.getQueryData([`/api/firebase/task-progress/${weeklyPlanId}`]) as any;
      
      if (currentData?.success && Array.isArray(currentData?.taskProgress) && data?.success && data?.taskProgress) {
        // Use type assertion to handle the undefined check properly
        const responseTaskProgress = data.taskProgress as TaskProgress;
        
        // Find and update the task in the cache
        const updatedTaskProgress = currentData.taskProgress.map((task: TaskProgress) => 
          task.id === responseTaskProgress.id ? responseTaskProgress : task
        );
        
        // Update the cache with the new data
        queryClient.setQueryData(
          [`/api/firebase/task-progress/${weeklyPlanId}`],
          {
            ...currentData,
            taskProgress: updatedTaskProgress
          }
        );
      } else {
        // Fall back to invalidation if direct update fails
        // TEMPORARILY COMMENTED OUT FOR DEBUGGING
        // queryClient.invalidateQueries({
        //   queryKey: [`/api/firebase/task-progress/${weeklyPlanId}`],
        // });
        console.log('[Task Progress Debug] Cache invalidation disabled for debugging updateTaskStatus');
      }
      
      if (onSuccess) {
        onSuccess('Task status updated successfully');
      }
    },
    onError: (error: Error) => {
      if (onError) {
        onError(error);
      }
    },
  });

  // Create Promise-returning wrappers around mutation functions
  const createTaskProgressFn = (data: { weeklyPlanId: string; weekNumber: number; dayNumber: number; taskTitle: string }): Promise<TaskProgressResponse> => {
    return new Promise((resolve, reject) => {
      try {
        createTaskProgressMutation.mutate(data, {
          onSuccess: (response) => resolve(response),
          onError: (error) => reject(error)
        });
      } catch (error) {
        console.error('Error in createTaskProgress mutation:', error);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  // Memoize the startTaskFn to prevent it from changing on each render
  const startTaskFn = useCallback((data: { taskId: string; progressData?: any }): Promise<TaskProgressResponse> => {
    // Debug log when the function is called (not recreated)
    console.log('[Task Progress] startTaskFn called with taskId:', data.taskId);
    
    return new Promise((resolve, reject) => {
      try {
        startTaskMutation.mutate({
          ...data,
          callback: (response) => resolve(response)
        }, {
          // These handlers are now redundant with our debounced callbacks
          // but keeping them for backward compatibility
          onSuccess: (response) => resolve(response),
          onError: (error) => reject(error)
        });
      } catch (error) {
        console.error('Error in startTask mutation:', error);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }, [startTaskMutation]); // Only depend on the mutation itself

  const completeTaskFn = (data: { taskId: string; progressData?: any }): Promise<TaskProgressResponse> => {
    return new Promise((resolve, reject) => {
      try {
        completeTaskMutation.mutate(data, {
          onSuccess: (response) => resolve(response),
          onError: (error) => reject(error)
        });
      } catch (error) {
        console.error('Error in completeTask mutation:', error);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const updateTaskStatusFn = (data: { taskId: string; status: 'not-started' | 'in-progress' | 'completed'; progressData?: any }): Promise<TaskProgressResponse> => {
    return new Promise((resolve, reject) => {
      try {
        updateTaskStatusMutation.mutate(data, {
          onSuccess: (response) => resolve(response),
          onError: (error) => reject(error)
        });
      } catch (error) {
        console.error('Error in updateTaskStatus mutation:', error);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  // Return the data, status flags, and operations
  return {
    taskProgress: taskProgressQuery.data || [],
    isLoading: taskProgressQuery.isLoading || isInitialLoading,
    isFetching: taskProgressQuery.isFetching || false,
    error: taskProgressQuery.error,
    refetch: taskProgressQuery.refetch,
    
    // Provide Promise-returning task progress operations
    createTaskProgress: createTaskProgressFn,
    startTask: startTaskFn,
    completeTask: completeTaskFn,
    updateTaskStatus: updateTaskStatusFn,
    
    // Combined update status flag
    isUpdating: createTaskProgressMutation.isPending || 
                startTaskMutation.isPending || 
                completeTaskMutation.isPending || 
                updateTaskStatusMutation.isPending,
  };
}

// Create a tracker for this hook
const initTaskProgressTracker = createComponentTracker('useInitializeTaskProgress');

// Hook to initialize task progress records for a weekly plan
export function useInitializeTaskProgress(weeklyPlanId: string, tasks: any[]) {
  const { getToken } = useFirebaseAuthContext();
  const queryClient = useQueryClient();

  // Mutation to create multiple task progress records
  const initializeTasksMutation = useMutation({
    mutationFn: async (weekNumber: number) => {
      // Track the batch operation - note we're creating multiple records
      initTaskProgressTracker.trackWrite('task_progress', tasks.length);
      
      return postFreshWithAuth(
        `/api/firebase/task-progress/initialize/${weeklyPlanId}`,
        { weekNumber, tasks },
        getToken
      );
    },
    onSuccess: () => {
      // TEMPORARILY COMMENTED OUT FOR DEBUGGING
      // queryClient.invalidateQueries({
      //   queryKey: [`/api/firebase/task-progress/${weeklyPlanId}`],
      // });
      console.log('[Task Progress Debug] Cache invalidation disabled for debugging initializeTasksMutation');
    }
  });

  // Return a function that initializes the tasks
  return {
    initializeTasks: (weekNumber: number) => initializeTasksMutation.mutate(weekNumber),
    isInitializing: initializeTasksMutation.isPending,
  };
}