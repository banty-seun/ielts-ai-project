import { useQuery } from '@tanstack/react-query';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { useRef, useEffect } from 'react';
import { getFreshWithAuth } from '@/lib/apiClient';

// Define TaskContent type to match what Practice component expects after transformation
export type TaskContent = {
  id: string;
  title?: string | null;
  scriptText: string | null;
  audioUrl: string | null;
  questions: any[];
  accent: string;
  duration: number;
  replayLimit: number;
  _status?: "empty" | "readyish";
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

  const query = useQuery<TaskContent>({
    queryKey: ['/api/firebase/task-content', taskId],
    enabled: Boolean(taskId && taskId !== 'mock-id' && taskId !== 'undefined' && !authLoading && isGetTokenValid),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always', // ensure it runs when the page is opened
    staleTime: 0, // force a real fetch the first time
    retry: 0,
    queryFn: async (): Promise<TaskContent> => {
      console.log('[useTaskContent] QUERYFN START for', taskId);
      
      if (!taskId) throw new Error('Task ID is required');

      if (typeof getToken !== 'function') {
        throw new Error('Authentication not initialized - getToken is not available');
      }

      const endpoint = `/api/firebase/task-content/${taskId}`;
      
      // 2) Instrument client fetch - log before parsing
      console.log('[UTC][start]', { endpoint, taskId });
      const res = await getFreshWithAuth(endpoint, getToken);
      
      // Guard against undefined response
      if (!res) {
        console.error('[UTC] getFreshWithAuth returned undefined/null', { endpoint });
        throw new Error('getFreshWithAuth returned undefined');
      }
      
      const ct = res.headers?.get ? res.headers.get('content-type') : null;
      console.log('[UTC][res]', {
        hasRes: !!res,
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        ct
      });
      
      const raw = await res.clone().text();
      console.log('[UTC][raw]', raw?.slice(0, 400));
      
      // Only now mark as fetched (after successful fetch)
      hasFetchedRef.current = true;
      console.log('[useTaskContent] NETWORK FETCH done; set hasFetchedRef=true', { taskId, status: res.status });

      if (!res.ok) {
        let errorMessage = res.statusText || 'Unknown error';
        try {
          const errorData = await res.clone().json();
          errorMessage = errorData?.message || JSON.stringify(errorData);
        } catch {}
        // 2) Include status in thrown message for better debugging
        throw new Error(`status=${res.status} msg=${errorMessage}`);
      }

      const data = await res.json();
      console.log('[useTaskContent] JSON parsed OK', { success: data?.success, hasTaskContent: !!data?.taskContent });

      if (!data?.success) throw new Error('API returned success: false');
      if (!data?.taskContent) throw new Error('API response missing taskContent');

      return data;
    },

    select: (data: any) => {
      if (!data || data.success !== true) throw new Error("API success=false or empty");
      const c = data.taskContent;
      if (!c || !c.id) {
        return {
          id: String(taskId),
          title: data.title ?? null,
          scriptText: null,
          audioUrl: null,
          questions: [],
          accent: "British",
          duration: 0,
          replayLimit: 3,
          _status: "empty"
        };
      }
      return {
        id: c.id,
        title: c.taskTitle ?? data.title ?? null,
        scriptText: c.scriptText ?? null,
        audioUrl: c.audioUrl ?? null,
        questions: Array.isArray(c.questions) ? c.questions : [],
        accent: c.accent ?? "British",
        duration: typeof c.duration === "number" ? c.duration : 0,
        replayLimit: typeof c.replayLimit === "number" ? c.replayLimit : 3,
        _status: "readyish"
      };
    }
  });

  // Log live query state
  console.log("[useTaskContent][state]", {
    status: query.status,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isSuccess: query.isSuccess,
    isError: query.isError,
    hasData: !!query.data,
    error: (query.error as any)?.message
  });

  return query;
}