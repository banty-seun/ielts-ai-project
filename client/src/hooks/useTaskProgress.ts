import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryClient } from "@/lib/queryClient";

const DEBUG = Boolean((window as any).__DEBUG__);

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
  progressId?: string;   // Specific progress ID for individual task
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
  data: TaskProgress | null;
  status: 'loading' | 'error' | 'success';
  error: Error | null;
  startTask: (data: { taskId: string; progressData?: any }) => Promise<TaskProgressResponse>;
  completeTask: (data: { taskId: string; progressData?: any }) => Promise<TaskProgressResponse>;
}

/**
 * Simplified hook to manage task progress
 * @param options Hook configuration options
 */
export function useTaskProgress(options: UseTaskProgressOptions = {}): UseTaskProgressResult {
  const { progressId, enabled = true } = options;

  // Query for task progress
  const query = useQuery({
    queryKey: ['/api/firebase/task-progress', progressId],
    enabled: Boolean(progressId && enabled),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  // Start task mutation
  const startTaskMutation = useMutation({
    mutationFn: async (data: { taskId: string; progressData?: any }) => {
      if (DEBUG) console.log('[useTaskProgress] Starting task:', data.taskId);
      
      const response = await fetch(`/api/firebase/task-progress/${data.taskId}/start`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressData: data.progressData })
      });
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['/api/firebase/task-progress'] });
    }
  });

  // Complete task mutation  
  const completeTaskMutation = useMutation({
    mutationFn: async (data: { taskId: string; progressData?: any }) => {
      if (DEBUG) console.log('[useTaskProgress] Completing task:', data.taskId);
      
      const response = await fetch(`/api/firebase/task-progress/${data.taskId}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressData: data.progressData })
      });
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['/api/firebase/task-progress'] });
    }
  });

  const startTask = useCallback((data: { taskId: string; progressData?: any }) => {
    return startTaskMutation.mutateAsync(data);
  }, [startTaskMutation]);

  const completeTask = useCallback((data: { taskId: string; progressData?: any }) => {
    return completeTaskMutation.mutateAsync(data);
  }, [completeTaskMutation]);

  return {
    data: query.data || null,
    status: query.status,
    error: query.error,
    startTask,
    completeTask
  };
}