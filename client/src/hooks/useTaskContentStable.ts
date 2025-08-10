import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getQueryFn } from "@/lib/queryClient";
import { sharedTracker } from "@/lib/trackers";

// Mock API response types for type safety
type ApiResponse = Response | { ok?: boolean; status?: number; statusText?: string; json?: () => Promise<any> } | null;

// Task content data structure
export interface TaskContent {
  id: string;
  scriptText: string;
  audioUrl: string;
  questions: Array<{
    id: string;
    question: string;
    options?: Array<{ id: string; text: string }>;
    correctAnswer?: string;
    explanation?: string;
  }>;
  accent: string;
  duration: number;
  replayLimit: number;
}

// Options for the hook
interface UseTaskContentOptions {
  enabled?: boolean;
}

/**
 * Custom hook to fetch task content
 * Optimized version with more efficient caching and error handling
 * 
 * @param taskId ID of the task to fetch content for
 * @param options Additional options for the query
 */
export function useTaskContent(
  taskId: string,
  options: UseTaskContentOptions = {}
) {
  // Memoize the query key to prevent unnecessary re-renders
  const queryKey = useMemo(() => {
    return [`/api/firebase/task-content/${taskId}`];
  }, [taskId]);

  // Query for task content
  return useQuery({
    queryKey,
    queryFn: async () => {
      // DISABLED FOR RENDER LOOP TESTING
      console.log('[Hook DIAG] useTaskContent.queryFn DISABLED for render loop testing');
      
      // Return mock data without making any API calls
      return {
        id: 'mock-id',
        scriptText: 'This is a mock listening script for testing purposes.',
        audioUrl: '',
        questions: [
          {
            id: 'q1',
            question: 'Mock question 1?',
            options: [
              { id: 'a', text: 'Option A' },
              { id: 'b', text: 'Option B' },
              { id: 'c', text: 'Option C' }
            ],
            correctAnswer: 'a',
            explanation: 'This is a mock explanation.'
          }
        ],
        accent: 'British',
        duration: 120,
        replayLimit: 3
      };
    },
    // All reactive behaviors are DISABLED
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    // Force disabled for render loop testing
    enabled: false
  });
}

/**
 * Hook to update task content (for admin/authoring purposes)
 * DISABLED FOR RENDER LOOP TESTING
 */
export function useUpdateTaskContent() {
  return {
    updateContent: async () => {
      console.log('[Hook DIAG] useUpdateTaskContent DISABLED for render loop testing');
      return { success: true };
    },
    isUpdating: false
  };
}