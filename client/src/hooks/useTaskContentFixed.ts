import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from '@/hooks/use-toast';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { getFreshWithAuth, patchFreshWithAuth } from '@/lib/apiClient';
import { createComponentTracker } from '@/lib/firestoreTracker';

// Define Response type to fix TypeScript errors
type ApiResponse = Response | { ok?: boolean; status?: number; statusText?: string; json?: () => Promise<any> } | null;

// Create a component tracker
const taskContentTracker = createComponentTracker('useTaskContent');

// Type for task content response
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

// Default null return value to avoid conditionally returning different shapes
const defaultQueryResult = {
  data: null,
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: async () => ({})
};

/**
 * Hook to fetch task content (script, audio URL, questions, etc.) for a specific task
 * Optimized version with improved error handling and prevent render loops
 * 
 * @param taskId The ID of the task to fetch content for
 */
// Options interface for useTaskContent hook
interface UseTaskContentOptions {
  enabled?: boolean;
}

export function useTaskContent(
  taskId: string | null | undefined, 
  options: UseTaskContentOptions = {}
) {
  // DIAGNOSTIC: Log hook execution
  console.log('[Hook DIAG] useTaskContentFixed triggered with taskId:', taskId);
  
  // Early return if no taskId provided
  if (!taskId) {
    return defaultQueryResult;
  }
  
  const { getToken, loading: authLoading, currentUser } = useFirebaseAuthContext();
  const queryClient = useQueryClient();
  const componentMountedRef = useRef<boolean>(true);
  const hookInitCountRef = useRef(0);
  
  // Verify if getToken is properly initialized and a function
  const isGetTokenValid = typeof getToken === 'function';
  
  // Track hook initialization for debugging
  useEffect(() => {
    hookInitCountRef.current += 1;
    console.log(`[useTaskContentFixed] Hook initialized #${hookInitCountRef.current} for taskId: ${taskId}`);
    
    // Set mounted flag
    componentMountedRef.current = true;
    
    return () => {
      // Clear mounted flag on unmount
      componentMountedRef.current = false;
      console.log(`[useTaskContentFixed] Hook cleanup after ${hookInitCountRef.current} initializations`);
    };
  }, [taskId]);
  
  // Debug logging for development mode only
  if (!isGetTokenValid) {
    console.warn('[useTaskContentFixed] getToken is not a function:', {
      getTokenType: typeof getToken,
      authLoading,
      hasUser: !!currentUser
    });
  }

  // Memoize the query key to prevent unnecessary re-renders
  // Using useMemo instead of useCallback to memoize the full array
  const queryKey = useMemo(() => [`/api/firebase/task-content/${taskId}`], [taskId]);

  return useQuery({
    queryKey,
    queryFn: async () => {
      // DIAGNOSTIC: Log query function execution - DISABLED for render loop testing
      console.log('[Hook DIAG] useTaskContent.queryFn DISABLED for render loop testing');
      
      // Return mock data without any API calls or external dependencies
      return {
        success: true,
        taskContent: {
          id: typeof taskId === 'string' ? taskId : 'mock-id',
          scriptText: "This is mock content for debugging purposes.",
          audioUrl: "",
          questions: [],
          accent: "British",
          duration: 0,
          replayLimit: 3
        }
      };
    },
    // FORCE DISABLED for render loop testing
    enabled: false,
    staleTime: Infinity, // Prevent any stale time refetches
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: false, // Disable all retries for render loop testing
    select: (data: any) => {
      // DIAGNOSTIC: Log select function execution
      console.log('[Hook DIAG] useTaskContent.select executing with data:',
                 data?.success ? 'success' : 'no success',
                 data?.taskContent ? 'has content' : 'no content');
      
      if (!data?.success || !data?.taskContent) return null;
      
      return {
        id: data.taskContent.id,
        scriptText: data.taskContent.scriptText,
        audioUrl: data.taskContent.audioUrl,
        questions: data.taskContent.questions || [],
        accent: data.taskContent.accent || 'British',
        duration: data.taskContent.duration || 0,
        replayLimit: data.taskContent.replayLimit || 3
      };
    }
  });
}

/**
 * Hook to update task content (for admin/authoring purposes)
 * Optimized version with better error handling
 */
export function useUpdateTaskContent() {
  const { getToken, loading: authLoading, currentUser } = useFirebaseAuthContext();
  const queryClient = useQueryClient();
  const componentMountedRef = useRef<boolean>(true);
  
  // Set mounted flag on mount, clear on unmount
  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
    };
  }, []);
  
  // Verify if getToken is properly initialized and a function
  const isGetTokenValid = typeof getToken === 'function';
  
  return useMutation({
    mutationFn: async ({
      taskId,
      contentUpdate
    }: {
      taskId: string;
      contentUpdate: {
        scriptText?: string;
        audioUrl?: string;
        questions?: Array<{
          id: string;
          question: string;
          options?: Array<{ id: string; text: string }>;
          correctAnswer?: string;
          explanation?: string;
        }>;
        accent?: string;
        duration?: number;
        replayLimit?: number;
      };
    }) => {
      // DISABLED FOR RENDER LOOP TESTING
      console.log('[Hook DIAG] useUpdateTaskContent.mutationFn DISABLED for render loop testing');
      
      // Return mock success without making API calls
      return { success: true };
    },
    onSuccess: (data, variables) => {
      // DISABLED FOR RENDER LOOP TESTING
      console.log('[Hook DIAG] useUpdateTaskContent.onSuccess DISABLED for render loop testing');
      
      // No-op - don't trigger any cache invalidation or state changes
    },
    onError: (error: Error) => {
      // DISABLED FOR RENDER LOOP TESTING
      console.log('[Hook DIAG] useUpdateTaskContent.onError DISABLED for render loop testing');
      
      // No-op - don't trigger any UI updates or state changes
    },
  });
}