import { useQuery } from '@tanstack/react-query';
import { getFreshWithAuth } from '@/lib/apiClient';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';

const DEBUG = Boolean((window as any).__DEBUG__);

export type TaskContent = {
  id: string;
  title?: string | null;
  scenario?: string | null;
  conversationType?: string | null;
  scriptText?: string | null;
  audioUrl?: string | null;
  questions?: any[];
};

type ApiResponse = { 
  success: true; 
  taskContent: any;
} | { 
  success: false; 
  message?: string; 
};

export function useTaskContent(taskId: string | null | undefined) {
  const { getToken, loading: authLoading } = useFirebaseAuthContext();

  return useQuery({
    queryKey: ['/api/firebase/task-content', taskId],
    enabled: Boolean(taskId && !authLoading && typeof getToken === 'function'),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    queryFn: async (): Promise<TaskContent> => {
      if (!taskId) throw new Error('Task ID is required');

      if (DEBUG) console.log('[useTaskContent] Fetching content for task:', taskId);

      const res = await getFreshWithAuth(`/api/firebase/task-content/${taskId}`, getToken);

      if (!res.ok) {
        throw new Error(`Failed to load task content (${res.status})`);
      }

      const data: ApiResponse = await res.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to load task content');
      }

      // Normalize the response - never return null, always return a valid shape
      const taskContent = data.taskContent || {};
      
      return {
        id: taskContent.id || taskId,
        title: taskContent.taskTitle || taskContent.title || null,
        scenario: taskContent.scenario || null,
        conversationType: taskContent.conversationType || null,
        scriptText: taskContent.scriptText || null,
        audioUrl: taskContent.audioUrl || null,
        questions: Array.isArray(taskContent.questions) ? taskContent.questions : []
      };
    }
  });
}