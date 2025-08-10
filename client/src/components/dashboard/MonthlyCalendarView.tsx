import { useState, useEffect } from "react";
import { Link } from "wouter";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isWeekend,
  getWeek,
  startOfWeek,
  endOfWeek,
  parse
} from "date-fns";
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon,
  ArrowLeft,
  ListFilter,
  Headphones,
  BookOpen,
  MessageSquare,
  Mic,
  Filter,
  LayoutGrid,
  BarChart
} from "lucide-react";
import { useWeeklyPlan, type WeeklyPlanTask } from "@/hooks/useWeeklyPlan";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Map skill to icon
const skillIcons = {
  Listening: <Headphones className="h-3 w-3" />,
  Reading: <BookOpen className="h-3 w-3" />,
  Writing: <MessageSquare className="h-3 w-3" />,
  Speaking: <Mic className="h-3 w-3" />,
};

type SkillType = 'Listening' | 'Reading' | 'Writing' | 'Speaking';

interface CalendarTaskProps {
  task: WeeklyPlanTask;
  isSelected: boolean;
  onClick: () => void;
}

interface DayTasksProps {
  day: Date;
  tasks: WeeklyPlanTask[];
  isCurrentMonth: boolean;
  isToday: boolean;
  onTaskClick: (task: WeeklyPlanTask) => void;
  selectedTaskId: string | null;
}

function CalendarTask({ task, isSelected, onClick }: CalendarTaskProps) {
  const isCompleted = task.status === 'completed';
  
  return (
    <div 
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-xs rounded-sm mb-1 border-l-2 cursor-pointer truncate",
        isCompleted ? "line-through text-gray-500 bg-gray-50" : "bg-white",
        isSelected ? "ring-1 ring-black" : "",
        task.skill === 'Listening' && "border-l-blue-500",
        task.skill === 'Reading' && "border-l-green-500",
        task.skill === 'Writing' && "border-l-purple-500",
        task.skill === 'Speaking' && "border-l-amber-500",
      )}
    >
      {task.title}
    </div>
  );
}

function DayTasks({ day, tasks, isCurrentMonth, isToday, onTaskClick, selectedTaskId }: DayTasksProps) {
  const dayTasks = tasks.filter(task => {
    // Convert task day string to date object
    const taskDate = parse(task.day, 'EEEE', new Date());
    return isSameDay(taskDate, day);
  });
  
  return (
    <div 
      className={cn(
        "h-24 sm:h-32 border border-gray-100 p-1 overflow-hidden flex flex-col",
        !isCurrentMonth && "bg-gray-50",
        isToday && "ring-1 ring-black",
        isWeekend(day) && "bg-gray-50/50"
      )}
    >
      <div className="text-xs font-medium mb-1">
        {format(day, 'd')}
      </div>
      <div className="overflow-y-auto flex-grow">
        {dayTasks.map((task) => (
          <CalendarTask 
            key={task.title} 
            task={task} 
            isSelected={selectedTaskId === task.title}
            onClick={() => onTaskClick(task)} 
          />
        ))}
      </div>
    </div>
  );
}

function TaskDetailPanel({ task, onClose }: { task: WeeklyPlanTask | null, onClose: () => void }) {
  if (!task) return null;
  
  const isCompleted = task.status === 'completed';
  
  return (
    <div className="border-l border-gray-200 p-4 w-full md:w-80 bg-white">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-medium">Task Details</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="mb-4">
        <div className="flex items-center mb-2">
          <span className="p-1 bg-gray-100 rounded-full mr-2">
            {skillIcons[task.skill as SkillType] || <CalendarIcon className="h-3 w-3" />}
          </span>
          <span className="font-medium">{task.skill}</span>
        </div>
        <h4 className="text-lg font-medium mb-1">{task.title}</h4>
        <p className="text-sm text-gray-500 mb-3">{task.day} • {task.duration}</p>
        
        {task.description && (
          <p className="text-sm mb-4">{task.description}</p>
        )}
      </div>
      
      <div className="mt-auto">
        <Button 
          variant={isCompleted ? "outline" : "default"} 
          className={cn("w-full", isCompleted && "border-gray-200")}
        >
          {isCompleted ? "Completed" : "Start Task"}
        </Button>
      </div>
    </div>
  );
}

export function MonthlyCalendarView() {
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<WeeklyPlanTask | null>(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [view, setView] = useState("month");
  const [skillFilter, setSkillFilter] = useState<string | null>(null);
  
  // Currently we only have access to one week of data
  // In a real implementation, we would fetch data for the entire month
  const { data, isLoading, error } = useWeeklyPlan(1, "Listening");
  
  // Days of week header
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  // Generate days for the calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  
  // Group calendar days into weeks
  const calendarWeeks: Date[][] = [];
  let week: Date[] = [];
  
  calendarDays.forEach((day, i) => {
    week.push(day);
    if (i % 7 === 6 || i === calendarDays.length - 1) {
      calendarWeeks.push(week);
      week = [];
    }
  });
  
  // Handle navigation between months
  const handlePreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const handleToday = () => setCurrentMonth(new Date());
  
  const handleTaskClick = (task: WeeklyPlanTask) => {
    setSelectedTaskId(task.title);
    setSelectedTask(task);
    setShowDetailPanel(true);
  };
  
  const closeDetailPanel = () => {
    setShowDetailPanel(false);
    setSelectedTaskId(null);
    setSelectedTask(null);
  };
  
  if (isLoading) {
    return (
      <div className="w-full">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="mr-2">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Dashboard
              </Button>
            </Link>
            <h2 className="text-xl font-semibold">Calendar</h2>
          </div>
        </div>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <Skeleton className="h-8 w-40" />
              <div className="flex space-x-2">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
            
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map(day => (
                <Skeleton key={day} className="h-8" />
              ))}
              {Array.from({ length: 35 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
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
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="mr-2">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Dashboard
              </Button>
            </Link>
            <h2 className="text-xl font-semibold">Calendar</h2>
          </div>
        </div>
        
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
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="mr-2">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Dashboard
              </Button>
            </Link>
            <h2 className="text-xl font-semibold">Calendar</h2>
          </div>
        </div>
        
        <Card>
          <CardContent className="p-6 text-center">
            <p>No tasks found for this month. Your study plan might not be generated yet.</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  // For now, we're just using the weekly plan data, but in a real implementation
  // we would fetch data for the entire month
  const planTasks = data.planData.plan;
  
  return (
    <div className="w-full">
      {/* Top header navigation */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="flex items-center">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="mr-2">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Dashboard
            </Button>
          </Link>
          <h2 className="text-xl font-semibold">Calendar</h2>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSkillFilter(null)} className="text-xs">
            <Filter className="h-3 w-3 mr-1" /> All Skills
          </Button>
          
          <Tabs defaultValue="month" className="ml-2">
            <TabsList>
              <TabsTrigger value="month" onClick={() => setView("month")}>
                <CalendarIcon className="h-3 w-3 mr-1" /> Month
              </TabsTrigger>
              <TabsTrigger value="list" onClick={() => setView("list")}>
                <ListFilter className="h-3 w-3 mr-1" /> List
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      
      <div className="flex">
        <div className="flex-grow">
          <Card>
            <CardContent className="p-4">
              {/* Calendar header with month navigation */}
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-medium">{format(currentMonth, 'MMMM yyyy')}</h3>
                <div className="flex items-center space-x-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handlePreviousMonth}
                    className="h-8 w-8 p-0 flex items-center justify-center"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleToday}
                    className="text-xs h-8"
                  >
                    Today
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleNextMonth}
                    className="h-8 w-8 p-0 flex items-center justify-center"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {/* Day of week headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {weekDays.map(day => (
                  <div key={day} className="text-center font-medium text-xs py-2">
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarWeeks.map((week, weekIndex) => (
                  week.map((day, dayIndex) => (
                    <DayTasks
                      key={`${weekIndex}-${dayIndex}`}
                      day={day}
                      tasks={planTasks}
                      isCurrentMonth={isSameMonth(day, currentMonth)}
                      isToday={isSameDay(day, new Date())}
                      onTaskClick={handleTaskClick}
                      selectedTaskId={selectedTaskId}
                    />
                  ))
                ))}
              </div>
              
              {/* Skill legend */}
              <div className="flex justify-start mt-4 gap-4">
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-blue-500 rounded-full mr-1"></div>
                  <span className="text-xs">Listening</span>
                </div>
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-1"></div>
                  <span className="text-xs">Reading</span>
                </div>
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-purple-500 rounded-full mr-1"></div>
                  <span className="text-xs">Writing</span>
                </div>
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-amber-500 rounded-full mr-1"></div>
                  <span className="text-xs">Speaking</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Task detail sidebar - only visible when a task is selected */}
        {showDetailPanel && (
          <TaskDetailPanel task={selectedTask} onClose={closeDetailPanel} />
        )}
      </div>
    </div>
  );
}