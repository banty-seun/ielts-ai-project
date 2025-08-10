import { useQuery } from '@tanstack/react-query';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { useRef } from 'react';
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

  // DEBUG: Log the enabled condition breakdown
  const enabledCondition = !!taskId && taskId !== 'mock-id' && taskId !== 'undefined' && !authLoading && isGetTokenValid && !hasFetchedRef.current;
  
  console.log('[useTaskContent] Hook enabled condition check:', {
    taskId,
    hasTaskId: !!taskId,
    isNotMockId: taskId !== 'mock-id',
    isNotUndefined: taskId !== 'undefined',
    authNotLoading: !authLoading,
    getTokenValid: isGetTokenValid,
    notAlreadyFetched: !hasFetchedRef.current,
    finalEnabled: enabledCondition
  });

  return useQuery<TaskContent>({
    queryKey: [`/api/firebase/task-content/${taskId}`],
    enabled: enabledCondition,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity, // Never consider data stale
    retry: 0, // Don't retry at all
    queryFn: async (): Promise<TaskContent> => {
      if (!taskId || taskId === 'undefined') {
        console.warn('[useTaskContent] Query function called with invalid taskId:', taskId);
        throw new Error('Task ID is required and must be valid');
      }
      
      // Add one-time network fetch log
      console.log('[useTaskContent] NETWORK FETCH - this should only appear once');
      console.log(`[useTaskContent] Fetching content for task ID: ${taskId}`);
      
      // Double-check getToken is a function before trying to use it
      if (typeof getToken !== 'function') {
        // Mark as fetched to prevent retries
        hasFetchedRef.current = true;
        throw new Error('Authentication not initialized - getToken is not available');
      }
      
      try {
        console.log('[TASK ROUTING] useTaskContent making API call:', {
          taskId,
          endpoint: `/api/firebase/task-content/${taskId}`,
          hasTaskId: !!taskId,
          taskIdLength: taskId?.length || 0
        });
        
        // Pass getToken function directly (not the result of calling it)
        // getFreshWithAuth returns parsed JSON data, not a Response object
        let apiData: TaskContentApiResponse;
        try {
          apiData = await getFreshWithAuth<TaskContentApiResponse>(`/api/firebase/task-content/${taskId}`, getToken);
          console.log('[useTaskContent] getFreshWithAuth completed successfully with parsed data:', {
            hasData: !!apiData,
            dataType: typeof apiData,
            taskId
          });
        } catch (fetchError: any) {
          console.error('[useTaskContent] getFreshWithAuth failed:', {
            error: fetchError,
            message: fetchError?.message,
            name: fetchError?.name,
            status: fetchError?.status,
            taskId
          });
          
          // getFreshWithAuth throws errors for non-OK responses
          // Check if it's a 404 or 403 error based on the error status
          if (fetchError?.status === 404 || fetchError?.status === 403) {
            console.warn(`[useTaskContent] Content for task ID ${taskId} not found or forbidden (${fetchError.status}), returning null`);
            throw new Error(`Content not available: ${fetchError.status === 403 ? 'Access denied' : 'Not found'}`);
          }
          
          // For other errors, use the error message from getFreshWithAuth
          const errorMessage = fetchError?.message || 'Unknown fetch error';
          const finalError = `Failed to fetch task content (${taskId}): ${errorMessage}`;
          console.error('[useTaskContent] Throwing error:', finalError);
          throw new Error(finalError);
        }
        
        // Mark as fetched immediately after fetch completes
        hasFetchedRef.current = true;
        
        // RAW API DATA INVESTIGATION - Log unmodified apiData
        console.log('=== RAW API DATA INVESTIGATION ===');
        console.log('[RAW API] Complete unmodified apiData received from backend:');
        console.log('[RAW API]', JSON.stringify(apiData, null, 2));
        console.log('[RAW API] Data type:', typeof apiData);
        console.log('[RAW API] Object keys:', Object.keys(apiData || {}));
        
        // Investigate success field
        console.log('[RAW API] Has success field:', 'success' in apiData);
        console.log('[RAW API] Success value:', apiData.success);
        console.log('[RAW API] Success type:', typeof apiData.success);
        
        // Investigate taskContent field
        console.log('[RAW API] Has taskContent field:', 'taskContent' in apiData);
        console.log('[RAW API] taskContent value:', apiData.taskContent);
        console.log('[RAW API] taskContent type:', typeof apiData.taskContent);
        console.log('[RAW API] taskContent is null:', apiData.taskContent === null);
        console.log('[RAW API] taskContent is undefined:', apiData.taskContent === undefined);
        
        if (apiData.taskContent && typeof apiData.taskContent === 'object') {
          console.log('[RAW API] taskContent object keys:', Object.keys(apiData.taskContent));
          
          // Investigate questions field specifically
          console.log('[RAW API] taskContent.questions exists:', 'questions' in apiData.taskContent);
          console.log('[RAW API] taskContent.questions value:', apiData.taskContent.questions);
          console.log('[RAW API] taskContent.questions type:', typeof apiData.taskContent.questions);
          console.log('[RAW API] taskContent.questions is array:', Array.isArray(apiData.taskContent.questions));
          if (Array.isArray(apiData.taskContent.questions)) {
            console.log('[RAW API] taskContent.questions length:', apiData.taskContent.questions.length);
            console.log('[RAW API] taskContent.questions items:', apiData.taskContent.questions);
            
            // Inspect first question structure if exists
            if (apiData.taskContent.questions.length > 0) {
              console.log('[RAW API] First question structure:', apiData.taskContent.questions[0]);
              console.log('[RAW API] First question keys:', Object.keys(apiData.taskContent.questions[0] || {}));
            }
          }
          
          // Investigate audioUrl field specifically
          console.log('[RAW API] taskContent.audioUrl exists:', 'audioUrl' in apiData.taskContent);
          console.log('[RAW API] taskContent.audioUrl value:', apiData.taskContent.audioUrl);
          console.log('[RAW API] taskContent.audioUrl type:', typeof apiData.taskContent.audioUrl);
          console.log('[RAW API] taskContent.audioUrl is string:', typeof apiData.taskContent.audioUrl === 'string');
          console.log('[RAW API] taskContent.audioUrl is empty:', apiData.taskContent.audioUrl === '');
          console.log('[RAW API] taskContent.audioUrl is null:', apiData.taskContent.audioUrl === null);
          console.log('[RAW API] taskContent.audioUrl length:', apiData.taskContent.audioUrl ? apiData.taskContent.audioUrl.length : 'N/A');
          
          // Investigate other critical fields
          console.log('[RAW API] taskContent.id:', apiData.taskContent.id);
          console.log('[RAW API] taskContent.scriptText:', apiData.taskContent.scriptText);
          console.log('[RAW API] taskContent.duration:', apiData.taskContent.duration);
          console.log('[RAW API] taskContent.status:', apiData.taskContent.status);
          console.log('[RAW API] taskContent.accent:', apiData.taskContent.accent);
          console.log('[RAW API] taskContent.replayLimit:', apiData.taskContent.replayLimit);
          
          console.log('[RAW API] Complete taskContent object structure:');
          console.log('[RAW API]', JSON.stringify(apiData.taskContent, null, 2));
        }
        
        // Investigate message field if present
        if ('message' in apiData) {
          console.log('[RAW API] Has message field:', apiData.message);
        }
        
        console.log('=== END RAW API DATA INVESTIGATION ===');
        
        // Validate required fields are present
        if (!apiData || typeof apiData !== 'object') {
          const errorMsg = `API returned invalid data type: ${typeof apiData}`;
          console.error('[useTaskContent] Error:', errorMsg);
          throw new Error(errorMsg);
        }
        
        if (!apiData.success) {
          const errorMsg = apiData.message || 'API request was not successful';
          console.error('[useTaskContent] Error:', errorMsg);
          throw new Error(errorMsg);
        }
        
        if (!apiData.taskContent) {
          const errorMsg = 'No task content returned from API';
          console.error('[useTaskContent] Error:', errorMsg);
          throw new Error(errorMsg);
        }
        
        if (!apiData.taskContent.id) {
          const errorMsg = 'taskContent missing required id field';
          console.error('[useTaskContent] Error:', errorMsg);
          throw new Error(errorMsg);
        }
        
        // Transform API response to match Practice component expectations
        const transformedData: TaskContent = {
          id: apiData.taskContent.id,
          scriptText: apiData.taskContent.scriptText || null,
          audioUrl: apiData.taskContent.audioUrl || null,
          questions: Array.isArray(apiData.taskContent.questions) ? apiData.taskContent.questions : [],
          accent: apiData.taskContent.accent || 'British',
          duration: typeof apiData.taskContent.duration === 'number' ? apiData.taskContent.duration : 0,
          replayLimit: typeof apiData.taskContent.replayLimit === 'number' ? apiData.taskContent.replayLimit : 3
        };
        
        console.log('[useTaskContent] Transformed data:', JSON.stringify(transformedData, null, 2));
        return transformedData;
      } catch (err: any) {
        // Mark as fetched even on error to prevent retries
        hasFetchedRef.current = true;
        
        // Enhanced error logging for debugging
        console.error('[useTaskContent] Error caught:', {
          error: err,
          message: err?.message,
          name: err?.name,
          stack: err?.stack,
          taskId
        });
        
        // Provide more specific error messages based on error type
        let errorMessage = 'Unknown error';
        if (err?.message) {
          errorMessage = err.message;
        } else if (err?.name === 'TypeError' && err?.message?.includes('fetch')) {
          errorMessage = 'Network connection failed';
        } else if (err?.name === 'AbortError') {
          errorMessage = 'Request was cancelled';
        }
        
        // Final error with task context
        const finalError = `Failed to fetch task content (${taskId}): ${errorMessage}`;
        console.error('[useTaskContent] Final error being thrown:', finalError);
        throw new Error(finalError);
      }
    }
  });
}