import { Clock } from 'lucide-react';
import {
  deriveListeningWarmupUiState,
  formatListeningWarmupEta,
  formatListeningWarmupLastUpdated,
  getListeningWarmupGuidance,
  normalizeListeningWarmupPhase,
  type ListeningWarmupPhase,
} from '@/lib/listeningWarmupState';

interface SessionWarmupProps {
  phase: ListeningWarmupPhase | 'idle' | 'queued' | 'warming' | 'running' | 'error';
  etaSecs?: number | null;
  taskSummary?: {
    id: string;
    title: string;
    activityType?: string;
    scenario?: string;
    sessionMinutes?: number | null;
  } | null;
  sessionInfo?: {
    status: string;
    retryCount: number;
    message: string;
    errorCode?: string | null;
  } | null;
  onRefresh?: () => void;
  skillType?: 'listening' | 'reading' | 'writing' | 'speaking';
  ready?: boolean;
  attemptCount?: number;
  lastUpdatedAt?: string | null;
  backgroundPolling?: boolean;
  showPrimaryActionHint?: boolean;
}

/**
 * SessionWarmup Component
 *
 * Reusable component for displaying warm-up/preparation state across all IELTS skills.
 * Shows an animated loading state with estimated time, task summary, and refresh button.
 *
 * @example
 * ```tsx
 * <SessionWarmup
 *   phase="warming"
 *   etaSecs={45}
 *   taskSummary={{ id: '123', title: 'Office Dialogue', activityType: 'dialogue', scenario: 'Office Meeting' }}
 *   skillType="listening"
 *   onRefresh={() => queryClient.invalidateQueries(...)}
 * />
 * ```
 */
export function SessionWarmup({
  phase,
  etaSecs,
  taskSummary,
  sessionInfo,
  onRefresh,
  skillType = 'listening',
  ready = false,
  attemptCount,
  lastUpdatedAt = null,
  backgroundPolling = false,
  showPrimaryActionHint = true,
}: SessionWarmupProps) {
  const normalizedPhase = normalizeListeningWarmupPhase(phase);
  const uiState = deriveListeningWarmupUiState({
    ready,
    phase: normalizedPhase,
    sessionInfo,
  });

  const phaseMessages: Record<ListeningWarmupPhase, string> = {
    idle: 'Initializing session...',
    queued: 'Queuing your session...',
    warming: `Warming up ${skillType} session...`,
    running: 'Generating content...',
    error: 'Session preparation encountered an issue',
    ready: 'Ready to start',
  };

  const isReady = uiState === 'ready_to_start';
  const isError = uiState === 'retrying';
  const iconColorClass = isReady ? 'text-green-600' : isError ? 'text-red-600' : 'text-blue-600';
  const bgColorClass = isReady ? 'bg-green-100' : isError ? 'bg-red-100' : 'bg-blue-100';
  const phaseTitle =
    uiState === 'ready_to_start'
      ? 'Ready to Start'
      : uiState === 'retrying'
        ? 'Retrying Preparation'
        : uiState === 'queued'
          ? 'Queued for Preparation'
          : phaseMessages[normalizedPhase];
  const etaLabel = formatListeningWarmupEta(etaSecs);
  const statusUpdatedLabel = formatListeningWarmupLastUpdated(lastUpdatedAt);
  const retryCount = Math.max(
    Number.isFinite(Number(attemptCount)) ? Number(attemptCount) : 0,
    Number(sessionInfo?.retryCount ?? 0),
  );

  return (
    <div className="text-center py-12">
      <div className="mb-6">
        {/* Animated Icon */}
        <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full ${bgColorClass} mb-4`}>
          <Clock className={`h-8 w-8 ${iconColorClass} ${isError ? '' : 'animate-pulse'}`} />
        </div>

        {/* Phase Message */}
        <h3 className="text-xl font-semibold mb-2">
          {phaseTitle}
        </h3>

        {/* Session Info Message */}
        <p className="text-gray-600 mb-4">
          {sessionInfo?.message ?? getListeningWarmupGuidance(uiState)}
        </p>

        {/* Estimated Time */}
        <p className="text-sm text-gray-500">Estimated time: {etaLabel}</p>
        <p className="text-xs text-gray-500 mt-1">{statusUpdatedLabel}</p>
        {showPrimaryActionHint && !isReady && (
          <p className="text-xs text-gray-500 mt-1">
            {backgroundPolling ? "Background polling is active." : "Status updates when refreshed."}
          </p>
        )}

        {/* Error Code */}
        {isError && sessionInfo?.errorCode && (
          <p className="text-xs text-red-500 mt-2">
            Error Code: {sessionInfo.errorCode}
          </p>
        )}

        {/* Retry Count */}
        {retryCount > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            Latest attempt: {retryCount}
          </p>
        )}

        {/* Task Summary Card */}
        {taskSummary && (
          <div className="mt-6 text-left max-w-md mx-auto p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Session Preview</h4>

            {taskSummary.activityType && (
              <p className="text-sm text-gray-700">
                <strong>Activity:</strong> {taskSummary.activityType}
              </p>
            )}

            {taskSummary.scenario && (
              <p className="text-sm text-gray-700 mt-1">
                <strong>Scenario:</strong> {taskSummary.scenario}
              </p>
            )}

            {taskSummary.sessionMinutes && (
              <p className="text-sm text-gray-700 mt-1">
                <strong>Duration:</strong> {taskSummary.sessionMinutes} minutes
              </p>
            )}
          </div>
        )}
      </div>

      {/* Refresh Button */}
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="mt-4 px-4 py-2 text-sm text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded"
        >
          Refresh Status
        </button>
      )}

      {/* Progress Indicator - Optional subtle animation */}
      {!isError && !isReady && (
        <div className="mt-6 flex justify-center">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"
                style={{
                  animationDelay: `${i * 0.1}s`,
                  animationDuration: '0.6s',
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
