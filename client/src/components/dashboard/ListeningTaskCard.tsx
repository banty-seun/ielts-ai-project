import React from 'react';
import { cn } from '../../lib/utils';
import { Headphones, Play, Pause, Clock, ArrowRight, RotateCcw } from 'lucide-react';
import { Progress } from '../ui/progress';
import { msToMMSS } from '@shared/constants';
import type { ListeningRuntimeEntryState } from '@/lib/sessionKey';
import { formatListeningWarmupLastUpdated } from '@/lib/listeningWarmupState';

export interface ListeningTask {
  id: string;
  progressId?: string | null;
  localKey: string;
  title: string;
  skill?: 'listening' | 'reading' | 'writing' | 'speaking';
  testType?: string;
  scenario?: string;
  ieltsPart?: number;
  accent?: string;
  voiceId?: string;
  duration: string;
  description: string;
  status: 'not-started' | 'in-progress' | 'completed';
  durationMinutes?: number;
  progress?: {
    percentage: number;
    currentQuestion: number;
    totalQuestions: number;
  };
  completedAt?: Date;
  score?: {
    correct: number;
    total: number;
    percentage: number;
  };
  dayNumber: number;
  weeklyPlanId: string;
  weekNumber: number;
  rawPlanEntry?: any;
  isStarting?: boolean;
  assignedDate?: string;
  sequenceNumber?: number;
  performanceCoachStatus?: {
    recommendationAdopted?: boolean;
    trendImpact?: 'up' | 'down' | 'flat' | null;
    loopBreakMetric?: string | null;
    sourceAnalysisId?: string | null;
  } | null;
  // Session state for pause/resume
  sessionState?: {
    status: 'running' | 'paused' | 'completed' | 'expired';
    remainingMs: number;
    currentAudioIndex: number;
  };
  runtimeEntryState?: ListeningRuntimeEntryState;
  readiness?: {
    status: 'queued' | 'warming' | 'ready' | 'error';
    etaSecs?: number | null;
    updatedAt?: string | null;
    retryCount?: number;
    attempts?: number;
    message?: string | null;
    errorCode?: string | null;
    partReady?: boolean;
  } | null;
}

interface ListeningTaskCardProps {
  task: ListeningTask;
  onClick?: () => void;
  className?: string;
  ctaDisabled?: boolean;
}

export default function ListeningTaskCard({ task, onClick, className, ctaDisabled = false }: ListeningTaskCardProps) {
  const readinessStatus = task.readiness?.status ?? null;
  // Format duration from "6 min" to just "6 min", handle various formats
  const formatDuration = (duration: string) => {
    const match = duration.match(/(\d+)/);
    return match ? `${match[1]} min` : duration;
  };

  // Format time remaining for session
  const formatTimeRemaining = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  // Determine card styling based on status
  const getCardStyles = () => {
    // Check session state first for more specific styling
    if (task.sessionState) {
      if (task.sessionState.status === 'paused') {
        return 'bg-yellow-50 border-2 border-yellow-500';
      }
      if (task.sessionState.status === 'running') {
        return 'bg-blue-50 border-2 border-blue-500 animate-pulse';
      }
    }
    if (task.runtimeEntryState === 'warming_up') {
      return 'bg-blue-50 border border-blue-200';
    }
    if (task.runtimeEntryState === 'ready_not_started') {
      return 'bg-green-50 border border-green-200';
    }
    if (readinessStatus === 'warming' || readinessStatus === 'queued') {
      return 'bg-blue-50 border border-blue-200';
    }
    if (readinessStatus === 'ready') {
      return 'bg-green-50 border border-green-200';
    }
    if (readinessStatus === 'error') {
      return 'bg-red-50 border border-red-200';
    }

    // Fall back to task status
    switch (task.status) {
      case 'in-progress':
        return 'bg-blue-50 border-2 border-blue-500';
      case 'completed':
        return 'bg-green-50 border border-green-500';
      default:
        return 'bg-gray-50 border border-transparent hover:bg-gray-100';
    }
  };

  // Defensive fallback: prefer numeric durationMinutes over string duration
  const numericMinutes =
    typeof (task as any)?.durationMinutes === 'number' && (task as any).durationMinutes > 0
      ? (task as any).durationMinutes
      : undefined;

  const disabled = ctaDisabled || task.isStarting;
  const handleClick = () => {
    if (disabled) return;
    onClick?.();
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        'p-4 md:p-5',
        'rounded-xl',
        'transition-all duration-200',
        disabled ? 'cursor-not-allowed opacity-80' : 'cursor-pointer',
        'min-h-[80px]',
        getCardStyles(),
        'hover:shadow-md',
        className
      )}
    >
      {/* Title Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Headphones className="h-5 w-5 flex-shrink-0 text-blue-600" />
          <h4 className="text-sm md:text-base font-medium text-gray-900 truncate">
            {task.title}
          </h4>
        </div>
        <span className="text-xs px-2 py-1 bg-gray-100 rounded-md text-gray-600 whitespace-nowrap ml-2">
          {numericMinutes ? `${numericMinutes} min` : formatDuration(task.duration)}
        </span>
      </div>

      {/* Meta Row - Part and Accent */}
      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1 flex-wrap">
        {task.ieltsPart && (
          <>
            <span>Part {task.ieltsPart}</span>
            {(task.accent || task.voiceId) && <span>•</span>}
          </>
        )}
        {task.accent && <span>{task.accent} Accent</span>}
        {task.accent && task.voiceId && <span>•</span>}
        {task.voiceId && <span className="uppercase tracking-wide text-gray-400">{task.voiceId}</span>}
        {task.status === 'completed' && (
          <>
            <span>•</span>
            <span className="text-green-600 font-medium">✓ Done</span>
          </>
        )}
        {/* Session state indicator */}
        {task.sessionState && task.sessionState.status === 'paused' && (
          <>
            <span>•</span>
            <span className="text-yellow-600 font-medium flex items-center gap-1">
              <Pause className="w-3 h-3" />
              Paused
            </span>
          </>
        )}
        {task.sessionState && task.sessionState.status === 'running' && (
          <>
            <span>•</span>
            <span className="text-blue-600 font-medium flex items-center gap-1">
              <Play className="w-3 h-3" />
              Active
            </span>
          </>
        )}
        {!task.sessionState && task.runtimeEntryState === 'warming_up' && (
          <>
            <span>•</span>
            <span className="text-blue-700 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Preparing Part 1
            </span>
          </>
        )}
        {!task.sessionState && task.runtimeEntryState === 'ready_not_started' && (
          <>
            <span>•</span>
            <span className="text-green-700 font-medium flex items-center gap-1">
              <Play className="w-3 h-3" />
              Ready to start
            </span>
          </>
        )}
        {!task.sessionState && !task.runtimeEntryState && readinessStatus && (
          <>
            <span>•</span>
            <span
              className={cn(
                'font-medium flex items-center gap-1',
                readinessStatus === 'ready' && 'text-green-700',
                (readinessStatus === 'warming' || readinessStatus === 'queued') && 'text-blue-700',
                readinessStatus === 'error' && 'text-red-700',
              )}
            >
              <Clock className="w-3 h-3" />
              {readinessStatus === 'ready'
                ? 'Ready'
                : readinessStatus === 'error'
                  ? 'Preparation failed'
                  : readinessStatus === 'warming'
                    ? 'Preparing'
                    : 'Queued'}
            </span>
          </>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-gray-600 line-clamp-2 mb-2">
        {task.description}
      </p>

      {/* Session info (if active session) */}
      {task.sessionState && (task.sessionState.status === 'running' || task.sessionState.status === 'paused') && (
        <div className="mt-3 p-3 bg-white border border-gray-200 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-700 font-medium">Session Progress</span>
            <span className="text-gray-600">
              Audio {task.sessionState.currentAudioIndex + 1}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Clock className="w-4 h-4" />
            <span>{formatTimeRemaining(task.sessionState.remainingMs)} remaining</span>
          </div>
        </div>
      )}
      {!task.sessionState && (task.runtimeEntryState === 'warming_up' || task.runtimeEntryState === 'ready_not_started') && (
        <div className="mt-3 p-3 bg-white border border-gray-200 rounded-lg space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Clock className="w-4 h-4" />
            <span>
              {task.runtimeEntryState === 'warming_up'
                ? 'Preparing session assets (timer not started)'
                : 'Ready to start (timer not started)'}
            </span>
          </div>
        </div>
      )}
      {!task.sessionState && !task.runtimeEntryState && readinessStatus && (
        <div className="mt-3 p-3 bg-white border border-gray-200 rounded-lg space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Clock className="w-4 h-4" />
            <span>
              {task.readiness?.message ||
                (readinessStatus === 'ready'
                  ? 'Ready to start'
                  : readinessStatus === 'error'
                    ? 'Preparation failed'
                    : 'Preparing session assets in background')}
            </span>
          </div>
          {(readinessStatus === 'warming' || readinessStatus === 'queued') && typeof task.readiness?.etaSecs === 'number' && (
            <div className="text-xs text-blue-700">ETA ~{task.readiness.etaSecs}s</div>
          )}
          {readinessStatus === 'error' && (
            <div className="text-xs text-red-700">
              {task.readiness?.errorCode ? `Code: ${task.readiness.errorCode}` : 'Retry from dashboard or open preparation status'}
            </div>
          )}
          {typeof task.readiness?.retryCount === 'number' && task.readiness.retryCount > 0 && (
            <div className="text-xs text-gray-500">Retries: {task.readiness.retryCount}</div>
          )}
          {task.readiness?.updatedAt && (
            <div className="text-xs text-gray-500">{formatListeningWarmupLastUpdated(task.readiness.updatedAt)}</div>
          )}
        </div>
      )}

      {/* Progress Bar (if in progress without active session) */}
      {task.status === 'in-progress' && task.progress && !task.sessionState && (
        <div className="mt-3 space-y-1">
          <Progress value={task.progress.percentage} className="h-1.5" />
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{task.progress.percentage}% complete</span>
            <span>
              {task.progress.currentQuestion}/{task.progress.totalQuestions} questions
            </span>
          </div>
        </div>
      )}

      {/* Score (if completed) */}
      {task.status === 'completed' && task.score && (
        <div className="mt-2 text-sm text-gray-600">
          <span className="font-medium">Score: </span>
          <span>
            {task.score.correct}/{task.score.total} ({task.score.percentage}%)
          </span>
          {task.completedAt && (
            <span className="text-xs text-gray-500 ml-2">
              • {new Date(task.completedAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
            </span>
          )}
        </div>
      )}

      {task.performanceCoachStatus && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span
            className={cn(
              'px-2 py-0.5 rounded-full border',
              task.performanceCoachStatus.recommendationAdopted
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-gray-50 text-gray-700 border-gray-300',
            )}
          >
            {task.performanceCoachStatus.recommendationAdopted ? 'Recommendation adopted' : 'Recommendation pending'}
          </span>
          {task.performanceCoachStatus.trendImpact && (
            <span className="px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
              Trend impact: {task.performanceCoachStatus.trendImpact}
            </span>
          )}
        </div>
      )}

      {/* CTA Link */}
      <div className="mt-2">
        {task.status === 'not-started' && !task.sessionState && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              onClick?.();
            }}
            disabled={disabled}
            className={cn(
              "text-xs font-medium flex items-center gap-1 transition-colors",
              disabled
                ? "text-indigo-400 cursor-not-allowed"
                : "text-indigo-600 hover:text-indigo-700"
            )}
          >
            {task.isStarting
              ? 'Starting…'
              : readinessStatus === 'ready'
                ? 'Start now'
                : readinessStatus === 'warming' || readinessStatus === 'queued'
                  ? 'Preparing in background'
                  : readinessStatus === 'error'
                    ? 'View preparation status'
                    : 'Start Practice'}
            <ArrowRight className="h-3 w-3" />
          </button>
        )}

        {task.status === 'in-progress' && !task.sessionState && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              onClick?.();
            }}
            disabled={disabled}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors"
          >
            {task.runtimeEntryState === 'warming_up'
              ? 'Preparing…'
              : readinessStatus === 'warming' || readinessStatus === 'queued'
                ? 'Preparing in background'
              : task.runtimeEntryState === 'ready_not_started'
                ? 'Start now'
                : readinessStatus === 'ready'
                  ? 'Start now'
                : 'Continue'}
            <ArrowRight className="h-3 w-3" />
          </button>
        )}

        {task.sessionState && (task.sessionState.status === 'paused' || task.sessionState.status === 'running') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              onClick?.();
            }}
            disabled={disabled}
            className={cn(
              "text-xs font-medium flex items-center gap-1 transition-colors",
              task.sessionState.status === 'paused'
                ? "text-yellow-600 hover:text-yellow-700"
                : "text-blue-600 hover:text-blue-700"
            )}
          >
            {task.sessionState.status === 'paused' ? (
              <>
                <Play className="h-3 w-3" />
                Continue • {msToMMSS(task.sessionState.remainingMs)}
              </>
            ) : (
              <>
                <Pause className="h-3 w-3" />
                View Session
              </>
            )}
          </button>
        )}

        {task.status === 'completed' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              onClick?.();
            }}
            disabled={disabled}
            className="text-xs text-gray-600 hover:text-gray-700 font-medium flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Review
          </button>
        )}
      </div>
    </div>
  );
}
