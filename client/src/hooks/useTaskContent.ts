import { useQuery } from '@tanstack/react-query';
import { getFreshWithAuth } from '@/lib/apiClient';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';

// Debug toggle
const DEBUG = Boolean((window as any).__DEBUG__);

export type TaskContent = {
  id: string;
  title: string | null;
  scenario: string | null;
  conversationType: string | null;
  scriptText: string | null;
  audioUrl: string | null;
  questions: any[];
  accent?: string | null;
  duration?: number | 0;
  replayLimit?: number | 3;
};

type ApiOk = { success: true; taskContent: any };
type ApiErr = { success: false; message?: string };

export function useTaskContent(
  taskId?: string | null,
  opts?: { enabled?: boolean }
) {
  const { getToken, loading: authLoading } = useFirebaseAuthContext();
  const enabled = opts?.enabled ?? Boolean(taskId && !authLoading && typeof getToken === 'function');

  return useQuery({
    queryKey: [`/api/firebase/task-content/${taskId}`],
    enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
    retry: 1,
    queryFn: async (): Promise<ApiOk> => {
      if (!taskId) throw new Error('Task ID is required');

      // Call API (getFreshWithAuth ALWAYS returns Response or throws)
      const res = await getFreshWithAuth(`/api/firebase/task-content/${taskId}`, getToken);

      if (!res.ok) {
        // Rich error message using json/text fallback
        let details = '';
        try {
          const ct = res?.headers?.get ? res.headers.get('content-type') : null;
          if (ct && ct.includes('application/json')) {
            const j = await res.clone().json();
            details = j?.message ? ` - ${j.message}` : ` - ${JSON.stringify(j)}`;
          } else {
            const t = await res.clone().text();
            details = t ? ` - ${t.slice(0, 300)}` : '';
          }
        } catch {
          // swallow parse errors
        }
        throw new Error(`Task content request failed (${res.status})${details}`);
      }

      // Parse JSON, clone first so body is not consumed by any future readers
      let data: ApiOk | ApiErr;
      try {
        data = await res.clone().json();
      } catch (e: any) {
        const txt = await res.text().catch(() => '');
        throw new Error(
          `Failed to parse task content JSON: ${e?.message ?? 'unknown'}${txt ? ` | raw="${txt.slice(0, 180)}"` : ''}`
        );
      }

      // Must have success true + taskContent object; otherwise treat like API error
      if (!(data as ApiOk)?.success) {
        const msg = (data as ApiErr)?.message || 'API returned success:false';
        throw new Error(msg);
      }

      // Add a guard log before returning from queryFn:
      if (DEBUG) {
        console.log('[useTaskContent][returning]', {
          ok: true,
          hasTaskContent: Boolean((data as ApiOk)?.taskContent),
          id: (data as ApiOk)?.taskContent?.id ?? taskId,
        });
      }

      if (!(data as any).taskContent) {
        // Return empty skeleton instead of throwing—UI will show "preparing"
        return { success: true, taskContent: { id: String(taskId), scriptText: null, audioUrl: null, questions: [] } } as ApiOk;
      }

      return data as ApiOk;
    },
    select: (data: any) => {
      const tc = data?.taskContent ?? {};
      return {
        id: typeof tc.id === 'string' ? tc.id : taskId,
        title: tc.taskTitle ?? tc.title ?? null,
        scenario: tc.scenario ?? null,
        conversationType: tc.conversationType ?? null,
        scriptText: tc.scriptText ?? null,
        audioUrl: tc.audioUrl ?? null,
        questions: Array.isArray(tc.questions) ? tc.questions : [],
        accent: tc.accent ?? 'British',
        duration: typeof tc.duration === 'number' ? tc.duration : 0,
        replayLimit: typeof tc.replayLimit === 'number' ? tc.replayLimit : 3,
      };
    },
  });
}