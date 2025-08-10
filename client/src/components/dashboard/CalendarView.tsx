import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useWeeklyPlan, type WeeklyPlanTask } from "@/hooks/useWeeklyPlan";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Constants
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = ['Morning', 'Afternoon', 'Evening'] as const;
type TimeSlot = typeof TIME_SLOTS[number];

interface CalendarTaskProps {
  title: string;
  skill: string;
  duration: string;
  status: string;
  isCompleted: boolean;
}

function CalendarTask({ title, skill, duration, status, isCompleted }: CalendarTaskProps) {
  return (
    <div 
      className={cn(
        "p-3 mb-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 transition-colors",
        isCompleted && "bg-gray-50"
      )}
    >
      <p className={cn(
        "text-sm font-medium",
        isCompleted && "line-through text-gray-500"
      )}>
        {skill}: {title}
      </p>
      <div className={cn(
        "text-xs text-gray-500 mt-1",
        isCompleted && "line-through"
      )}>
        {duration}
      </div>
    </div>
  );
}

function DayColumn({ day, tasks }: { day: string; tasks: WeeklyPlanTask[] }) {
  const dayTasks = tasks.filter(task => task.day === day);
  
  // Group tasks by time of day (this is a simple example, actual implementation would be more sophisticated)
  const groupedTasks: Record<TimeSlot, WeeklyPlanTask[]> = {
    Morning: dayTasks.filter(task => task.duration.includes('min')), // Simple rule for demo
    Afternoon: dayTasks.filter(task => task.duration.includes('hour')), // Simple rule for demo
    Evening: dayTasks.filter(task => !task.duration.includes('min') && !task.duration.includes('hour')), // Others
  };

  return (
    <div className="flex-1 min-w-[120px]">
      <div className="text-center py-2 font-medium border-b border-gray-200">{day}</div>
      <div className="h-full">
        {TIME_SLOTS.map(timeSlot => (
          <div key={timeSlot} className="p-2 border-b border-gray-100">
            <div className="text-xs text-gray-500 mb-2">{timeSlot}</div>
            {groupedTasks[timeSlot].map((task, index) => (
              <CalendarTask
                key={index}
                title={task.title}
                skill={task.skill}
                duration={task.duration}
                status={task.status}
                isCompleted={task.status === 'completed'}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarHeader() {
  return (
    <div className="flex justify-between items-center mb-4">
      <div className="flex items-center">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="mr-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to List
          </Button>
        </Link>
        <h2 className="text-xl font-semibold">Week 1 Calendar</h2>
      </div>
    </div>
  );
}

export function CalendarView() {
  const { data, isLoading, error } = useWeeklyPlan(1, "Listening");
  
  if (isLoading) {
    return (
      <div className="w-full">
        <CalendarHeader />
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between">
              {DAYS_OF_WEEK.map((day, index) => (
                <div key={index} className="flex-1 min-w-[120px]">
                  <div className="text-center py-2 font-medium border-b border-gray-200">{day}</div>
                  <div className="py-2">
                    {[1, 2, 3].map((_, i) => (
                      <Skeleton key={i} className="h-16 my-2" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full">
        <CalendarHeader />
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-red-500">Failed to load calendar data. Please try again later.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || !data.planData || !data.planData.plan || data.planData.plan.length === 0) {
    return (
      <div className="w-full">
        <CalendarHeader />
        <Card>
          <CardContent className="p-6 text-center">
            <p>No tasks found for this week. Your study plan might not be generated yet.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const weekFocus = data.planData.weekFocus;
  const planTasks = data.planData.plan;

  return (
    <div className="w-full">
      <CalendarHeader />
      
      <Card>
        <CardContent className="p-6">
          <p className="text-base font-medium mb-4">
            This week's focus: <span className="font-medium">{weekFocus}</span>
          </p>
          
          <div className="flex overflow-x-auto">
            {DAYS_OF_WEEK.map((day, index) => (
              <DayColumn key={index} day={day} tasks={planTasks} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}