import React from 'react';
import { cn } from '../../lib/utils';

interface WeeklyPlanHeaderProps {
  weekFocus: string;
  userName?: string;
  weekNumber: number;
  className?: string;
}

export function WeeklyPlanHeader({ 
  weekFocus, 
  userName, 
  weekNumber, 
  className 
}: WeeklyPlanHeaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <h2 className="text-lg font-medium">
        This week's focus: {weekFocus}
      </h2>
    </div>
  );
}