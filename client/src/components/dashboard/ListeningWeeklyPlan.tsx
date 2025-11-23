import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { useWeeklyPlan } from '../../hooks/useWeeklyPlan';
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';
import { ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import DaySection from './DaySection';
import { ListeningTask } from './ListeningTaskCard';
import { addDays } from 'date-fns';
import { getQueryFn } from '../../lib/queryClient';
import { useToast } from '../../hooks/use-toast';
import { useTaskProgress } from '../../hooks/useTaskProgress';

interface ListeningWeeklyPlanProps {
  weekNumber: number;
  className?: string;
}

export default function ListeningWeeklyPlan({ weekNumber, className }: ListeningWeeklyPlanProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [localProgressOverrides, setLocalProgressOverrides] = useState<Record<string, string>>({});
  const [startingTaskKey, setStartingTaskKey] = useState<string | null>(null);
  const { startTask: startTaskProgress } = useTaskProgress({ enabled: false });

  const {
    data: weeklyPlan,
    isLoading,
    error,
    refetch
  } = useWeeklyPlan(weekNumber, 'listening');

  const { preferences, isLoading: prefsLoading } = useOnboardingStatus();
  const weeklyPlanId = weeklyPlan?.id;

  const progressQueryKey = weeklyPlanId
    ? [`/api/firebase/task-progress/weekly-plan/${weeklyPlanId}`]
    : ['weekly-plan-progress', 'disabled'];

  const {
    data: progressData,
    isLoading: progressLoading,
    refetch: refetchProgress,
    error: progressError,
  } = useQuery({
    queryKey: progressQueryKey,
    queryFn: async (ctx) => {
      if (!weeklyPlanId) {
        return { success: true, taskProgress: [] };
      }
      return getQueryFn({ on401: 'returnNull' })(ctx);
    },
    enabled: Boolean(weeklyPlanId),
    staleTime: 60 * 1000,
  });

  const progressRecords = useMemo(() => {
    if (!progressData) {
      return [];
    }

    const payload = (progressData as any)?.taskProgress;
    return Array.isArray(payload) ? payload : [];
  }, [progressData]);

  const progressLookup = useMemo(() => {
    const map = new Map<number, any[]>();

    progressRecords.forEach((record: any) => {
      if (typeof record?.dayNumber !== 'number') {
        return;
      }
      const bucket = map.get(record.dayNumber) ?? [];
      bucket.push(record);
      map.set(record.dayNumber, bucket);
    });

    map.forEach((bucket, day) => {
      bucket.sort((a: any, b: any) => {
        const aTime = new Date(a?.createdAt ?? a?.updatedAt ?? 0).getTime();
        const bTime = new Date(b?.createdAt ?? b?.updatedAt ?? 0).getTime();
        return aTime - bTime;
      });
    });

    return map;
  }, [progressRecords]);

  // Get user's availability schedule
  const schedule = preferences?.schedule || 'both';

  // Determine which days are available based on schedule
  const isDayAvailable = (dayIndex: number): boolean => {
    const isWeekday = dayIndex >= 0 && dayIndex <= 4; // Mon-Fri (0-4)

    if (schedule === 'both') return true;
    if (schedule === 'weekday') return isWeekday;
    if (schedule === 'weekend') return !isWeekday;

    return true; // Default to showing all days
  };

  // Parse and group tasks by day
  const tasksByDay = useMemo(() => {
    if (!weeklyPlan?.planData?.plan) return [];

    const tasks = Array.isArray(weeklyPlan.planData.plan)
      ? weeklyPlan.planData.plan
      : [];

    const planStartDate = weeklyPlan?.planData?.plan?.[0]?.assignedDate
      ? new Date(weeklyPlan.planData.plan[0].assignedDate)
      : new Date();

    // Group tasks by day number
    const dayGroups: Record<number, ListeningTask[]> = {};

    const dayAssignmentCounts: Record<number, number> = {};

    tasks.forEach((task: any, taskIndex: number) => {
      const dayNumber = task.dayNumber || 1;
      if (!dayGroups[dayNumber]) {
        dayGroups[dayNumber] = [];
      }

      const bucket = progressLookup.get(dayNumber) ?? [];
      const bucketIndex = dayAssignmentCounts[dayNumber] ?? 0;
      const linkedProgress = bucket[bucketIndex];
      dayAssignmentCounts[dayNumber] = bucketIndex + 1;

      const fallbackId =
        linkedProgress?.id ||
        task.id ||
        task.progressId ||
        `${weeklyPlan.id}-${dayNumber}-${taskIndex}`;

      const progressOverride = localProgressOverrides[fallbackId];
      const progressId = progressOverride ?? linkedProgress?.id ?? null;

      const status = linkedProgress?.status || task.status || 'not-started';
      const sessionState = linkedProgress?.progressData?.sessionState;
      const progressSegments = Array.isArray(linkedProgress?.progressData?.segments)
        ? linkedProgress.progressData.segments
        : [];
      const firstSegmentMeta = progressSegments.find((segment: any) => segment && segment.accent);
      const resolvedAccent =
        firstSegmentMeta?.accent ||
        linkedProgress?.progressData?.accent ||
        linkedProgress?.accent ||
        task.accent ||
        'British';
      const resolvedVoiceId = firstSegmentMeta?.voiceId || undefined;

      const listeningTask: ListeningTask = {
        id: fallbackId,
        progressId,
        localKey: fallbackId,
        title: task.title || task.originalTitle || 'Listening Practice',
        skill: task.skill || 'listening',
        testType: task.testType,
        scenario: task.scenario,
        ieltsPart: task.ieltsPart,
        accent: resolvedAccent,
        voiceId: resolvedVoiceId,
        duration: (typeof task.durationMinutes === 'number' && task.durationMinutes > 0)
          ? `${task.durationMinutes} min`
          : (typeof task.duration === 'string' ? task.duration : '30 min'),
        description: task.description || '',
        status,
        sessionState,
        dayNumber,
        weeklyPlanId: weeklyPlan.id,
        weekNumber,
        rawPlanEntry: task,
        isStarting: startingTaskKey === fallbackId,
        assignedDate: typeof task.assignedDate === 'string' ? task.assignedDate : undefined,
        sequenceNumber: typeof task.sequenceNumber === 'number' ? task.sequenceNumber : undefined,
      };

      dayGroups[dayNumber].push(listeningTask);
    });

    const dayMetadata = Array.from({ length: 7 }, (_, index) => ({
      label: `Day ${index + 1}`,
      date: addDays(planStartDate, index),
    }));

    return dayMetadata.map((meta, index) => ({
      dayName: meta.label,
      dayIndex: index,
      date: meta.date,
      isAvailable: isDayAvailable(index),
      tasks: dayGroups[index + 1] || []
    }));
  }, [weeklyPlan, schedule, progressLookup, localProgressOverrides, startingTaskKey, weekNumber]);

  // Filter to only show available days (or all if testing)
  const filteredDays = useMemo(() => {
    // For now, show all days to see the full structure
    // Can filter later: return tasksByDay.filter(day => day.isAvailable || day.tasks.length > 0);
    return tasksByDay;
  }, [tasksByDay]);

  // Handle task click
  const ensureTaskProgress = async (task: ListeningTask): Promise<string | null> => {
    const cachedId = task.progressId ?? localProgressOverrides[task.localKey];
    if (cachedId) {
      return cachedId;
    }

    try {
      setStartingTaskKey(task.localKey);
      const payload = await startTaskProgress({
        weeklyPlanId: task.weeklyPlanId,
        weekNumber: task.weekNumber,
        dayNumber: task.dayNumber,
        taskTitle: task.title,
        skill: task.skill ?? 'listening',
        planEntry: task.rawPlanEntry ?? task,
      });
      const progressId = payload?.id;

      if (!progressId) {
        throw new Error('No progress id returned');
      }

      setLocalProgressOverrides((prev) => ({
        ...prev,
        [task.localKey]: progressId,
      }));

      await refetchProgress();
      return progressId;
    } catch (error: any) {
      console.error('[ListeningWeeklyPlan] Failed to start task', error);
      toast({
        title: 'Unable to start practice',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setStartingTaskKey(null);
    }
  };

  const handleTaskClick = async (task: ListeningTask) => {
    if (startingTaskKey && startingTaskKey === task.localKey) {
      return;
    }

    const existingId = task.progressId ?? localProgressOverrides[task.localKey] ?? null;
    const progressId = existingId ?? (await ensureTaskProgress(task));

    if (!progressId) {
      return;
    }

    const targetPath = `/practice/${encodeURIComponent(progressId)}?progressId=${encodeURIComponent(progressId)}&taskId=${encodeURIComponent(task.id)}`;
    setLocation(targetPath);
  };

  // Loading state
  if (isLoading || prefsLoading || progressLoading) {
    return (
      <Card className={cn('w-full', className)}>
        <CardContent className="p-6">
          <Skeleton className="h-6 w-3/4 mb-4" />
          <Skeleton className="h-4 w-full mb-6" />

          {/* Skeleton for 3 day sections */}
          {Array(3).fill(0).map((_, i) => (
            <div key={i} className="mb-6">
              <Skeleton className="h-5 w-32 mb-3" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error || progressError) {
    return (
      <Card className={cn('w-full', className)}>
        <CardContent className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error Loading Plan</AlertTitle>
            <AlertDescription>
              Failed to load your listening study plan. Please try again.
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            onClick={() => {
              void refetch();
              void refetchProgress();
            }}
            className="mt-4 flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // No plan available
  if (!weeklyPlan) {
    return (
      <Card className={cn('w-full', className)}>
        <CardContent className="p-6 text-center">
          <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-2">No Plan Available</h3>
          <p className="text-sm text-gray-600 mb-4">
            Week {weekNumber} listening plan hasn't been generated yet.
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            Generate Plan
          </Button>
        </CardContent>
      </Card>
    );
  }

  const weekFocus = weeklyPlan.planData?.weekFocus || weeklyPlan.weekFocus || 'Weekly listening practice';

  return (
    <Card className={cn('w-full', className)}>
      {/* Header */}
      <div className="border-b border-gray-200 p-5 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg md:text-xl font-semibold text-gray-900">
            Listening Study Plan
          </h2>
          <Link href="/dashboard/calendar">
            <a className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
              <span className="hidden sm:inline">View Calendar</span>
              <ChevronRight className="h-4 w-4" />
            </a>
          </Link>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">
            Week {weekNumber}
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            <span className="font-medium">Focus:</span> {weekFocus}
          </p>
        </div>
      </div>

      {/* Day Sections */}
      <CardContent className="p-5 md:p-6">
        <div className="divide-y divide-gray-100">
          {filteredDays.map((day) => (
            <DaySection
              key={day.dayIndex}
              dayName={day.dayName}
              date={day.date}
              tasks={day.tasks}
              isAvailable={day.isAvailable}
              onTaskClick={handleTaskClick}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
