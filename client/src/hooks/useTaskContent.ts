import { useQuery } from '@tanstack/react-query';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { useRef, useEffect } from 'react';
import { getFreshWithAuth } from '@/lib/apiClient';

// Define TaskContent type to match what Practice component expects after transformation
export type TaskContent = {
  id: string;
  scriptText: string | null;
  audioUrl: string | null;
  questions: any[];
  accent: string;
  duration: number;
  replayLimit: number;
};

// Define the raw API response type
type TaskContentApiResponse = {
  success: boolean;
  taskContent: {
    id: string;
    scriptText: string;
    audioUrl: string | null;
    duration: number | null;
    status: 'pending' | 'generated' | 'failed';
    accent: string;
    replayLimit?: number;
    questions?: any[];
  } | null;
  message?: string;
};

/**
 * Hook to fetch task content (script, audio URL, questions, etc.) for a specific task
 * @param options Options object or taskId string
 */
export function useTaskContent(options: { taskId: string } | string | null | undefined) {
  // Handle both string and options object
  const taskId = typeof options === 'string' ? options : options?.taskId;
  const { getToken, loading: authLoading, currentUser } = useFirebaseAuthContext();
  
  // Add hasFetchedRef to track if we've already fetched
  const hasFetchedRef = useRef(false);
  
  // Verify if getToken is properly initialized and a function
  const isGetTokenValid = typeof getToken === 'function';
  
  // Debug logging for development mode only
  if (!isGetTokenValid) {
    console.warn('[useTaskContent] getToken is not a function:', {
      getTokenType: typeof getToken,
      authLoading,
      hasUser: !!currentUser
    });
  }

  // Reset hasFetchedRef whenever taskId changes to avoid stale blocking
  useEffect(() => {
    hasFetchedRef.current = false;
    console.log('[useTaskContent] taskId changed; reset hasFetchedRef=false', { taskId });
  }, [taskId]);

  // Guard logging before useQuery
  console.log('[useTaskContent][guards][pre] taskId, authLoading, isGetTokenValid, hasFetchedRef', {
    taskId,
    validTaskId: !!taskId && taskId !== 'mock-id' && taskId !== 'undefined',
    authLoading,
    isGetTokenValid,
    hasFetched: hasFetchedRef.current,
  });

  return useQuery<TaskContent>({
    queryKey: ['/api/firebase/task-content', taskId],
    enabled: Boolean(taskId && taskId !== 'mock-id' && taskId !== 'undefined' && !authLoading && isGetTokenValid),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always', // ensure it runs when the page is opened
    staleTime: 0, // force a real fetch the first time
    retry: 0,
    queryFn: async (): Promise<TaskContent> => {
      if (!taskId) throw new Error('Task ID is required');

      console.log('[useTaskContent] NETWORK FETCH start', { taskId });

      if (typeof getToken !== 'function') {
        throw new Error('Authentication not initialized - getToken is not available');
      }

      const response: Response = await getFreshWithAuth(`/api/firebase/task-content/${taskId}`, getToken);

      // Only now mark as fetched (after successful fetch)
      hasFetchedRef.current = true;
      console.log('[useTaskContent] NETWORK FETCH done; set hasFetchedRef=true', { taskId, status: response.status });

      if (!response.ok) {
        let errorMessage = response.statusText || 'Unknown error';
        try {
          const errorData = await response.json();
          errorMessage = errorData?.message || JSON.stringify(errorData);
        } catch {}
        throw new Error(`Failed to fetch task content (${response.status}): ${errorMessage}`);
      }

      const data = await response.json();
      console.log('[useTaskContent] JSON parsed OK', { success: data?.success, hasTaskContent: !!data?.taskContent });

      if (!data?.success) throw new Error('API returned success: false');
      if (!data?.taskContent) throw new Error('API response missing taskContent');

      return data;
    },

    select: (data: any): TaskContent => {
      // Extra guard logs
      console.log('[useTaskContent][select] raw:', data);

      if (!data?.taskContent?.id) {
        console.warn('[useTaskContent][select] invalid taskContent shape', {
          hasTaskContent: !!data?.taskContent,
          id: data?.taskContent?.id,
        });
        // Return a fallback TaskContent instead of null
        return {
          id: 'fallback',
          scriptText: null,
          audioUrl: null,
          questions: [],
          accent: 'British',
          duration: 0,
          replayLimit: 3
        };
      }

      const result = {
        id: data.taskContent.id,
        title: data.taskContent.title ?? null,
        description: data.taskContent.description ?? null,
        scriptText: data.taskContent.scriptText ?? null,
        audioUrl: data.taskContent.audioUrl ?? null,   // allow null; UI shows "generating..."
        questions: Array.isArray(data.taskContent.questions) ? data.taskContent.questions : [],
        accent: data.taskContent.accent ?? 'British',
        duration: typeof data.taskContent.duration === 'number' ? data.taskContent.duration : 0,
        replayLimit: typeof data.taskContent.replayLimit === 'number' ? data.taskContent.replayLimit : 3,
      };

      console.log('[useTaskContent][select] transformed:', result);
      return result;
    },
  });
}