import React from 'react';
import { cn } from '../../lib/utils';
import { Headphones, Play, Pause, Clock, ArrowRight, RotateCcw } from 'lucide-react';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';

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
  // Session state for pause/resume
  sessionState?: {
    status: 'running' | 'paused' | 'completed' | 'expired';
    remainingMs: number;
    currentAudioIndex: number;
  };
}

interface ListeningTaskCardProps {
  task: ListeningTask;
  onClick?: () => void;
  className?: string;
}

export default function ListeningTaskCard({ task, onClick, className }: ListeningTaskCardProps) {
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

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-4 md:p-5',
        'rounded-xl',
        'transition-all duration-200',
        'cursor-pointer',
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

      {/* CTA Link */}
      <div className="mt-2">
        {task.status === 'not-started' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            disabled={task.isStarting}
            className={cn(
              "text-xs font-medium flex items-center gap-1 transition-colors",
              task.isStarting
                ? "text-indigo-400 cursor-not-allowed"
                : "text-indigo-600 hover:text-indigo-700"
            )}
          >
            {task.isStarting ? 'Starting…' : 'Start Practice'}
            <ArrowRight className="h-3 w-3" />
          </button>
        )}

        {task.status === 'in-progress' && !task.sessionState && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors"
          >
            Continue
            <ArrowRight className="h-3 w-3" />
          </button>
        )}

        {task.sessionState && (task.sessionState.status === 'paused' || task.sessionState.status === 'running') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
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
                Resume Session
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
              onClick?.();
            }}
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
