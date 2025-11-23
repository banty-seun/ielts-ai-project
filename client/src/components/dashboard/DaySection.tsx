import React from 'react';
import { cn } from '../../lib/utils';
import ListeningTaskCard, { ListeningTask } from './ListeningTaskCard';
import { format, isToday } from 'date-fns';

interface DaySectionProps {
  dayName: string;
  date: Date;
  tasks: ListeningTask[];
  isAvailable: boolean;
  onTaskClick?: (task: ListeningTask) => void;
  className?: string;
}

export default function DaySection({
  dayName,
  date,
  tasks,
  isAvailable,
  onTaskClick,
  className
}: DaySectionProps) {
  const today = isToday(date);

  // Determine the status indicator
  const getStatusIndicator = () => {
    if (today) {
      return <span className="h-2 w-2 rounded-full bg-green-500" aria-label="Today" />;
    }

    const allCompleted = tasks.length > 0 && tasks.every(t => t.status === 'completed');
    if (allCompleted) {
      return <span className="text-green-600 text-base" aria-label="All tasks completed">✓</span>;
    }

    const hasInProgress = tasks.some(t => t.status === 'in-progress');
    if (hasInProgress) {
      return <span className="h-2 w-2 rounded-full bg-blue-500" aria-label="In progress" />;
    }

    return <span className="h-2 w-2 rounded-full border-2 border-gray-300" aria-label="Not started" />;
  };

  // If day is not available for user, show rest day message
  if (!isAvailable) {
    return (
      <div className={cn('py-4', className)}>
        <div className="flex items-center gap-2 mb-3">
          {getStatusIndicator()}
          <h3 className="text-base font-semibold text-gray-900">
            {dayName}
          </h3>
          <span className="text-sm text-gray-500">
            {format(date, 'MMM d')}
          </span>
        </div>

        <div className="border border-dashed border-gray-300 rounded-lg p-4 bg-gray-50">
          <p className="text-sm text-gray-600 text-center">
            📅 Rest Day - No tasks scheduled based on your study preferences
          </p>
        </div>
      </div>
    );
  }

  // If no tasks for an available day
  if (tasks.length === 0) {
    return (
      <div className={cn('py-4', className)}>
        <div className="flex items-center gap-2 mb-3">
          {getStatusIndicator()}
          <h3 className="text-base font-semibold text-gray-900">
            {dayName}
          </h3>
          <span className="text-sm text-gray-500">
            {format(date, 'MMM d')}
          </span>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          <p className="text-sm text-gray-500 text-center">
            No tasks scheduled for this day
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('py-4', className)}>
      {/* Day Header */}
      <div className="flex items-center gap-2 mb-3">
        {getStatusIndicator()}
        <h3 className={cn(
          'text-base font-semibold',
          today ? 'text-gray-900' : 'text-gray-700'
        )}>
          {dayName}
        </h3>
        <span className="text-sm text-gray-500">
          {format(date, 'MMM d')}
        </span>
        {today && (
          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
            Today
          </span>
        )}
      </div>

      {/* Task Cards */}
      <div className="space-y-3">
        {tasks.map((task) => (
          <ListeningTaskCard
            key={task.id}
            task={task}
            onClick={() => onTaskClick?.(task)}
          />
        ))}
      </div>
    </div>
  );
}
