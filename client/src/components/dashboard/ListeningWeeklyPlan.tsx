import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_SESSION_MINUTES, SESSION_START_KEY } from '@shared/constants';
import { getFreshWithAuth, postFreshWithAuth } from '@/lib/apiClient';
import { SessionWarmup } from '../SessionWarmup';
import { clearSessionStart, readSessionStart, type ListeningRuntimeEntryState } from '@/lib/sessionKey';
import {
  normalizeListeningWarmupPhase,
  type ListeningWarmupPhase,
} from '@/lib/listeningWarmupState';

interface ListeningWeeklyPlanProps {
  weekNumber: number;
  className?: string;
}

type StartupGateState = {
  progressId: string;
  targetPath: string;
  taskTitle: string;
  phase: ListeningWarmupPhase;
  etaSecs: number | null;
  taskSummary: {
    id: string;
    title: string;
    activityType?: string;
    scenario?: string;
    sessionMinutes?: number | null;
  } | null;
  sessionInfo: {
    status: string;
    retryCount: number;
    message: string;
    errorCode?: string | null;
  } | null;
  waiting: boolean;
  attempt: number;
  ready: boolean;
  lastUpdatedAt: string | null;
  panelVisible: boolean;
  backgroundPolling: boolean;
  pollErrorCount: number;
};

type WarmupStatusByProgressId = Record<string, Omit<StartupGateState, 'panelVisible' | 'backgroundPolling' | 'pollErrorCount'>>;

const parsePollEnvMs = (raw: unknown, fallback: number) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
};

const STARTUP_GATE_POLL_BASE_MS = parsePollEnvMs(import.meta.env.VITE_LISTENING_STARTUP_POLL_MS, 3000);
const STARTUP_GATE_POLL_MAX_MS = parsePollEnvMs(import.meta.env.VITE_LISTENING_STARTUP_POLL_MAX_MS, 30000);
const STARTUP_GATE_MAX_ATTEMPTS = 10;
const DASHBOARD_READINESS_POLL_MS = parsePollEnvMs(import.meta.env.VITE_LISTENING_DASHBOARD_READINESS_POLL_MS, 10000);

const toDashboardCardReadinessStatus = (value: unknown): 'queued' | 'warming' | 'ready' | 'error' => {
  const phase = normalizeListeningWarmupPhase(value);
  if (phase === 'ready') return 'ready';
  if (phase === 'error') return 'error';
  if (phase === 'warming' || phase === 'running') return 'warming';
  return 'queued';
};

function ListeningWeeklyPlan({ weekNumber, className }: ListeningWeeklyPlanProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [localProgressOverrides, setLocalProgressOverrides] = useState<Record<string, string>>({});
  const [startingTaskKey, setStartingTaskKey] = useState<string | null>(null);
  const [startupGateState, setStartupGateState] = useState<StartupGateState | null>(null);
  const [warmupStatuses, setWarmupStatuses] = useState<WarmupStatusByProgressId>({});
  const readyToastEmittedRef = useRef<Set<string>>(new Set());
  const dashboardBoostedTaskIdsRef = useRef<Set<string>>(new Set());
  const dashboardCardReadinessRef = useRef<Record<string, 'queued' | 'warming' | 'ready' | 'error'>>({});
  const { startTask: startTaskProgress } = useTaskProgress({ enabled: false });
  const { user } = useAuth();
  const { currentUser, getToken, loading: authLoading, authReady } = useFirebaseAuthContext();


  // Prefer server user id; fallback to Firebase UID to avoid CTA dead-ends while cache warms.
  const userId = user?.id ?? currentUser?.uid ?? null;

  const [todayYmd] = useState(() => new Date().toISOString().split('T')[0]);

  // Always define this once; earlier crash showed missing var.
  const canUseStorage = typeof window !== 'undefined' && !!window.localStorage;
  const [timeRefreshCounter, setTimeRefreshCounter] = useState(0);

  useEffect(() => {
    readyToastEmittedRef.current.clear();
  }, []);

  // keep the 15s label refresh, but don't trigger unmounts/remounts
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const bump = () => setTimeRefreshCounter((prev) => prev + 1);
    const intervalId = window.setInterval(bump, 15000);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', bump);
    return () => {
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', bump);
      window.clearInterval(intervalId);
    };
  }, []);

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
      const warmupTracked = progressId ? warmupStatuses[progressId] : null;

      const status = linkedProgress?.status || task.status || 'not-started';
      const sessionState = linkedProgress?.progressData?.sessionState;
      const prefetchStatus = String(linkedProgress?.progressData?.sessionPrefetch?.status ?? 'idle').toLowerCase();
      const readinessPayload = linkedProgress?.listeningReadiness ?? null;
      const readinessStatus = warmupTracked?.ready
        ? 'ready'
        : toDashboardCardReadinessStatus(
            readinessPayload?.status ??
              (prefetchStatus === 'ready_partial'
                ? 'ready'
                : prefetchStatus === 'running'
                  ? 'warming'
                  : prefetchStatus),
          );
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

      const progressDurationMinutes =
        typeof linkedProgress?.duration === 'number' && linkedProgress.duration > 0
          ? linkedProgress.duration
          : undefined;
      const taskDurationMinutes =
        typeof task.durationMinutes === 'number' && task.durationMinutes > 0
          ? task.durationMinutes
          : undefined;
      const resolvedDurationMinutes =
        progressDurationMinutes ??
        taskDurationMinutes ??
        DEFAULT_SESSION_MINUTES;

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
        duration: `${resolvedDurationMinutes} min`,
        durationMinutes: resolvedDurationMinutes,
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
        readiness: {
          status: readinessStatus,
          etaSecs:
            typeof readinessPayload?.etaSecs === 'number'
              ? readinessPayload.etaSecs
              : readinessStatus === 'queued' || readinessStatus === 'warming'
                ? 45
                : null,
          updatedAt:
            warmupTracked?.lastUpdatedAt ??
            (typeof readinessPayload?.updatedAt === 'string' ? readinessPayload.updatedAt : null) ??
            (typeof linkedProgress?.progressData?.sessionPrefetch?.updatedAt === 'string'
              ? linkedProgress.progressData.sessionPrefetch.updatedAt
              : null),
          retryCount: Number(
            readinessPayload?.retryCount ??
              linkedProgress?.progressData?.sessionPrefetch?.retryCount ??
              warmupTracked?.sessionInfo?.retryCount ??
              0,
          ),
          attempts: Number(
            readinessPayload?.attempts ??
              linkedProgress?.progressData?.sessionPrefetch?.retryCount ??
              0,
          ),
          message:
            warmupTracked?.sessionInfo?.message ??
            (typeof readinessPayload?.message === 'string' ? readinessPayload.message : null) ??
            (typeof linkedProgress?.progressData?.sessionPrefetch?.message === 'string'
              ? linkedProgress.progressData.sessionPrefetch.message
              : null),
          errorCode:
            warmupTracked?.sessionInfo?.errorCode ??
            (typeof readinessPayload?.errorCode === 'string' ? readinessPayload.errorCode : null) ??
            (typeof linkedProgress?.progressData?.sessionPrefetch?.errorCode === 'string'
              ? linkedProgress.progressData.sessionPrefetch.errorCode
              : null),
          partReady: Boolean(readinessPayload?.partReady ?? warmupTracked?.ready),
        },
        performanceCoachStatus: (() => {
          const statusFromPlan = task.performanceCoachStatus ?? null;
          const statusFromProgress = linkedProgress?.progressData?.performanceCoach?.latest?.closed_loop ?? null;
          if (!statusFromPlan && !statusFromProgress) {
            return null;
          }
          return {
            recommendationAdopted:
              Boolean(statusFromPlan?.recommendationAdopted) ||
              Boolean(statusFromProgress?.recommendation_adopted),
            trendImpact:
              statusFromPlan?.trendImpact ??
              statusFromProgress?.trend_impact ??
              null,
            loopBreakMetric:
              statusFromPlan?.loopBreakMetric ??
              statusFromProgress?.loop_break_metric ??
              null,
            sourceAnalysisId:
              statusFromPlan?.sourceAnalysisId ??
              statusFromProgress?.source_analysis_id ??
              null,
          };
        })(),
      };
      let runtimeEntryState: ListeningRuntimeEntryState | undefined;
      if (sessionState?.status === 'running') {
        runtimeEntryState = 'started';
      } else if (sessionState?.status === 'paused') {
        runtimeEntryState = 'paused';
      } else if (warmupTracked && String(status) !== 'completed') {
        runtimeEntryState = warmupTracked.ready ? 'ready_not_started' : 'warming_up';
      } else if (status === 'in-progress') {
        if (readinessStatus === 'queued' || readinessStatus === 'warming') {
          runtimeEntryState = 'warming_up';
        } else if (readinessStatus === 'ready') {
          runtimeEntryState = 'ready_not_started';
        }
      }

      if (canUseStorage && userId && progressId && resolvedDurationMinutes > 0) {
        const sessionKey = SESSION_START_KEY(userId, todayYmd, progressId);
        const storedStart = readSessionStart(sessionKey);
        if (storedStart) {
          const parsedStart = Number(storedStart);
          if (Number.isFinite(parsedStart) && parsedStart > 0) {
            const totalMs = resolvedDurationMinutes * 60 * 1000;
            const remainingMs = Math.max(0, totalMs - (Date.now() - parsedStart));
            if (remainingMs <= 0) {
              clearSessionStart(sessionKey);
            } else {
              listeningTask.sessionState = {
                status: 'paused',
                remainingMs,
                currentAudioIndex: 0,
              };
              runtimeEntryState = 'paused';
            }
          } else {
            clearSessionStart(sessionKey);
          }
        }
      }
      listeningTask.runtimeEntryState = runtimeEntryState;

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
  }, [
    weeklyPlan,
    schedule,
    progressLookup,
    localProgressOverrides,
    startingTaskKey,
    weekNumber,
    userId,
    todayYmd,
    timeRefreshCounter,
    canUseStorage,
    warmupStatuses,
  ]);

  // Filter to only show available days (or all if testing)
  const filteredDays = useMemo(() => {
    // For now, show all days to see the full structure
    // Can filter later: return tasksByDay.filter(day => day.isAvailable || day.tasks.length > 0);
    return tasksByDay;
  }, [tasksByDay]);

  const flattenedListeningTasks = useMemo(
    () => filteredDays.flatMap((day) => day.tasks),
    [filteredDays],
  );

  useEffect(() => {
    if (authLoading || !authReady || progressLoading || !getToken) {
      return;
    }

    const candidates = flattenedListeningTasks.filter((task) => {
      if (!task.progressId) return false;
      if (task.status === 'completed') return false;
      const readinessStatus = task.readiness?.status ?? 'queued';
      return readinessStatus === 'queued' || readinessStatus === 'warming' || readinessStatus === 'error';
    });
    const toBoost = candidates
      .filter((task) => !dashboardBoostedTaskIdsRef.current.has(String(task.progressId)))
      .slice(0, 3);

    if (toBoost.length === 0) {
      return;
    }

    toBoost.forEach((task) => {
      if (task.progressId) {
        dashboardBoostedTaskIdsRef.current.add(String(task.progressId));
      }
    });

    let cancelled = false;
    void Promise.allSettled(
      toBoost.map((task) =>
        postFreshWithAuth(
          "/api/listening/readiness/boost",
          {
            taskProgressId: task.progressId,
            source: "dashboard_open",
          },
          getToken,
        ),
      ),
    ).then(() => {
      if (!cancelled) {
        void refetchProgress();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, authReady, flattenedListeningTasks, getToken, progressLoading, refetchProgress]);

  const hasPendingDashboardPreparation = useMemo(
    () =>
      flattenedListeningTasks.some((task) => {
        if (!task.progressId) return false;
        if (task.status === 'completed') return false;
        const readinessStatus = task.readiness?.status ?? 'queued';
        return readinessStatus === 'queued' || readinessStatus === 'warming';
      }),
    [flattenedListeningTasks],
  );

  useEffect(() => {
    if (!authReady || progressLoading || !hasPendingDashboardPreparation) {
      return;
    }
    const interval = window.setInterval(() => {
      void refetchProgress();
    }, DASHBOARD_READINESS_POLL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [authReady, hasPendingDashboardPreparation, progressLoading, refetchProgress]);

  useEffect(() => {
    const nextStatuses: Record<string, 'queued' | 'warming' | 'ready' | 'error'> = {};
    for (const task of flattenedListeningTasks) {
      if (!task.progressId) continue;
      const progressId = String(task.progressId);
      const status = task.readiness?.status ?? 'queued';
      nextStatuses[progressId] = status;
      const prev = dashboardCardReadinessRef.current[progressId];
      if (prev && prev !== 'ready' && status === 'ready' && !readyToastEmittedRef.current.has(`dashboard:${progressId}`)) {
        readyToastEmittedRef.current.add(`dashboard:${progressId}`);
        toast({
          title: 'Listening task ready',
          description: `${task.title} is ready. Start now when you’re ready.`,
        });
      }
    }
    dashboardCardReadinessRef.current = nextStatuses;
  }, [flattenedListeningTasks, toast]);

  // Handle task click
  const ensureTaskProgress = async (task: ListeningTask): Promise<string | null> => {
    const cachedId = task.progressId ?? localProgressOverrides[task.localKey];
    if (cachedId) {
      return cachedId;
    }

    try {
      setStartingTaskKey(task.localKey);
      const preToken = await getToken();
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

      const postToken = await getToken();

      return progressId;
    } catch (error: any) {
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

  const mergeWarmupStatus = useCallback((next: StartupGateState) => {
    setWarmupStatuses((prev) => ({
      ...prev,
      [next.progressId]: {
        progressId: next.progressId,
        targetPath: next.targetPath,
        taskTitle: next.taskTitle,
        phase: next.phase,
        etaSecs: next.etaSecs,
        taskSummary: next.taskSummary,
        sessionInfo: next.sessionInfo,
        waiting: next.waiting,
        attempt: next.attempt,
        ready: next.ready,
        lastUpdatedAt: next.lastUpdatedAt,
      },
    }));
  }, []);

  const fetchStartupGateStatus = useCallback(
    async (params: {
      progressId: string;
      taskTitle: string;
      targetPath: string;
      attempt: number;
      prevTaskSummary?: StartupGateState['taskSummary'];
    }): Promise<StartupGateState> => {
      const nowIso = new Date().toISOString();
      try {
        const data = await getFreshWithAuth<any>(
          `/api/firebase/task-content/${encodeURIComponent(params.progressId)}`,
          getToken,
        );
        const ready = Boolean(data?.ready);
        const normalizedPhase = ready ? 'ready' : normalizeListeningWarmupPhase(data?.phase);
        const next: StartupGateState = {
          progressId: params.progressId,
          targetPath: params.targetPath,
          taskTitle: params.taskTitle,
          phase: normalizedPhase,
          etaSecs: typeof data?.etaSecs === 'number' ? data.etaSecs : null,
          taskSummary: data?.taskSummary ?? params.prevTaskSummary ?? null,
          sessionInfo: data?.session ?? null,
          waiting: !ready,
          attempt: params.attempt,
          ready,
          lastUpdatedAt: nowIso,
          panelVisible: true,
          backgroundPolling: !ready,
          pollErrorCount: 0,
        };
        return next;
      } catch (error: any) {
        return {
          progressId: params.progressId,
          targetPath: params.targetPath,
          taskTitle: params.taskTitle,
          phase: 'error',
          etaSecs: null,
          taskSummary: params.prevTaskSummary ?? null,
          sessionInfo: {
            status: 'error',
            retryCount: Math.max(0, params.attempt - 1),
            message: error?.message || 'Unable to fetch startup readiness.',
            errorCode: null,
          },
          waiting: true,
          attempt: params.attempt,
          ready: false,
          lastUpdatedAt: nowIso,
          panelVisible: true,
          backgroundPolling: true,
          pollErrorCount: 1,
        };
      }
    },
    [getToken],
  );

  const openStartupGatePanel = useCallback((state: StartupGateState) => {
    setStartupGateState((prev) => ({
      ...state,
      panelVisible: true,
      backgroundPolling: state.ready ? false : true,
      pollErrorCount: state.phase === 'error' ? Math.max(1, prev?.pollErrorCount ?? 0) : 0,
    }));
    mergeWarmupStatus(state);
  }, [mergeWarmupStatus]);

  const handleStartupGateCancel = useCallback(() => {
    setStartupGateState((prev) => (prev ? { ...prev, panelVisible: false, backgroundPolling: !prev.ready } : prev));
    toast({
      title: 'Preparation continues in background',
      description: "You can leave and come back later. No session time is used while the task is preparing.",
    });
  }, [toast]);

  const handleStartupGateRetry = useCallback(async () => {
    if (!startupGateState) return;
    const nextAttempt = Math.min(startupGateState.attempt + 1, STARTUP_GATE_MAX_ATTEMPTS + 20);
    const refreshed = await fetchStartupGateStatus({
      progressId: startupGateState.progressId,
      taskTitle: startupGateState.taskTitle,
      targetPath: startupGateState.targetPath,
      attempt: nextAttempt,
      prevTaskSummary: startupGateState.taskSummary,
    });
    const nextState: StartupGateState = {
      ...refreshed,
      panelVisible: true,
      backgroundPolling: !refreshed.ready,
      pollErrorCount: refreshed.phase === 'error' ? (startupGateState.pollErrorCount + 1) : 0,
    };
    setStartupGateState(nextState);
    mergeWarmupStatus(nextState);
  }, [fetchStartupGateStatus, mergeWarmupStatus, startupGateState]);

  const handleStartupGateStartNow = useCallback(() => {
    if (!startupGateState?.ready) return;
    const targetPath = startupGateState.targetPath;
    setStartupGateState((prev) => (prev ? { ...prev, panelVisible: false, backgroundPolling: false } : prev));
    setLocation(targetPath);
  }, [setLocation, startupGateState]);

  useEffect(() => {
    if (!startupGateState || !startupGateState.backgroundPolling || startupGateState.ready) {
      return;
    }

    const delay = Math.min(
      STARTUP_GATE_POLL_BASE_MS * Math.max(1, 2 ** Math.min(startupGateState.pollErrorCount, 4)),
      STARTUP_GATE_POLL_MAX_MS,
    );

    const timer = window.setTimeout(() => {
      void (async () => {
        const refreshed = await fetchStartupGateStatus({
          progressId: startupGateState.progressId,
          taskTitle: startupGateState.taskTitle,
          targetPath: startupGateState.targetPath,
          attempt: startupGateState.attempt + 1,
          prevTaskSummary: startupGateState.taskSummary,
        });
        const nextState: StartupGateState = {
          ...refreshed,
          panelVisible: startupGateState.panelVisible,
          backgroundPolling: !refreshed.ready,
          pollErrorCount:
            refreshed.phase === 'error'
              ? Math.min(8, startupGateState.pollErrorCount + 1)
              : 0,
        };
        setStartupGateState((prev) => {
          if (!prev || prev.progressId !== startupGateState.progressId) {
            return prev;
          }
          return nextState;
        });
        mergeWarmupStatus(nextState);

        if (refreshed.ready) {
          void refetchProgress();
          if (!startupGateState.panelVisible && !readyToastEmittedRef.current.has(refreshed.progressId)) {
            readyToastEmittedRef.current.add(refreshed.progressId);
            toast({
              title: 'Listening task ready',
              description: `${refreshed.taskTitle} is ready to start.`,
            });
          }
        }
      })();
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fetchStartupGateStatus, mergeWarmupStatus, refetchProgress, startupGateState, toast]);

  const handleTaskClick = async (task: ListeningTask) => {
    if (startingTaskKey && startingTaskKey === task.localKey) return;
    if (startupGateState?.panelVisible) return;
    if (authLoading || !authReady) return;

    if (!canUseStorage) {
      toast({
        title: "Browser storage unavailable",
        description: "Please use a modern browser to continue.",
        variant: "destructive",
      });
      return;
    }

    // Start (even if userId still null) — withAuthRetry already handles auth.
    const existingId = task.progressId ?? localProgressOverrides[task.localKey] ?? null;
    const progressId = existingId ?? (await ensureTaskProgress(task));

    if (!progressId) {
      return;
    }

    void postFreshWithAuth(
      "/api/listening/readiness/boost",
      {
        taskProgressId: progressId,
        source: "dashboard_start_click",
      },
      getToken,
    ).catch(() => undefined);

    await getToken();

    const targetPath = `/practice/${encodeURIComponent(progressId)}?progressId=${encodeURIComponent(progressId)}&taskId=${encodeURIComponent(task.id)}`;
    const tracked = warmupStatuses[progressId];
    if (tracked?.ready) {
      setLocation(targetPath);
      return;
    }

    if (tracked && !tracked.ready) {
      setStartupGateState({
        ...tracked,
        targetPath,
        panelVisible: true,
        backgroundPolling: true,
        pollErrorCount: tracked.phase === 'error' ? 1 : 0,
      });
      return;
    }

    const initial = await fetchStartupGateStatus({
      progressId,
      taskTitle: task.title,
      targetPath,
      attempt: 1,
      prevTaskSummary: null,
    });
    if (initial.ready) {
      mergeWarmupStatus(initial);
      setLocation(targetPath);
      return;
    }

    openStartupGatePanel({
      ...initial,
      panelVisible: true,
      backgroundPolling: true,
      pollErrorCount: initial.phase === 'error' ? 1 : 0,
    });
    toast({
      title: 'Preparing Part 1',
      description: "We'll keep preparing in the background. You can leave and return without losing time.",
    });
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
          <Link
            href="/dashboard/calendar"
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
          >
            <span className="hidden sm:inline">View Calendar</span>
            <ChevronRight className="h-4 w-4" />
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
        {startupGateState?.panelVisible && (
          <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-900">
              {startupGateState.ready ? 'Part 1 is ready' : 'Preparing Part 1 before opening practice'}
            </p>
            <p className="mt-1 text-sm text-blue-800">
              {startupGateState.taskTitle}
            </p>
            <SessionWarmup
              phase={startupGateState.phase}
              ready={startupGateState.ready}
              etaSecs={startupGateState.etaSecs}
              taskSummary={startupGateState.taskSummary}
              sessionInfo={startupGateState.sessionInfo}
              attemptCount={startupGateState.attempt}
              lastUpdatedAt={startupGateState.lastUpdatedAt}
              backgroundPolling={startupGateState.backgroundPolling}
              skillType="listening"
              onRefresh={() => {
                void handleStartupGateRetry();
              }}
            />
            <div className="mt-3 rounded-md border border-blue-200 bg-white/70 p-3">
              <p className="text-xs text-blue-900 font-medium">
                {startupGateState.ready
                  ? 'You can start now. The session timer will begin only after the session actually starts.'
                  : "We'll keep preparing in the background. You can leave this panel and come back later."}
              </p>
              <p className="mt-1 text-xs text-blue-700">
                Latest attempt {startupGateState.attempt}
                {startupGateState.lastUpdatedAt ? ` • Updated ${new Date(startupGateState.lastUpdatedAt).toLocaleTimeString()}` : ''}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {startupGateState.ready ? (
                <Button type="button" onClick={handleStartupGateStartNow}>
                  Start session now
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => void handleStartupGateRetry()}>
                  Check again now
                </Button>
              )}
              <Button type="button" variant="outline" onClick={handleStartupGateCancel}>
                {startupGateState.ready ? 'Hide panel' : 'Leave and come back later'}
              </Button>
              {!startupGateState.ready && (
                <span className="text-xs text-blue-700">
                  Background polling active (max delay {Math.round(STARTUP_GATE_POLL_MAX_MS / 1000)}s)
                </span>
              )}
            </div>
          </div>
        )}
        <div className="divide-y divide-gray-100">
          {filteredDays.map((day) => (
            <DaySection
              key={day.dayIndex}
              dayName={day.dayName}
              date={day.date}
              tasks={day.tasks}
              isAvailable={day.isAvailable}
              onTaskClick={handleTaskClick}
              ctaDisabled={authLoading || !authReady || Boolean(startupGateState?.panelVisible)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default React.memo(ListeningWeeklyPlan);
