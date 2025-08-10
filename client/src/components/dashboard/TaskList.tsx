import React from 'react';
import { cn } from '../../lib/utils';
import { Button } from '@/components/ui/button';
import { Circle } from 'lucide-react';
import { WeeklyPlanTask } from '../../hooks/useWeeklyPlan';
import { useLocation } from 'wouter';

interface TaskListProps {
  tasks: WeeklyPlanTask[];
  className?: string;
}

export function TaskList({ tasks, className }: TaskListProps) {
  const [, setLocation] = useLocation();
  
  if (!tasks || tasks.length === 0) {
    return (
      <div className={cn("py-4 text-center", className)}>
        <p className="text-gray-500">No tasks found for this week.</p>
      </div>
    );
  }

  // Helper function to extract day number from the task.day property
  const getDayNumber = (day: string): string => {
    // Extract numbers from the day string (e.g., "Day 3" -> "3")
    const match = day.match(/\d+/);
    return match ? match[0] : '1'; // Default to '1' if no number found
  };

  return (
    <div className={cn("", className)}>
      {tasks.map((task, index) => {
        const isCompleted = task.status.toLowerCase() === 'completed';
        const dayNumber = getDayNumber(task.day);
        
        return (
          <div 
            key={`${task.day}-${index}`}
            className={cn(
              "flex items-center justify-between py-2 border-b border-gray-100",
              index === tasks.length - 1 && "border-b-0"
            )}
          >
            <div className="flex items-center">
              {/* Use filled black circle for completed tasks, outline circle for pending */}
              {isCompleted ? (
                <div className="w-6 h-6 rounded-full bg-black flex-shrink-0" />
              ) : (
                <Circle className="w-6 h-6 text-gray-300 flex-shrink-0" />
              )}
              <div className="ml-4">
                <p className={cn(
                  "text-base font-medium",
                  isCompleted && "line-through text-gray-500"
                )}>
                  {task.skill}: {task.title}
                </p>
                <div className={cn(
                  "text-sm text-gray-500",
                  isCompleted && "line-through"
                )}>
                  {task.day} • {task.duration}
                </div>
              </div>
            </div>
            
            {!isCompleted && (
              <Button 
                variant="outline" 
                size="sm"
                className="rounded-md py-1 px-4 border border-gray-200 hover:bg-gray-50"
                onClick={() => {
                  console.log('Navigating to practice for:', task);
                  // Navigate to the practice page with week/day parameters
                  // The weekNumber is 1-based as needed, the dayNumber extracted from the task
                  setLocation(`/practice/1/${dayNumber}?title=${encodeURIComponent(task.title)}&skill=${encodeURIComponent(task.skill)}`);
                }}
              >
                Start
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}