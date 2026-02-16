import { useQuery } from '@tanstack/react-query';
import { getFreshWithAuth } from '@/lib/apiClient';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import type { ListeningRendererRoot } from '@shared/listening';

// Debug toggle
const DEBUG = Boolean((window as any).__DEBUG__);

// Canonical UI question types
type UiQuestionOption = { id: string; label: string };
type UiQuestion = {
  id: string;
  text: string;
  type: 'multiple-choice' | 'fill-in-the-gap' | 'fill-in-multiple-gaps';
  options?: UiQuestionOption[];
  correctAnswer?: string;
  explanation?: string;
  hint?: string;
  groupId?: string | null;
  optionOrder?: string[];
};

export type TaskContent = {
  id: string;
  title: string | null;
  scenario: string | null;
  conversationType: string | null;
  scriptText: string | null;
  audioUrl: string | null;
  questions: UiQuestion[];
  rendererPayload?: ListeningRendererRoot | null;
  contractMode?: "legacy" | "dual";
  accent?: string | null;
  duration?: number | 0;
  replayLimit?: number | 3;
  manifest?: {
    audio_assets?: Array<{
      segment_no: number;
      accent: string;
      voice_id?: string | null;
      url: string;
      duration_seconds: number;
      url_mode?: "public" | "signed";
      url_expires_at?: string | null;
    }>;
    [key: string]: any;
  } | null;
};

type ApiOk = {
  success: true;
  taskContent: any;
  ready?: boolean;
  phase?: string;
  etaSecs?: number | null;
  taskSummary?: {
    id: string;
    title: string;
    activityType?: string;
    scenario?: string;
    sessionMinutes?: number | null;
  } | null;
  session?: {
    status: string;
    retryCount: number;
    message: string;
    errorCode?: string | null;
  };
};
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

      let data: ApiOk | ApiErr;
      try {
        data = await getFreshWithAuth<ApiOk | ApiErr>(`/api/firebase/task-content/${taskId}`, getToken);
      } catch (error: any) {
        const status = error?.status;
        const body = error?.body;
        const detail =
          typeof body === 'string'
            ? body
            : body && typeof body === 'object' && 'message' in body
            ? (body as any).message
            : '';
        throw new Error(
          detail
            ? `Task content request failed${status ? ` (${status})` : ''} - ${detail}`
            : error?.message || 'Task content request failed'
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

      // Normalize questions from server format to UI format
      const rawQs: any[] = Array.isArray(tc.questions) ? tc.questions : [];

      const normalizedQuestions: UiQuestion[] = rawQs
        .map((q: any, qi: number): UiQuestion | null => {
          // Normalize id
          const id = String(q?.id ?? `q${qi + 1}`);

          // Normalize question text (server uses "question", UI expects "text")
          const textCandidate = q?.text ?? q?.question ?? '';
          const text = typeof textCandidate === 'string' ? textCandidate : '';

          if (!text.trim()) return null; // drop unusable rows

          // Normalize type (default multiple-choice for now)
          const type: UiQuestion['type'] =
            (q?.type as UiQuestion['type']) ?? 'multiple-choice';

          // Normalize options → [{ id, label }] (server uses "text", UI expects "label")
          let options: UiQuestion['options'] | undefined;
          if (Array.isArray(q?.options)) {
            options = q.options
              .map((o: any, oi: number) => {
                const oid = String(o?.id ?? `o${oi + 1}`);
                const labelCandidate =
                  o?.label ?? o?.text ?? (typeof o === 'string' ? o : '');
                const label =
                  typeof labelCandidate === 'string' ? labelCandidate : '';
                if (!label.trim()) return null;
                return { id: oid, label };
              })
              .filter(Boolean) as UiQuestionOption[];
          }

          // Normalize other fields (optional)
          const correctAnswer =
            typeof q?.correctAnswer === 'string' ? q.correctAnswer : undefined;
          const explanation =
            typeof q?.explanation === 'string' ? q.explanation : undefined;
          const hint =
            typeof q?.hint === 'string' ? q.hint : undefined;

          const groupId = typeof q?.groupId === 'string' ? q.groupId : null;
          const optionOrder = Array.isArray(q?.optionOrder) ? q.optionOrder.filter((id: any) => typeof id === 'string') : undefined;

          return { id, text, type, options, correctAnswer, explanation, hint, groupId, optionOrder };
        })
        .filter(Boolean) as UiQuestion[];

      // Debug log for question normalization
      if (DEBUG && normalizedQuestions.length > 0) {
        console.log('[QUESTIONS][normalized]', {
          count: normalizedQuestions.length,
          sample: normalizedQuestions[0]
        });
      }

      return {
        data: {
          id: typeof tc.id === 'string' ? tc.id : taskId,
          title: tc.taskTitle ?? tc.title ?? null,
          scenario: tc.scenario ?? null,
          conversationType: tc.conversationType ?? null,
          scriptText: tc.scriptText ?? null,
          audioUrl: tc.audioUrl ?? null,
          questions: normalizedQuestions,
          rendererPayload: tc.questionContract?.renderer ?? null,
          contractMode: tc.questionContract?.mode === 'dual' ? 'dual' : 'legacy',
          accent: tc.accent ?? 'British',
          duration: typeof tc.duration === 'number' ? tc.duration : 0,
          replayLimit: typeof tc.replayLimit === 'number' ? tc.replayLimit : 3,
          manifest: data?.manifest ?? null,
        },
        // Readiness metadata
        ready: data?.ready ?? true, // default to true for backward compatibility
        phase: data?.phase ?? 'idle',
        etaSecs: data?.etaSecs ?? null,
        taskSummary: data?.taskSummary ?? null,
        session: data?.session ?? null,
        error: null,
      };
    },
  });
}
