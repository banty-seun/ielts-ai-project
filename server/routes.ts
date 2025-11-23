import express, { type Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { verifyFirebaseAuth, ensureFirebaseUser } from "./firebaseAuth";
import { batchInitializeTaskProgress } from "./controllers/taskProgressController";
import { getTaskProgressById } from "./controllers/getTaskProgressController";
import { v4 as uuidv4 } from 'uuid';
import { generateIELTSPlan, generateIELTSPlan_debugWrapper, generateListeningScriptForTask, generateQuestionsFromScript, generateListeningSessionPackage, generateListeningStudyPlan, generateAdvisorFeedback } from "./openai";
import { generateAudioFromScript, checkAudioExists } from "./audioService";
import { registerRegenerateRoutes } from "./routes/regenerate";
import {
  DEFAULT_ACCENT,
  DEFAULT_SESSION_MINUTES,
  LISTENING_SESSION_MINUTES,
  NEXT_MIN_MS,
} from "../shared/constants";
import { makeListeningTaskTitle, needsTitleUpdate } from "./services/title";
import { createFollowUpListeningTask, ensureListeningSegments } from "./services/taskFactory";
import {
  buildAvailabilityFromSchedule,
  deriveWeightsFromSkillRatings,
  getIsoDayForDate,
  getDayNameForIsoDay,
  resolveWeekStart,
  type Skill,
  SKILL_ORDER,
  assignSkillsToDays,
} from "./services/planDistributor";
import { getForwardWeekWindows, enumerateDays, addDaysUtc } from "./services/weekWindow";
import { ensureProgressForWeeklyPlan } from "./services/progress";
import { resolveSessionMinutesFromTask } from "./services/sessionDuration";
import { minutesToLabel } from "./utils/time.ts";
import { normalizeAccent } from "./utils/audio.ts";
import { retryPrefetchJob, shouldRetryError } from "./services/prefetchRetry";
import { scoreSegment } from "./services/scoring";
import { buildSessionFeedback } from "./services/feedback";
import { getRecentListeningSummaries } from "./services/perfStore";
import { ensureSegmentsForTaskProgress, ensureSegmentsForTasks } from "./services/progressSegments";
import { validateTranscriptComplete } from "./services/content";

/**
 * Maps onboarding commitment text to numeric minutes
 * Handles formats: "30mins", "1hour", "2hours+", "30 mins", "1 hr", "2 hrs"
 */
function mapToMinutes(value?: string): number {
  if (!value) return 60; // Default to 1 hour if not specified

  const lower = value.toLowerCase().replace(/\s+/g, ''); // Remove spaces

  // Check for specific patterns
  if (lower.includes('30')) return 30;
  if (lower.includes('2')) return 120;
  if (lower.includes('1')) return 60;

  // Default fallback
  return 60;
}

const DEFAULT_ONBOARDING_MINUTES = 30;
type DailyCommitment = '30mins' | '1hour' | '2hours+';
type SchedulePreference = 'weekday' | 'weekend' | 'both';
type LearningStyle = 'ai-guided' | 'self-paced' | 'mixed';
const DEFAULT_STUDY_PREFERENCES: {
  dailyCommitment: DailyCommitment;
  schedule: SchedulePreference;
  style: LearningStyle;
} = {
  dailyCommitment: '30mins',
  schedule: 'both',
  style: 'ai-guided',
};

const isDailyCommitment = (value: unknown): value is DailyCommitment =>
  value === '30mins' || value === '1hour' || value === '2hours+';

const isSchedulePreference = (value: unknown): value is SchedulePreference =>
  value === 'weekday' || value === 'weekend' || value === 'both';

const isLearningStyle = (value: unknown): value is LearningStyle =>
  value === 'ai-guided' || value === 'self-paced' || value === 'mixed';

function normalizeStudyPreferences(preferences?: Record<string, any>) {
  const normalized = { ...(preferences ?? {}) };
  const sessionMinutesCandidate = Number(normalized.sessionMinutes);
  const sessionMinutes =
    Number.isFinite(sessionMinutesCandidate) && sessionMinutesCandidate > 0
      ? Math.round(sessionMinutesCandidate)
      : DEFAULT_ONBOARDING_MINUTES;

  const dailyCommitment: DailyCommitment = isDailyCommitment(normalized.dailyCommitment)
    ? normalized.dailyCommitment
    : DEFAULT_STUDY_PREFERENCES.dailyCommitment;

  const schedule: SchedulePreference = isSchedulePreference(normalized.schedule)
    ? normalized.schedule
    : DEFAULT_STUDY_PREFERENCES.schedule;

  const style: LearningStyle = isLearningStyle(normalized.style)
    ? normalized.style
    : DEFAULT_STUDY_PREFERENCES.style;

  const listeningDurations = normalized.listeningDurations ?? {};
  const weekdayMinutes =
    typeof listeningDurations.weekday === 'number' && listeningDurations.weekday > 0
      ? Math.round(listeningDurations.weekday)
      : sessionMinutes;
  const weekendMinutes =
    typeof listeningDurations.weekend === 'number' && listeningDurations.weekend > 0
      ? Math.round(listeningDurations.weekend)
      : weekdayMinutes;

  return {
    dailyCommitment,
    schedule,
    style,
    sessionMinutes,
    listeningDurations: {
      weekday: weekdayMinutes,
      weekend: weekendMinutes,
    },
  };
}

function normalizeListeningActivity(activity: any) {
  const durationMinutes =
    typeof activity.dayDurationMinutes === "number"
      ? activity.dayDurationMinutes
      : typeof activity.duration === "string"
        ? parseInt(activity.duration.replace(/\D/g, ""), 10) || undefined
        : undefined;

  const resolvedMinutes = durationMinutes ?? 30;

  return {
    ...activity,
    duration: minutesToLabel(resolvedMinutes),
    durationMinutes: resolvedMinutes,
  };
}

/**
 * Helper function to pre-generate scripts for listening tasks
 * Called during plan creation to ensure scripts are ready when users start tasks
 */
const PREFETCH_AUDIO_COUNT = 4;
const TARGET_AUDIO_SECONDS = 360;
const PREFETCH_RETRY_DELAYS = [5_000, 30_000, 120_000];
const PREFETCH_STATUS_IDLE = 'idle' as const;
const PREFETCH_STATUS_QUEUED = 'queued' as const;
const PREFETCH_STATUS_RUNNING = 'running' as const;
const PREFETCH_STATUS_READY = 'ready' as const;
const PREFETCH_STATUS_READY_PARTIAL = 'ready_partial' as const;
const PREFETCH_STATUS_ERROR = 'error' as const;

// Feature flag for task duration normalization
const NORMALIZE_TASK_DURATION = process.env.NORMALIZE_TASK_DURATION !== 'false'; // Default: true

// Timezone for weekday/weekend calculation (server default)
const PLANNER_TZ = process.env.TZ || 'UTC';

// Type for normalized task
interface NormalizedTask {
  durationMinutes: number;
  duration: string;
  audio?: {
    estimatedDurationSec?: number;
    accent?: string;
  };
  [key: string]: any;
}

interface FormattedListeningEntry {
  dayNumber: number;
  sequenceNumber: number;
  taskTitle: string;
  scriptType: string;
  contextLabel: string;
  topicDomain: string;
  scenarioOverview: string;
  accent?: string;
  estimatedDurationSec: number;
  durationLabel: string;
  dayType: string;
  dayDurationMinutes: number;
  sessionMinutes: number;
  description: string;
  conversationType: string | null;
  assignedDate: string;
}

const resolveSessionDurations = (preferences: any, defaultMinutes: number) => {
  const listeningDurations = (preferences?.listeningDurations ?? {}) as Record<string, any>;
  const weekday = typeof listeningDurations.weekday === "number" ? listeningDurations.weekday : defaultMinutes;
  const weekend = typeof listeningDurations.weekend === "number" ? listeningDurations.weekend : weekday;

  return {
    weekday,
    weekend,
  };
};

/**
 * Normalizes task durations to use user's session preferences instead of script estimatedDurationSec
 * Moves audio metadata to nested object to prevent UI confusion
 */
function normalizeTaskDuration(
  task: any,
  options: {
    weekdayDuration: number;
    weekendDuration: number;
    dayNumber?: number;
    date?: Date | string;
  }
): NormalizedTask {
  if (!NORMALIZE_TASK_DURATION) {
    return task; // Feature flag disabled, return as-is
  }

  const { weekdayDuration, weekendDuration, dayNumber, date } = options;

  // Determine if weekend using dayNumber (1=Mon, 7=Sun) or date
  let isWeekend = false;
  if (date) {
    const taskDate = typeof date === 'string' ? new Date(date) : date;
    // Create a date string in the target timezone, then parse to get day of week
    const tzDateStr = taskDate.toLocaleString('en-US', { timeZone: PLANNER_TZ });
    const dayOfWeek = new Date(tzDateStr).getDay(); // 0=Sunday, 6=Saturday
    isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  } else if (dayNumber) {
    const normalizedDay = ((dayNumber - 1) % 7) + 1;
    isWeekend = normalizedDay === 6 || normalizedDay === 7; // Saturday=6, Sunday=7
  }

  // Choose correct duration
  const taskDuration = isWeekend ? weekendDuration : weekdayDuration;

  // Build normalized task
  const normalized: NormalizedTask = {
    ...task,
    // ✅ Force-set correct labels
    durationMinutes: taskDuration,
    duration: `${taskDuration} min`, // force good label
  };

  // Remove legacy fields that could cause confusion
  delete (normalized as any).durationLabel; // old 6-min source
  delete (normalized as any).estimatedDurationSec; // move under audio

  // Move audio metadata to nested object
  normalized.audio = {
    ...(normalized.audio ?? {}),
    estimatedDurationSec: task.estimatedDurationSec ?? normalized.audio?.estimatedDurationSec ?? TARGET_AUDIO_SECONDS,
    accent: task.accent,
  };

  console.log('[normalizeTaskDuration]', {
    outDurationMinutes: normalized.durationMinutes,
    outDuration: normalized.duration,
    audioSec: normalized.audio?.estimatedDurationSec,
  });

  return normalized;
}

const determineDayType = (options: { dayNumber?: number; explicit?: string; assignedDate?: string | Date }) => {
  const explicitLower = typeof options.explicit === "string" ? options.explicit.toLowerCase() : undefined;
  if (explicitLower === "weekday" || explicitLower === "weekend") {
    return explicitLower;
  }

  if (options.assignedDate) {
    const parsed = new Date(options.assignedDate);
    if (!Number.isNaN(parsed.getTime())) {
      const iso = getIsoDayForDate(parsed, PLANNER_TZ);
      return iso === 6 || iso === 7 ? "weekend" : "weekday";
    }
  }

  const normalizedDay = ((Number(options.dayNumber ?? 1) - 1) % 7) + 1;
  return normalizedDay === 6 || normalizedDay === 7 ? "weekend" : "weekday";
};

const isoDayToDayType = (isoDay: number) => (isoDay === 6 || isoDay === 7 ? "weekend" : "weekday");

const resolveWeekWindow = (opts: { weekNumber: number; tz: string; referenceDate?: Date }) => {
  const { weekNumber, tz } = opts;
  const referenceDate = opts.referenceDate ?? new Date();
  const windows = getForwardWeekWindows(referenceDate, tz);

  if (weekNumber === 1) {
    return { start: windows.week1Start, end: windows.week1End };
  }

  if (weekNumber === 2) {
    return { start: windows.week2Start, end: windows.week2End };
  }

  const offsetWeeks = weekNumber - 2;
  const start = addDaysUtc(windows.week2Start, offsetWeeks * 7);
  const end = addDaysUtc(start, 6);
  return { start, end };
};

const mapPackageQuestions = (questions: any[]): TaskQuestion[] => {
  return (Array.isArray(questions) ? questions : []).slice(0, 10).map((q, idx) => {
    const rawOptions = Array.isArray(q?.options) ? q.options : [];
    const options = rawOptions.slice(0, 4).map((opt: any, optionIdx: number) => ({
      id: `option${optionIdx + 1}`,
      text: typeof opt === "string" ? opt : String(opt ?? `Option ${optionIdx + 1}`),
    }));

    return {
      id: typeof q?.id === "string" ? q.id : `q${idx + 1}`,
      question: typeof q?.question === "string" ? q.question : "",
      options,
      correctAnswer: typeof q?.correctAnswer === "string" ? q.correctAnswer : undefined,
      explanation: typeof q?.explanation === "string" ? q.explanation : undefined,
    };
  }).filter((q) => q.question.trim().length > 0 && (q.options?.length ?? 0) === 4);
};

const chunkQuestionIds = (ids: string[], segmentCount: number, index: number) => {
  if (!ids.length || segmentCount <= 0) return [];
  const start = Math.floor((index / segmentCount) * ids.length);
  const rawEnd = Math.floor(((index + 1) / segmentCount) * ids.length);
  const end = Math.max(start + 1, rawEnd);
  return ids.slice(start, end);
};

const deriveSegmentAssignments = (task: TaskProgressRecord) => {
  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
  const existingAssignments = progressData.segmentAssignments ?? {};

  if (!segments.length) {
    return { assignments: existingAssignments, changed: false };
  }

  const questions = Array.isArray(task.questions) ? task.questions : [];
  const questionIds = questions.map((q: any, idx: number) => String(q?.id ?? `q${idx + 1}`)).filter(Boolean);

  if (!questionIds.length) {
    return { assignments: existingAssignments, changed: false };
  }

  let changed = false;
  const assignments: Record<string, string[]> = { ...existingAssignments };

  segments.forEach((segment, index) => {
    const segId = segment?.id ?? `segment-${index + 1}`;
    if (!Array.isArray(assignments[segId]) || !assignments[segId].length) {
      assignments[segId] = chunkQuestionIds(questionIds, segments.length, index);
      changed = true;
    }
  });

  return { assignments, changed };
};

const buildMistakeHistogram = (segmentResults: Array<Record<string, any>>) => {
  const histogram: Record<string, { correct: number; total: number }> = {};
  segmentResults.forEach((result) => {
    const tagStats = (result?.tagStats ?? {}) as Record<string, { correct?: number; total?: number }>;
    Object.entries(tagStats).forEach(([tag, stats]) => {
      if (!histogram[tag]) {
        histogram[tag] = { correct: 0, total: 0 };
      }
      histogram[tag].correct += Number(stats.correct ?? 0);
      histogram[tag].total += Number(stats.total ?? 0);
    });
  });
  return histogram;
};

// Legacy function kept for backward compatibility - delegates to centralized retry
const schedulePrefetchRetry = async (taskId: string, userId: string, retryCount: number, batchId?: string, errorCode?: string) => {
  await retryPrefetchJob(
    {
      taskId,
      userId,
      batchId: batchId ?? 'unknown',
      errorCode,
      currentRetryCount: retryCount,
      skillType: 'listening',
    },
    ensureListeningSessionPrefetch
  );
};

const enqueueListeningPrefetch = async (task: TaskProgressRecord, userId: string) => {
  if (!task.weeklyPlanId || (task.skill && task.skill.toLowerCase() !== 'listening')) {
    return;
  }

  const progressData = (task.progressData ?? {}) as Record<string, any>;
  const sessionPrefetch = progressData.sessionPrefetch ?? {};
  const status = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;

  if (status === PREFETCH_STATUS_QUEUED || status === PREFETCH_STATUS_RUNNING) {
    return;
  }

  const batchId = typeof progressData.sessionBatchId === 'string' && progressData.sessionBatchId.length > 0
    ? progressData.sessionBatchId
    : uuidv4();
  const nowIso = new Date().toISOString();

  const queuedProgress = {
    ...progressData,
    sessionBatchId: batchId,
    sessionPrefetch: {
      ...sessionPrefetch,
      batchId,
      status: PREFETCH_STATUS_QUEUED,
      ready: false,
      retryCount: sessionPrefetch.retryCount ?? 0,
      startedAt: sessionPrefetch.startedAt ?? nowIso,
      updatedAt: nowIso,
      message: 'Preparing listening session assets',
    },
  };

  await storage.updateTaskStatus(task.id, task.status ?? 'not-started', queuedProgress);
  task.progressData = queuedProgress;

  setImmediate(() => {
    ensureListeningSessionPrefetch(task.id, userId).catch((err) => {
      console.error('[Session Prefetch] Prefetch task failed to start', err);
    });
  });
};

async function ensureListeningSessionPrefetch(taskId: string, userId: string): Promise<void> {
  let task: TaskProgressRecord | undefined;
  let prefetchStartMs = Date.now();
  let logContext: any = { taskId, userId };

  try {
    task = await storage.getTaskWithContent(taskId);
    if (!task || task.userId !== userId) {
      return;
    }

    if (!task.weeklyPlanId || (task.skill && task.skill.toLowerCase() !== 'listening')) {
      return;
    }

    const progressData = (task.progressData ?? {}) as Record<string, any>;
    const sessionPrefetch = progressData.sessionPrefetch ?? {};
    const currentStatus = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
    if (sessionPrefetch.ready && (currentStatus === PREFETCH_STATUS_READY || currentStatus === PREFETCH_STATUS_READY_PARTIAL)) {
      return;
    }

    if (currentStatus === PREFETCH_STATUS_RUNNING) {
      return;
    }

    const sessionBatchId =
      typeof progressData.sessionBatchId === 'string' && progressData.sessionBatchId.length > 0
        ? progressData.sessionBatchId
        : uuidv4();

    const studyPlans = await storage.getStudyPlansByUserId(userId);
    if (!studyPlans.length) {
      return;
    }

    const latestPlan = studyPlans[studyPlans.length - 1];
    const storedPreferences = (latestPlan.studyPreferences as any) ?? {};
    const defaultSessionMinutes =
      typeof storedPreferences.sessionMinutes === 'number'
        ? storedPreferences.sessionMinutes
        : DEFAULT_SESSION_MINUTES;
    const durations = resolveSessionDurations(storedPreferences, defaultSessionMinutes);

    const baseDayType = determineDayType({
      dayNumber: task.dayNumber ?? 1,
      explicit: sessionPrefetch.dayType,
      assignedDate: sessionPrefetch.assignedDate ?? task.startedAt ?? task.createdAt,
    });
    let sessionMinutes = baseDayType === 'weekend' ? durations.weekend : durations.weekday;
    sessionMinutes = Math.max(sessionMinutes, LISTENING_SESSION_MINUTES);

    const skillRatings = (latestPlan.skillRatings as Record<string, number>) ?? {};
    const targetBand = parseFloat(String(latestPlan.targetBandScore ?? 7)) || 7;
    const userLevel = Number(skillRatings.listening ?? 1);

    const activityType =
      sessionPrefetch.activityType === 'monologue' || sessionPrefetch.activityType === 'dialogue'
        ? sessionPrefetch.activityType
        : task.scriptType === 'monologue'
          ? 'monologue'
          : 'dialogue';

    const scenario =
      typeof sessionPrefetch.scenario === 'string' && sessionPrefetch.scenario.trim().length > 0
        ? sessionPrefetch.scenario
        : typeof task.contextLabel === 'string' && task.contextLabel.trim().length > 0
          ? task.contextLabel
          : typeof task.topicDomain === 'string' && task.topicDomain.trim().length > 0
            ? task.topicDomain
            : task.taskTitle ?? 'Listening Practice';

    const accent = normalizeAccent(
      typeof sessionPrefetch.accent === 'string' ? sessionPrefetch.accent : task.accent ?? 'British'
    );

    const nowIso = new Date().toISOString();
    prefetchStartMs = Date.now();

    // Instrumentation: Log prefetch start
    logContext = {
      batchId: sessionBatchId,
      userId,
      taskId,
      activityType,
      scenario,
      accent,
      sessionMinutes,
      prefetchCount: PREFETCH_AUDIO_COUNT,
    };
    console.log('[Prefetch][Start]', logContext);

    const runningProgress = {
      ...progressData,
      sessionBatchId,
      sessionPrefetch: {
        ...sessionPrefetch,
        batchId: sessionBatchId,
        status: PREFETCH_STATUS_RUNNING,
        ready: false,
        retryCount: sessionPrefetch.retryCount ?? 0,
        activityType,
        scenario,
        accent,
        sessionMinutes,
        dayType: baseDayType,
        startedAt: sessionPrefetch.startedAt ?? nowIso,
        updatedAt: nowIso,
        message: 'Generating listening session assets',
      },
    };

    await storage.updateTaskStatus(task.id, task.status ?? 'not-started', runningProgress);
    task.progressData = runningProgress;

    const pendingScriptsQueue = Array.isArray(sessionPrefetch.pendingScripts)
      ? (sessionPrefetch.pendingScripts as any[])
      : [];

    let audioItemsSource: Array<{ script: any; questions: any[] }> = [];
    let audioValidations: Array<{ ok: boolean; reason?: string }> = [];
    let expectedPrefetchCount = PREFETCH_AUDIO_COUNT;
    let packageAccent = accent;

    if (pendingScriptsQueue.length > 0 && currentStatus === PREFETCH_STATUS_ERROR) {
      audioItemsSource = pendingScriptsQueue.map((item: any) => ({
        script: {
          script: item.scriptText,
          scriptType: item.scriptType,
          topicDomain: item.topicDomain,
          contextLabel: item.contextLabel,
          scenarioOverview: item.scenarioOverview,
          accent: item.scriptAccent ?? accent,
          estimatedDurationSec: TARGET_AUDIO_SECONDS,
        },
        questions: item.questions ?? [],
      }));
      audioValidations = audioItemsSource.map((item) =>
        validateTranscriptComplete(typeof item?.script?.script === 'string' ? item.script.script : ''),
      );
      expectedPrefetchCount = pendingScriptsQueue.length;
    } else {
      const maxPackageAttempts = 3;
      let generatedPackage: Awaited<ReturnType<typeof generateListeningSessionPackage>> | null = null;
      for (let attempt = 0; attempt < maxPackageAttempts; attempt++) {
        const candidate = await generateListeningSessionPackage({
          activityType: activityType as 'dialogue' | 'monologue',
          scenario,
          sessionDurationMinutes: sessionMinutes,
          targetBand,
          userLevel,
          accent,
          prefetchCount: PREFETCH_AUDIO_COUNT,
        });
        const validations = candidate.audios.map((audio) =>
          validateTranscriptComplete(typeof audio?.script?.script === 'string' ? audio.script.script : ''),
        );
        const invalidCount = validations.filter((val) => !val.ok).length;
        if (!invalidCount) {
          generatedPackage = candidate;
          audioValidations = validations;
          break;
        }
        if (attempt === maxPackageAttempts - 1) {
          generatedPackage = candidate;
          audioValidations = validations;
          console.warn('[Session Prefetch] Using package with incomplete scripts after retries', {
            invalidCount,
          });
        } else {
          console.warn('[Session Prefetch] Script validation failed, retrying package generation', {
            attempt: attempt + 1,
            invalidCount,
          });
        }
      }

      if (!generatedPackage) {
        throw new Error('Failed to generate listening session package');
      }

      audioItemsSource = generatedPackage.audios;
      packageAccent = generatedPackage.session.accent ?? accent;
      expectedPrefetchCount = Math.min(PREFETCH_AUDIO_COUNT, audioItemsSource.length);
    }

    const planTasks = await storage.getTaskProgressByWeeklyPlan(task.weeklyPlanId, userId);
    const existingByOrder = new Map<number, TaskProgressRecord>();
    for (const existing of planTasks) {
      const pd = (existing.progressData ?? {}) as Record<string, any>;
      if (pd?.sessionBatchId === sessionBatchId && typeof pd?.sessionOrder === 'number') {
        existingByOrder.set(pd.sessionOrder, existing);
      }
    }

    let successCount = 0;
    const pendingScripts: any[] = [];
    const audioItems = audioItemsSource.slice(0, PREFETCH_AUDIO_COUNT);

    const awsConfigured = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    if (!awsConfigured) {
      throw Object.assign(new Error('Missing AWS credentials for Polly'), { code: 'POLLY_AUTH' });
    }

    for (let idx = 0; idx < audioItems.length; idx++) {
      const order = idx + 1;
      const audioItem = audioItems[idx];
      const script = audioItem?.script ?? {};
      const scriptText = typeof script.script === 'string' ? script.script : '';
      if (!scriptText.trim()) {
        continue;
      }

      const questions = mapPackageQuestions(audioItem.questions);
      if (!questions.length) {
        continue;
      }

      const scriptValidation = audioValidations[idx] ?? validateTranscriptComplete(scriptText);
      if (!scriptValidation.ok) {
        console.warn('[Session Prefetch] Script failed validation, queued for regeneration', {
          order,
          reason: scriptValidation.reason,
        });
        pendingScripts.push({
          order,
          scriptText,
          questions,
          scriptType: typeof script.scriptType === 'string' ? script.scriptType : activityType,
          scriptAccent: script.accent ?? packageAccent,
          scenarioOverview: script.scenarioOverview,
          topicDomain: script.topicDomain,
          contextLabel: script.contextLabel,
          validationReason: scriptValidation.reason ?? 'invalid',
        });
        continue;
      }

      const scriptAccent = normalizeAccent(script.accent ?? packageAccent);
      const scriptType =
        script.scriptType === 'monologue' || script.scriptType === 'dialogue'
          ? script.scriptType
          : activityType;
      const scenarioOverview =
        typeof script.scenarioOverview === 'string'
          ? script.scenarioOverview
          : `${scenario} listening task`;
      const topicDomain =
        typeof script.topicDomain === 'string' ? script.topicDomain : scenario;
      const contextLabel =
        typeof script.contextLabel === 'string' ? script.contextLabel : topicDomain;

      let targetTask: TaskProgressRecord | undefined = order === 1
        ? task
        : existingByOrder.get(order);

      if (!targetTask) {
        const generatedTitle = makeListeningTaskTitle({
          scriptType,
          contextLabel,
          topicDomain,
          scenarioOverview,
        });

        const createdTask = await storage.createTaskProgress({
          id: uuidv4(),
          userId: task.userId,
          weeklyPlanId: task.weeklyPlanId,
          weekNumber: task.weekNumber,
          dayNumber: task.dayNumber,
          taskTitle: generatedTitle,
          skill: 'listening',
          status: 'not-started',
          scriptType,
          accent: scriptAccent,
          topicDomain,
          contextLabel,
          scenarioOverview,
          estimatedDurationSec: TARGET_AUDIO_SECONDS,
          duration: sessionMinutes,
          replayLimit: 3,
          progressData: {
            sessionBatchId,
            sessionOrder: order,
            sessionDurationMinutes: sessionMinutes,
            audioDurationSec: TARGET_AUDIO_SECONDS,
            sessionPrefetch: {
              batchId: sessionBatchId,
              order,
              total: PREFETCH_AUDIO_COUNT,
              ready: false,
              activityType,
              scenario,
              accent: scriptAccent,
              sessionMinutes,
              dayType: baseDayType,
              createdAt: nowIso,
            },
          },
        } as any);

        targetTask = createdTask;
        existingByOrder.set(order, createdTask);
      }

      const audioResult = await generateAudioFromScript(
        scriptText,
        scriptAccent,
        userId,
        targetTask.id,
        task.weekNumber ?? 1
      );

      if (!audioResult.success || !audioResult.audioUrl) {
        console.error('[Session Prefetch] Audio generation failed', {
          taskId: targetTask.id,
          order,
          reason: audioResult.error ?? 'unknown',
        });
        pendingScripts.push({
          order,
          scriptText,
          questions,
          scriptType,
          scriptAccent,
          scenarioOverview,
          topicDomain,
          contextLabel,
          failureReason: audioResult.error ?? 'audio_generation_failed',
        });
      }

      const derivedTitle = makeListeningTaskTitle({
        scriptType,
        contextLabel,
        topicDomain,
        scenarioOverview,
      });

      const targetTaskTitle =
        order === 1
          ? task.taskTitle ?? derivedTitle
          : targetTask.taskTitle ?? derivedTitle;

      const updatePayload: Record<string, any> = {
        scriptText,
        scriptType,
        difficulty: `Band ${targetBand}`,
        accent: scriptAccent,
        topicDomain,
        contextLabel,
        scenarioOverview,
        estimatedDurationSec: TARGET_AUDIO_SECONDS,
        questions,
        taskTitle: targetTaskTitle,
        duration: resolveSessionMinutesFromTask(targetTask, sessionMinutes),
        ieltsPart:
          script.ieltsPart === 1 || script.ieltsPart === 2 || script.ieltsPart === 3 || script.ieltsPart === 4
            ? script.ieltsPart
            : null,
      };

      if (audioResult.success && audioResult.audioUrl) {
        updatePayload.audioUrl = audioResult.audioUrl;
      }

      await storage.updateTaskContent(targetTask.id, updatePayload);

      const audioReady = Boolean(audioResult.audioUrl);
      const taskStatus = audioReady ? PREFETCH_STATUS_RUNNING : PREFETCH_STATUS_ERROR;

      const mergedProgressData = {
        ...(targetTask.progressData ?? {}),
        sessionBatchId,
        sessionOrder: order,
        sessionDurationMinutes: sessionMinutes,
        audioDurationSec: TARGET_AUDIO_SECONDS,
        sessionPrefetch: {
          ...(targetTask.progressData as any)?.sessionPrefetch,
          batchId: sessionBatchId,
          status: taskStatus,
          order,
          total: PREFETCH_AUDIO_COUNT,
          ready: audioReady,
          activityType,
          scenario,
          accent: scriptAccent,
          sessionMinutes,
          dayType: baseDayType,
          createdAt: nowIso,
          updatedAt: new Date().toISOString(),
          audioUrl: audioResult.audioUrl ?? null,
        },
      };

      await storage.updateTaskStatus(
        targetTask.id,
        targetTask.status ?? 'not-started',
        mergedProgressData
      );

      if (audioReady) {
        successCount += 1;
      }
    }

    const completedAt = new Date().toISOString();
    const allAudiosAvailable = successCount >= expectedPrefetchCount && expectedPrefetchCount > 0;
    const partialReady = allAudiosAvailable && expectedPrefetchCount < PREFETCH_AUDIO_COUNT;

    const finalStatus = allAudiosAvailable
      ? (partialReady ? PREFETCH_STATUS_READY_PARTIAL : PREFETCH_STATUS_READY)
      : PREFETCH_STATUS_ERROR;

    const finalProgress = {
      ...progressData,
      sessionBatchId,
      sessionPrefetch: {
        ...sessionPrefetch,
        batchId: sessionBatchId,
        status: finalStatus,
        ready: finalStatus === PREFETCH_STATUS_READY || finalStatus === PREFETCH_STATUS_READY_PARTIAL,
        activityType,
        scenario,
        accent: packageAccent,
        sessionMinutes,
        dayType: baseDayType,
        updatedAt: completedAt,
        completedAt,
        successCount,
        expected: expectedPrefetchCount,
        partial: partialReady,
        retryCount: finalStatus === PREFETCH_STATUS_READY || finalStatus === PREFETCH_STATUS_READY_PARTIAL
          ? 0
          : sessionPrefetch.retryCount ?? 0,
        pendingScripts: allAudiosAvailable ? undefined : pendingScripts,
        message: finalStatus === PREFETCH_STATUS_READY
          ? 'Listening session ready'
          : finalStatus === PREFETCH_STATUS_READY_PARTIAL
            ? 'Listening session ready (partial set available)'
            : finalStatus === PREFETCH_STATUS_ERROR
              ? (sessionPrefetch.message ?? 'Failed to prepare listening session assets')
              : sessionPrefetch.message,
      },
    };

    await storage.updateTaskStatus(task.id, task.status ?? 'not-started', finalProgress);

    // Update all secondary tasks with the final status to prevent re-queuing
    for (const [order, secondaryTask] of existingByOrder.entries()) {
      if (order === 1) continue; // Skip primary task (already updated above)

      const secondaryProgressData = (secondaryTask.progressData ?? {}) as Record<string, any>;
      const secondaryFinalProgress = {
        ...secondaryProgressData,
        sessionBatchId,
        sessionPrefetch: {
          ...(secondaryProgressData.sessionPrefetch ?? {}),
          batchId: sessionBatchId,
          status: finalStatus,
          ready: finalStatus === PREFETCH_STATUS_READY || finalStatus === PREFETCH_STATUS_READY_PARTIAL,
          updatedAt: completedAt,
        },
      };

      await storage.updateTaskStatus(
        secondaryTask.id,
        secondaryTask.status ?? 'not-started',
        secondaryFinalProgress
      );
    }

    // Instrumentation: Log prefetch completion
    const durationMs = Date.now() - prefetchStartMs;
    const avgAudioGenMs = successCount > 0 ? Math.round(durationMs / successCount) : 0;
    console.log('[Prefetch][End]', {
      ...logContext,
      status: finalStatus,
      durationMs,
      successCount,
      expectedCount: expectedPrefetchCount,
      partial: partialReady,
      avgAudioGenMs,
    });

    if (!allAudiosAvailable && !partialReady) {
      const retryCount = (sessionPrefetch.retryCount ?? 0) + 1;
      const errorCode = 'TTS_FAIL';

      if (shouldRetryError(errorCode)) {
        const shouldRetry = await retryPrefetchJob(
          {
            taskId: task.id,
            userId,
            batchId: sessionBatchId,
            errorCode,
            currentRetryCount: retryCount - 1,
            skillType: 'listening',
          },
          ensureListeningSessionPrefetch
        );

        if (shouldRetry) {
          finalProgress.sessionPrefetch.retryCount = retryCount;
          finalProgress.sessionPrefetch.status = PREFETCH_STATUS_ERROR;
          finalProgress.sessionPrefetch.message = 'Audio generation failed; retry scheduled';
          finalProgress.sessionPrefetch.errorCode = errorCode;
          await storage.updateTaskStatus(task.id, task.status ?? 'not-started', finalProgress);
        }
      }
    }
  } catch (error: any) {
    // Instrumentation: Log prefetch error
    const durationMs = Date.now() - prefetchStartMs;
    console.error('[Prefetch][Error]', {
      ...logContext,
      durationMs,
      errorCode: error?.code,
      errorMessage: error?.message,
      stack: error?.stack?.split('\n').slice(0, 3).join(' '), // First 3 lines of stack
    });

    if (!task) {
      return;
    }

    const progressData = (task.progressData ?? {}) as Record<string, any>;
    const sessionPrefetch = progressData.sessionPrefetch ?? {};
    const nowIso = new Date().toISOString();
    const isAuthError = error?.code === 'POLLY_AUTH';
    const failureProgress = {
      ...progressData,
      sessionPrefetch: {
        ...sessionPrefetch,
        status: PREFETCH_STATUS_ERROR,
        ready: false,
        updatedAt: nowIso,
        errorCode: isAuthError ? 'POLLY_AUTH' : 'UNKNOWN',
        message: isAuthError
          ? 'Audio synthesis unavailable: AWS credentials not configured'
          : 'Failed to prepare listening session assets',
      },
    };

    await storage.updateTaskStatus(task.id, task.status ?? 'not-started', failureProgress);

    const errorCode = failureProgress.sessionPrefetch.errorCode;
    if (shouldRetryError(errorCode)) {
      const retryCount = (sessionPrefetch.retryCount ?? 0) + 1;
      const sessionBatchId = progressData.sessionBatchId ?? 'unknown';

      const shouldRetry = await retryPrefetchJob(
        {
          taskId: task.id,
          userId,
          batchId: sessionBatchId,
          errorCode,
          currentRetryCount: retryCount - 1,
          skillType: 'listening',
        },
        ensureListeningSessionPrefetch
      );

      if (shouldRetry) {
        failureProgress.sessionPrefetch.retryCount = retryCount;
        await storage.updateTaskStatus(task.id, task.status ?? 'not-started', failureProgress);
      }
    }
  }
}


async function preGenerateScriptsForListeningTasks(
  userId: string, 
  weeklyPlanId: string, 
  weekNumber: number, 
  listeningTasks: any[], 
  userLevel: number, 
  targetBand: number
) {
  console.log(`[Script Pre-Generation] Starting script generation for ${listeningTasks.length} listening tasks`);
  
  const scriptGenerationPromises = listeningTasks.map(async (task, index) => {
    try {
      // Create a minimal task object for script generation
      const taskForScript = {
        taskTitle: task.title,
        weekNumber: weekNumber,
        accent: normalizeAccent(task.accent),
        progressData: { description: task.description }
      };

      // Generate the script
      const scriptResult = await generateListeningScriptForTask(taskForScript as any, userLevel, targetBand);
      
      if (scriptResult.success) {
        const generatedTitle = makeListeningTaskTitle({
          scriptType: scriptResult.scriptType === 'dialogue' || scriptResult.scriptType === 'monologue'
            ? scriptResult.scriptType
            : undefined,
          contextLabel: scriptResult.contextLabel,
          topicDomain: scriptResult.topicDomain,
          scenarioOverview: scriptResult.scenarioOverview
        });

        console.log(`[Script Pre-Generation] Generated script for "${task.title}" → "${generatedTitle}": ${scriptResult.scriptText?.split(' ').length} words`);
        return {
          taskTitle: task.title,
          generatedTitle,
          scriptText: scriptResult.scriptText,
          accent: scriptResult.accent,
          scriptType: scriptResult.scriptType,
          difficulty: scriptResult.difficulty,
          topicDomain: scriptResult.topicDomain,
          contextLabel: scriptResult.contextLabel,
          scenarioOverview: scriptResult.scenarioOverview,
          estimatedDurationSec: scriptResult.estimatedDurationSec,
          ieltsPart: scriptResult.ieltsPart
        };
      } else {
        console.error(`[Script Pre-Generation] Failed to generate script for "${task.title}":`, scriptResult.error);
        return null;
      }
    } catch (error) {
      console.error(`[Script Pre-Generation] Error generating script for "${task.title}":`, error);
      return null;
    }
  });

  // Wait for all script generations to complete
  const scriptResults = await Promise.allSettled(scriptGenerationPromises);
  const successfulScripts = scriptResults
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => (result as PromiseFulfilledResult<any>).value);

  console.log(`[Script Pre-Generation] Successfully generated ${successfulScripts.length}/${listeningTasks.length} scripts`);
  return successfulScripts;
}
import { onboardingSchema, type TaskProgress as TaskProgressRecord, type Question as TaskQuestion } from "@shared/schema";

export async function registerRoutes(app: express.Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // =====================================================================
  // Task Progress API Endpoints
  // =====================================================================
  
  // Get task progress for a weekly plan (Firebase Auth version)
  app.get('/api/firebase/task-progress/weekly-plan/:weeklyPlanId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weeklyPlanId } = req.params;
      
      console.log(`[Task Progress API] GET task progress by weekly plan: ${weeklyPlanId} for user ${userId}`);
      
      // Fetch the weekly plan first to verify user has access
      const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
      
      if (!weeklyPlan) {
        return res.status(404).json({
          success: false,
          message: "Weekly plan not found"
        });
      }
      
      // Ensure the user owns this weekly plan
      if (weeklyPlan.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this weekly plan"
        });
      }
      
      // Get all task progress records for this weekly plan
      const taskProgressRecords = await storage.getTaskProgressByWeeklyPlan(weeklyPlanId, userId);
      
      console.log(`[Task Progress API] Found ${taskProgressRecords.length} task progress records for weekly plan ${weeklyPlanId}`);
      
      const ensuredRecords = await ensureSegmentsForTasks(taskProgressRecords);
      return res.status(200).json({
        success: true,
        taskProgress: ensuredRecords
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error fetching task progress by weekly plan:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch task progress',
        message: error.message
      });
    }
  });
  
  // Create a task progress record (Firebase Auth version)
  app.post('/api/firebase/task-progress', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weeklyPlanId, weekNumber, dayNumber, taskTitle } = req.body;
      
      // Enhanced debugging logs for task creation
      console.log('[Task Progress API] POST task progress request:', {
        endpoint: '/api/firebase/task-progress',
        method: 'POST',
        userId,
        weeklyPlanId,
        weekNumber,
        dayNumber,
        taskTitle: taskTitle ? (typeof taskTitle === 'string' ? taskTitle.substring(0, 30) + '...' : 'non-string') : 'missing'
      });
      
      // Validate required fields
      if (!weeklyPlanId || !weekNumber || dayNumber === undefined || !taskTitle) {
        console.error('[Task Progress API] Missing required fields:', {
          weeklyPlanId: !!weeklyPlanId,
          weekNumber: !!weekNumber,
          dayNumber: dayNumber !== undefined,
          taskTitle: !!taskTitle
        });
        
        return res.status(400).json({
          success: false,
          message: "Missing required fields: weeklyPlanId, weekNumber, dayNumber, taskTitle are required"
        });
      }
      
      // Validate weekly plan exists before creating progress
      const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
      
      if (!weeklyPlan) {
        console.error('[Task Progress API] Weekly plan not found:', { weeklyPlanId });
        return res.status(404).json({
          success: false,
          message: "Weekly plan not found. Cannot create task progress for non-existent plan."
        });
      }
      
      // Check if a task progress record already exists
      const existingProgress = await storage.getTaskProgressByUserAndTask(
        userId,
        weekNumber,
        dayNumber
      );
      
      if (existingProgress) {
        console.log('[Task Progress API] Existing progress found:', {
          id: existingProgress.id,
          status: existingProgress.status
        });
        
        return res.status(200).json({
          success: true,
          message: "Task progress record already exists",
          taskProgress: existingProgress
        });
      }
      
      // Create a new task progress record
      const taskProgressData = {
        id: uuidv4(),
        userId,
        weeklyPlanId,
        weekNumber,
        dayNumber,
        taskTitle,
        status: 'not-started',
        progressData: null,
        startedAt: null,
        completedAt: null,
      };
      
      const createdTaskProgress = await storage.createTaskProgress(taskProgressData);
      
      console.log('[Task Progress API] Task progress created successfully:', {
        id: createdTaskProgress.id,
        status: createdTaskProgress.status
      });
      
      return res.status(201).json({
        success: true,
        message: "Task progress record created successfully",
        taskProgress: createdTaskProgress
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error creating task progress:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to create task progress record"
      });
    }
  });

  app.post('/api/task-progress/start', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    const parseMinutes = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.round(value);
      }

      if (typeof value === 'string') {
        const match = value.match(/(\d+(\.\d+)?)/);
        if (match) {
          const parsed = Number(match[1]);
          if (Number.isFinite(parsed) && parsed > 0) {
            return Math.round(parsed);
          }
        }
      }

      return null;
    };

    try {
      const userId = req.user.id;
      const {
        weeklyPlanId,
        weekNumber,
        dayNumber,
        skill = 'listening',
        taskTitle,
        planEntry,
      } = req.body ?? {};

      if (!weeklyPlanId || typeof weeklyPlanId !== 'string') {
        return res.status(400).json({ message: 'weeklyPlanId is required' });
      }

      if (typeof dayNumber !== 'number' || Number.isNaN(dayNumber)) {
        return res.status(400).json({ message: 'dayNumber is required' });
      }

      const normalizedTitle = typeof taskTitle === 'string' ? taskTitle.trim() : '';
      if (!normalizedTitle) {
        return res.status(400).json({ message: 'taskTitle is required' });
      }

      const normalizedSkill = typeof skill === 'string' ? skill.toLowerCase() : 'listening';

      const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
      if (!weeklyPlan) {
        return res.status(404).json({ message: 'Weekly plan not found' });
      }

      if (weeklyPlan.userId !== userId) {
        return res.status(403).json({ message: 'You do not have access to this weekly plan' });
      }

      const resolvedWeekNumber =
        typeof weekNumber === 'number' && Number.isFinite(weekNumber)
          ? weekNumber
          : weeklyPlan.weekNumber;

      const existing = await storage.findTaskProgressByScope({
        userId,
        weeklyPlanId,
        dayNumber,
        taskTitle: normalizedTitle,
        skill: normalizedSkill,
      });

      if (existing) {
        const durationMinutes = resolveSessionMinutesFromTask(existing, DEFAULT_SESSION_MINUTES);
        const currentData = (existing.progressData ?? {}) as Record<string, any>;
        const planAccent = typeof planEntry?.accent === 'string' ? planEntry.accent : undefined;
        const resolvedAccent = normalizeAccent(
          planAccent ??
            (currentData.segments?.[0]?.accent as string | undefined) ??
            existing.accent ??
            DEFAULT_ACCENT,
        );
        const ensuredSegments = ensureListeningSegments(currentData.segments, durationMinutes, {
          baseTitle: normalizedTitle,
          accent: resolvedAccent,
        });

        const segmentsNeedingUpdate =
          !Array.isArray(currentData.segments) ||
          currentData.segments.length !== ensuredSegments.length ||
          ensuredSegments.some((seg, idx) => {
            const existingSeg = currentData.segments?.[idx];
            if (!existingSeg) return true;
            if (!existingSeg.accent || !existingSeg.voiceId) return true;
            if (typeof existingSeg.estimatedDurationSec !== 'number') return true;
            return false;
          });
        const updated = {
          ...currentData,
          sessionDurationMinutes: durationMinutes,
          segments: ensuredSegments,
        };

        if (segmentsNeedingUpdate || existing.duration !== durationMinutes) {
          await storage.updateTaskProgress(existing.id, {
            duration: durationMinutes,
            progressData: updated,
          });
        }
        existing.progressData = updated;
        console.log(
          `[TaskProgress] start: user=${userId} plan=${weeklyPlanId} day=${dayNumber} title=\"${normalizedTitle}\" id=${existing.id}`,
        );
        return res.status(200).json({
          id: existing.id,
          duration: durationMinutes,
          progressData: existing.progressData ?? null,
        });
      }

      const dayType = determineDayType({
        dayNumber,
        explicit: planEntry?.dayType,
        assignedDate: planEntry?.assignedDate,
      });

      const planProgressData =
        planEntry && typeof planEntry.progressData === 'object'
          ? planEntry.progressData
          : undefined;

      const planDurationMinutes =
        parseMinutes(planEntry?.durationMinutes) ??
        parseMinutes(planEntry?.duration) ??
        parseMinutes(planEntry?.sessionMinutes);

      const planTaskStub =
        planProgressData || planDurationMinutes
          ? ({
              duration: planDurationMinutes ?? undefined,
              progressData: planProgressData,
            } as any)
          : undefined;

      let sessionMinutes = resolveSessionMinutesFromTask(planTaskStub, 0);

      const studyPlans = await storage.getStudyPlansByUserId(userId);
      const latestPlan = studyPlans.length > 0 ? studyPlans[studyPlans.length - 1] : null;
      const normalizedPreferences = normalizeStudyPreferences(
        (latestPlan?.studyPreferences as Record<string, any>) ?? undefined,
      );

      const preferenceMinutes =
        dayType === 'weekend'
          ? normalizedPreferences.listeningDurations.weekend
          : normalizedPreferences.listeningDurations.weekday;

      if (!sessionMinutes || sessionMinutes <= 0) {
        sessionMinutes = preferenceMinutes && preferenceMinutes > 0 ? preferenceMinutes : DEFAULT_SESSION_MINUTES;
      }
      sessionMinutes = Math.max(sessionMinutes, LISTENING_SESSION_MINUTES);

      const planAccent = typeof planEntry?.accent === 'string' ? planEntry.accent : undefined;
      const resolvedAccent = normalizeAccent(planAccent ?? DEFAULT_ACCENT);
      const segments = ensureListeningSegments(planProgressData?.segments, sessionMinutes, {
        baseTitle: normalizedTitle,
        accent: resolvedAccent,
      });

      const progressData: Record<string, any> = {
        ...(planProgressData ?? {}),
        sessionDurationMinutes: sessionMinutes,
        segments,
      };

      progressData.sessionPrefetch = {
        ...(progressData.sessionPrefetch ?? {}),
        dayType,
        source: 'start-endpoint',
        sessionMinutes,
        assignedDate: planEntry?.assignedDate ?? null,
        accent: resolvedAccent,
      };

      const newProgress = await storage.createTaskProgress({
        id: uuidv4(),
        userId,
        weeklyPlanId,
        weekNumber: resolvedWeekNumber,
        dayNumber,
        taskTitle: normalizedTitle,
        skill: normalizedSkill,
        accent: resolvedAccent,
        status: 'in-progress',
        progressData,
        duration: sessionMinutes,
        startedAt: new Date(),
      });

      console.log(
        `[TaskProgress] start: user=${userId} plan=${weeklyPlanId} day=${dayNumber} title="${normalizedTitle}" id=${newProgress.id}`,
      );

      return res.status(201).json({
        id: newProgress.id,
        duration: sessionMinutes,
        progressData,
      });
    } catch (error: any) {
      console.error('[TaskProgress] Error starting task progress:', error);
      return res.status(500).json({
        message: 'Failed to start task progress',
        error: error?.message ?? 'unknown_error',
      });
    }
  });

  app.post('/api/task-progress/:id/segment/:segmentId/submit', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id, segmentId } = req.params;
      const { answers } = req.body ?? {};

      if (!Array.isArray(answers)) {
        return res.status(400).json({ message: 'answers array is required' });
      }

      const task = await storage.getTaskProgress(id);
      if (!task) {
        return res.status(404).json({ message: 'Task progress not found' });
      }
      if (task.userId !== userId) {
        return res.status(403).json({ message: 'Access denied for this task' });
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const segments = Array.isArray(progressData.segments) ? progressData.segments : [];
      if (!segments.length) {
        return res.status(400).json({ message: 'No segment metadata found for this task' });
      }

      const segment = segments.find((seg: any, idx: number) => seg?.id === segmentId || String(idx) === segmentId);
      if (!segment) {
        return res.status(404).json({ message: 'Segment not found on this task' });
      }

      const { assignments, changed } = deriveSegmentAssignments(task);
      const questionIds: string[] = assignments[segment.id] ?? [];
      if (!questionIds.length) {
        return res.status(400).json({ message: 'No questions mapped to this segment yet' });
      }

      const rawQuestions = Array.isArray(task.questions) ? task.questions : [];
      const mapById = new Map(rawQuestions.map((q: any, index: number) => [String(q?.id ?? `q${index + 1}`), q]));
      const segmentQuestions = questionIds
        .map((qid) => mapById.get(String(qid)))
        .filter(Boolean) as TaskQuestion[];

      if (!segmentQuestions.length) {
        return res.status(400).json({ message: 'Segment question bank missing' });
      }

      const segmentAnswers = questionIds.map((questionId: string) => {
        const response = answers.find((a: any) => String(a?.questionId) === String(questionId));
        return {
          questionId: String(questionId),
          choiceId: response?.choiceId ?? response?.pickedOptionId ?? null,
        };
      });

      const scored = scoreSegment({
        questions: segmentQuestions,
        answers: segmentAnswers,
      });

      const nextIndex = segments.findIndex((seg: any) => seg?.id === segment.id) + 1;
      const segmentResults = Array.isArray(progressData.segmentResults)
        ? progressData.segmentResults.filter((res: any) => res?.segmentId !== segment.id)
        : [];

      segmentResults.push({
        segmentId: segment.id,
        correct: scored.correct,
        total: scored.total,
        mistakeTags: scored.mistakeTags,
        tagStats: scored.tagStats,
        submittedAt: new Date().toISOString(),
      });

      const updatedProgressData = {
        ...progressData,
        segmentResults,
        segmentAssignments: assignments,
      };

      await storage.updateTaskProgress(id, {
        progressData: updatedProgressData,
        status: 'in-progress',
      });

      return res.status(200).json({
        success: true,
        segmentId: segment.id,
        correct: scored.correct,
        total: scored.total,
        percent: scored.total ? Math.round((scored.correct / scored.total) * 100) : 0,
        mistakeTags: scored.mistakeTags,
        tagStats: scored.tagStats,
        nextSegmentIndex: Math.min(nextIndex, segments.length - 1),
        updatedAssignments: changed ? assignments : undefined,
      });
    } catch (error: any) {
      console.error('[TaskProgress][segmentSubmit] error', error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? 'Failed to submit segment answers',
      });
    }
  });

  app.post('/api/task-progress/:id/finalize', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const task = await storage.getTaskProgress(id);
      if (!task) {
        return res.status(404).json({ message: 'Task progress not found' });
      }
      if (task.userId !== userId) {
        return res.status(403).json({ message: 'Access denied for this task' });
      }

      const progressData = (task.progressData ?? {}) as Record<string, any>;
      const segmentResults = Array.isArray(progressData.segmentResults) ? progressData.segmentResults : [];

      if (!segmentResults.length) {
        return res.status(400).json({ message: 'No segment submissions to finalize' });
      }

      const histogram = buildMistakeHistogram(segmentResults);
      const totals = segmentResults.reduce(
        (acc, seg) => {
          acc.correct += Number(seg.correct ?? 0);
          acc.total += Number(seg.total ?? 0);
          return acc;
        },
        { correct: 0, total: 0 },
      );

      const scorePercent = totals.total ? Math.round((totals.correct / totals.total) * 100) : 0;
      const recentSessions = await getRecentListeningSummaries(storage, userId, 5);
      const feedback = buildSessionFeedback({
        histogram,
        recentSessions: recentSessions.filter((session) => session.taskId !== task.id),
      });

      const sessionSummary = {
        scorePercent,
        strengths: feedback.strengths,
        focusNext: feedback.focusNext,
        mistakeHistogram: histogram,
        updatedAt: new Date().toISOString(),
        correct: totals.correct,
        total: totals.total,
        trend: feedback.trend,
      };

      const updatedProgressData = {
        ...progressData,
        segmentResults,
        sessionSummary,
      };

      await storage.updateTaskProgress(id, {
        progressData: updatedProgressData,
        status: 'completed',
        completedAt: new Date(),
      });

      return res.status(200).json({
        success: true,
        scorePercent,
        strengths: feedback.strengths,
        focusNext: feedback.focusNext,
        trend: feedback.trend,
      });
    } catch (error: any) {
      console.error('[TaskProgress][finalize] error', error);
      return res.status(500).json({
        success: false,
        message: error?.message ?? 'Failed to finalize session',
      });
    }
  });
  
  // Mark task as in progress (Firebase Auth version)
  app.patch('/api/firebase/task-progress/:id/start', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { progressData } = req.body;
      
      console.log(`[Task Progress API] PATCH start task: ${id} for user ${userId}`);
      
      // Get the task progress record
      const taskProgressRecord = await storage.getTaskProgress(id);
      
      if (!taskProgressRecord) {
        return res.status(404).json({
          success: false,
          message: "Task progress record not found"
        });
      }
      
      // Ensure the user owns this task progress record
      if (taskProgressRecord.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this task progress record"
        });
      }
      
      // Mark the task as in progress
      const updatedTaskProgress = await storage.markTaskAsInProgress(id, progressData);
      const ensured = await ensureSegmentsForTaskProgress(updatedTaskProgress);
      
      console.log('[Task Progress API] Task successfully marked as in progress:', {
        id: updatedTaskProgress.id,
        status: updatedTaskProgress.status
      });
      
      return res.status(200).json({
        success: true,
        message: "Task marked as in progress",
        taskProgress: ensured
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error marking task as in progress:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark task as in progress"
      });
    }
  });
  
  // Mark task as completed (Firebase Auth version)
  app.patch('/api/firebase/task-progress/:id/complete', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      console.log(`[Task Progress API] PATCH complete task: ${id} for user ${userId}`);
      
      // Get the task progress record
      const taskProgressRecord = await storage.getTaskProgress(id);
      
      if (!taskProgressRecord) {
        return res.status(404).json({
          success: false,
          message: "Task progress record not found"
        });
      }
      
      // Ensure the user owns this task progress record
      if (taskProgressRecord.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to update this task progress record"
        });
      }
      
      // Mark the task as completed
      const updatedTaskProgress = await storage.markTaskAsCompleted(id);
      const ensured = await ensureSegmentsForTaskProgress(updatedTaskProgress);
      
      return res.status(200).json({
        success: true,
        message: "Task marked as completed",
        taskProgress: ensured
      });
    } catch (error: any) {
      console.error('[Task Progress API] Error marking task as completed:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark task as completed"
      });
    }
  });
  
  // Batch initialize task progress records (Firebase Auth version)
  app.post('/api/firebase/task-progress/batch-initialize', verifyFirebaseAuth, ensureFirebaseUser, batchInitializeTaskProgress);
  
  // Generate listening script for a specific task (Firebase Auth version)
  app.post('/api/task/:taskId/generate-script', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskId } = req.params;
      
      console.log(`[Script Generation API] Request to generate script for task ${taskId} by user ${userId}`);
      
      // Get the task from database
      const task = await storage.getTaskProgress(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Verify task belongs to the authenticated user
      if (task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied - task does not belong to user"
        });
      }
      
      // Check if script already exists to prevent duplicate generation
      if (task.scriptText && task.scriptText.trim().length > 0) {
        return res.status(400).json({
          success: false,
          message: "Script already exists for this task",
          data: {
            hasScript: true,
            scriptLength: task.scriptText.length,
            accent: normalizeAccent(task.accent ?? undefined),
            duration: task.duration
          }
        });
      }
      
      // Get user's onboarding data to determine skill level and target
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Get study plan to extract skill ratings and target band
      const studyPlans = await storage.getStudyPlansByUserId(userId);
      const latestPlan = studyPlans[0]; // Assume most recent plan
      
      if (!latestPlan) {
        return res.status(400).json({
          success: false,
          message: "No study plan found - onboarding required"
        });
      }
      
      const skillRatings = latestPlan.skillRatings as Record<string, number>;
      const userLevel = skillRatings?.listening || 1; // Default to 1 if not found
      const targetBand = parseFloat(latestPlan.targetBandScore) || 7; // Default to 7 if not found
      
      console.log(`[Script Generation API] User skill level: ${userLevel}, Target band: ${targetBand}`);
      
      // Generate the script using OpenAI
      const scriptResult = await generateListeningScriptForTask(task, userLevel, targetBand);
      
      if (!scriptResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to generate script",
          error: scriptResult.error
        });
      }
      
      // Generate dynamic title if needed
      let updatedTitle = task.taskTitle;
      if (needsTitleUpdate(task.taskTitle) && scriptResult.contextLabel) {
        updatedTitle = makeListeningTaskTitle({
          scriptType: scriptResult.scriptType === 'dialogue' || scriptResult.scriptType === 'monologue'
            ? scriptResult.scriptType
            : undefined,
          contextLabel: scriptResult.contextLabel,
          topicDomain: scriptResult.topicDomain,
          scenarioOverview: scriptResult.scenarioOverview
        });
        console.log(`[Script Generation API] Updated title from "${task.taskTitle}" to "${updatedTitle}"`);
      }
      
      const sessionMinutesRaw = resolveSessionMinutesFromTask(task);
      const sessionMinutes = Math.max(sessionMinutesRaw, LISTENING_SESSION_MINUTES);
      // Update the task with generated content, metadata, and refreshed title
      const updateData = {
        scriptText: scriptResult.scriptText!,
        accent: scriptResult.accent!,
        scriptType: scriptResult.scriptType!,
        difficulty: scriptResult.difficulty!,
        duration: sessionMinutes,
        ieltsPart: scriptResult.ieltsPart,
        topicDomain: scriptResult.topicDomain,
        contextLabel: scriptResult.contextLabel,
        scenarioOverview: scriptResult.scenarioOverview,
        estimatedDurationSec: scriptResult.estimatedDurationSec,
        taskTitle: updatedTitle
      };
      
      const updatedTask = await storage.updateTaskContent(taskId, updateData);
      
      // Note: Task title is updated in the task progress table via updateTaskContent
      // The title is part of the task progress record, not the weekly plan
      
      // Update task status to indicate script is generated
      await storage.updateTaskStatus(taskId, "script-generated");
      
      console.log(`[Script Generation API] Successfully generated script for task ${taskId}`);
      
      res.json({
        success: true,
        message: "Script generated successfully",
        data: {
          taskId: taskId,
          scriptText: scriptResult.scriptText,
          accent: scriptResult.accent,
          scriptType: scriptResult.scriptType,
          difficulty: scriptResult.difficulty,
          estimatedDuration: scriptResult.estimatedDurationSec,
          wordCount: scriptResult.scriptText!.split(/\s+/).length,
          status: "script-generated"
        }
      });
      
    } catch (error) {
      console.error('[Script Generation API] Error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error during script generation",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Generate audio from script for a specific task (Firebase Auth version)
  app.post('/api/task/:taskId/generate-audio', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskId } = req.params;
      
      console.log(`[Audio Generation API] Request to generate audio for task ${taskId} by user ${userId}`);
      
      // Get the task from database
      const task = await storage.getTaskProgress(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Verify task belongs to the authenticated user
      if (task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied - task does not belong to user"
        });
      }
      
      // INVESTIGATION: Comprehensive script text validation for silent audio debugging
      console.log(`[AUDIO INVESTIGATION] Script text analysis for task ${taskId}:`, {
        hasScriptText: !!task.scriptText,
        scriptTextType: typeof task.scriptText,
        scriptTextLength: task.scriptText ? task.scriptText.length : 0,
        scriptTextTrimmedLength: task.scriptText ? task.scriptText.trim().length : 0,
        scriptTextWordCount: task.scriptText ? task.scriptText.trim().split(/\s+/).length : 0,
        scriptTextPreview: task.scriptText ? task.scriptText.substring(0, 150) + (task.scriptText.length > 150 ? '...' : '') : 'NO SCRIPT',
        isEmptyOrWhitespace: !task.scriptText || task.scriptText.trim().length === 0
      });
      
      // Check if task has script text
      if (!task.scriptText || task.scriptText.trim().length === 0) {
        console.error(`[AUDIO INVESTIGATION] ❌ No valid script text found for task ${taskId}`);
        return res.status(400).json({
          success: false,
          message: "No script available for audio generation. Generate script first."
        });
      }
      
      // Additional validation for meaningful content
      const trimmedScript = task.scriptText.trim();
      if (trimmedScript.length < 10) {
        console.warn(`[AUDIO INVESTIGATION] ⚠️  Script text is very short (${trimmedScript.length} chars): "${trimmedScript}"`);
      }

      const scriptValidation = validateTranscriptComplete(trimmedScript);
      if (!scriptValidation.ok) {
        console.warn('[Audio Generation API] Script failed validation, aborting audio generation', {
          taskId,
          reason: scriptValidation.reason,
        });
        return res.status(500).json({
          success: false,
          retryable: true,
          message: "Script is incomplete, regenerating content before audio",
          reason: scriptValidation.reason,
        });
      }
      
      // Check if audio already exists to prevent duplicate generation
      if (task.audioUrl && task.audioUrl.trim().length > 0) {
        console.log(`[AUDIO INVESTIGATION] Checking if audio already exists: ${task.audioUrl}`);
        const audioExists = await checkAudioExists(task.audioUrl);
        if (audioExists) {
          return res.status(409).json({
            success: false,
            message: "Audio already exists for this task",
            data: {
              hasAudio: true,
              audioUrl: task.audioUrl,
              duration: task.duration,
              accent: normalizeAccent(task.accent ?? undefined)
            }
          });
        }
      }
      
      // Use accent from task or default to British
      const accent = normalizeAccent(task.accent ?? undefined);
      
      console.log(`[Audio Generation API] Generating audio with accent: ${accent}`);
      console.log(`[AUDIO INVESTIGATION] Final script to be synthesized (${trimmedScript.length} chars):`, 
        JSON.stringify(trimmedScript));
      
      // Generate audio using AWS Polly
      const audioResult = await generateAudioFromScript(
        task.scriptText,
        accent,
        userId,
        taskId,
        task.weekNumber
      );
      
      if (!audioResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to generate audio",
          error: audioResult.error
        });
      }
      
      const sessionMinutesRaw = resolveSessionMinutesFromTask(task);
      const sessionMinutes = Math.max(sessionMinutesRaw, LISTENING_SESSION_MINUTES);
      // Update the task with generated audio URL and duration
      const updateData = {
        audioUrl: audioResult.audioUrl!,
        duration: sessionMinutes,
        accent
      };
      
      await storage.updateTaskContent(taskId, updateData);
      
      // Update task status to indicate audio is ready
      await storage.updateTaskStatus(taskId, "audio-ready");
      
      console.log(`[Audio Generation API] Successfully generated audio for task ${taskId}`);
      
      res.json({
        success: true,
        message: "Audio generated successfully",
        data: {
          taskId: taskId,
          audioUrl: audioResult.audioUrl,
          duration: audioResult.duration,
          accent: accent,
          scriptLength: task.scriptText.length,
          status: "audio-ready"
        }
      });
      
    } catch (error) {
      console.error('[Audio Generation API] Error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error during audio generation",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Generate a listening session package (prefetch 4 audios + questions)
  app.post('/api/listening/session-package', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const {
        activityType,
        scenario,
        sessionDurationMinutes,
        targetBand,
        userLevel,
        accent,
      } = req.body ?? {};

      if (activityType !== "dialogue" && activityType !== "monologue") {
        return res.status(400).json({
          success: false,
          message: "activityType must be 'dialogue' or 'monologue'",
        });
      }

      if (typeof scenario !== "string" || scenario.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "scenario is required",
        });
      }

      const durationMinutes =
        typeof sessionDurationMinutes === "number"
          ? sessionDurationMinutes
          : parseInt(String(sessionDurationMinutes), 10);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return res.status(400).json({
          success: false,
          message: "sessionDurationMinutes must be a positive number",
        });
      }

      const targetBandNum =
        typeof targetBand === "number" ? targetBand : parseFloat(String(targetBand));
      if (!Number.isFinite(targetBandNum)) {
        return res.status(400).json({
          success: false,
          message: "targetBand must be a number",
        });
      }

      const userLevelNum =
        typeof userLevel === "number" ? userLevel : parseFloat(String(userLevel));
      if (!Number.isFinite(userLevelNum)) {
        return res.status(400).json({
          success: false,
          message: "userLevel must be a number",
        });
      }

      const normalizedAccent = typeof accent === "string" ? normalizeAccent(accent) : undefined;

      console.log("[Session Package API] Generating package", {
        userId: req.user?.id,
        activityType,
        scenario,
        sessionDurationMinutes: durationMinutes,
        targetBand: targetBandNum,
        userLevel: userLevelNum,
        accent: normalizedAccent,
      });

      const packageData = await generateListeningSessionPackage({
        activityType,
        scenario,
        sessionDurationMinutes: durationMinutes,
        targetBand: targetBandNum,
        userLevel: userLevelNum,
        accent: normalizedAccent,
        prefetchCount: PREFETCH_AUDIO_COUNT,
      });

      return res.status(200).json({
        success: true,
        data: packageData,
      });
    } catch (error: any) {
      console.error('[Session Package API] Error generating session package:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to generate listening session package",
        error: error?.message ?? 'Unknown error'
      });
    }
  });

  // Generate or refresh a listening weekly plan for the given week
  app.post('/api/firebase/weekly-plan/generate-listening', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const rawWeekNumber = req.body?.weekNumber;
      const weekNumber = Number.isInteger(rawWeekNumber)
        ? rawWeekNumber
        : Number.isFinite(Number(rawWeekNumber))
          ? Number(rawWeekNumber)
          : 1;

      if (!Number.isFinite(weekNumber) || weekNumber < 1) {
        return res.status(400).json({
          success: false,
          message: "weekNumber must be a positive integer"
        });
      }

      const studyPlans = await storage.getStudyPlansByUserId(userId);
      if (!studyPlans.length) {
        return res.status(400).json({
          success: false,
          message: "No study plan found. Complete onboarding first."
        });
      }

      const latestPlan = studyPlans[studyPlans.length - 1];
      const skillRatings = (latestPlan.skillRatings as Record<string, number>) ?? {};

      const storedPreferences = normalizeStudyPreferences((latestPlan.studyPreferences as any) ?? {});
      const sessionMinutes = storedPreferences.sessionMinutes;
      const weekdayDuration = storedPreferences.listeningDurations.weekday;
      const weekendDuration = storedPreferences.listeningDurations.weekend;

      console.log('[Weekly Plan] Session config:', {
        sessionMinutes,
        listeningDurations: {
          weekday: weekdayDuration,
          weekend: weekendDuration
        },
        source: 'normalized'
      });

      const planRequest = {
        fullName: latestPlan.fullName,
        phoneNumber: latestPlan.phoneNumber ?? undefined,
        targetBandScore: Number(latestPlan.targetBandScore) || 7,
        testDate: latestPlan.testDate ?? null,
        notDecided: latestPlan.notDecided === 'true',
        skillRatings: {
          listening: Number(skillRatings.listening ?? 1),
          reading: Number(skillRatings.reading ?? 1),
          writing: Number(skillRatings.writing ?? 1),
          speaking: Number(skillRatings.speaking ?? 1),
        },
        immigrationGoal: latestPlan.immigrationGoal,
        studyPreferences: storedPreferences,
        weekNumber,
      };

      const listeningPlan = await generateListeningStudyPlan(planRequest as any);
      if ((listeningPlan as any)?.success === false) {
        return res.status(500).json({
          success: false,
          message: "Failed to generate listening weekly plan",
          reason: (listeningPlan as any).reason ?? 'unknown'
        });
      }

      const weekFocus = (listeningPlan as any).weekFocus || `Listening focus for week ${weekNumber}`;
      const planEntries = Array.isArray((listeningPlan as any).plan) ? (listeningPlan as any).plan : [];
      const defaultSessionMinutes = sessionMinutes;
      const weekdayMinutes = weekdayDuration;
      const weekendMinutes = weekendDuration;
      const getSessionConfigForDay = (opts: { dayNumber: number; dayType?: string; assignedDate?: Date }) => {
        const resolvedType = determineDayType({
          dayNumber: opts.dayNumber,
          explicit: opts.dayType,
          assignedDate: opts.assignedDate,
        });
        const minutes = resolvedType === 'weekend' ? weekendMinutes : weekdayMinutes;
        return {
          minutes,
          dayType: resolvedType,
        };
      };
      const planQueue = [...planEntries];
      const weekWindow = resolveWeekWindow({ weekNumber, tz: PLANNER_TZ, referenceDate: new Date() });
      const windowDays = enumerateDays(weekWindow.start, weekWindow.end);
      const availability = buildAvailabilityFromSchedule(storedPreferences.schedule);
      const assignments = assignSkillsToDays(windowDays, {
        tz: PLANNER_TZ,
        today: new Date(),
        availability,
        weights: { listening: 1 },
      });

      const formattedEntries: FormattedListeningEntry[] = assignments
        .map((assignment, idx): FormattedListeningEntry | null => {
          const entry = planQueue.shift();
          if (!entry) {
            return null;
          }

          const isoDay = getIsoDayForDate(assignment.date, PLANNER_TZ);
          const sessionConfig = getSessionConfigForDay({
            dayNumber: isoDay,
            assignedDate: assignment.date,
          });
          const sessionMinutesForDay = sessionConfig.minutes;
          const scriptType =
            entry.activityType === 'monologue'
              ? 'monologue'
              : entry.activityType === 'dialogue'
                ? 'dialogue'
                : 'dialogue';

          const contextLabel = entry.conversationType ?? entry.scenario ?? 'Listening Practice';
          const topicDomain = entry.scenario ?? entry.conversationType ?? 'Listening Practice';
          const scenarioOverview = entry.description ?? `${contextLabel} listening task`;
          const normalizedAccent = normalizeAccent(entry.accent);
          const estimatedDurationSec = Math.round(sessionMinutesForDay * 60);
          const durationLabel = `${sessionMinutesForDay} min`;
          const sequenceNumber = idx + 1;

          const taskTitle = makeListeningTaskTitle({
            scriptType,
            contextLabel,
            topicDomain,
            scenarioOverview,
          });

          return {
            dayNumber: isoDay,
            sequenceNumber,
            taskTitle,
            scriptType,
            contextLabel,
            topicDomain,
            scenarioOverview,
            accent: normalizedAccent,
            estimatedDurationSec,
            durationLabel,
            dayType: sessionConfig.dayType,
            dayDurationMinutes: sessionMinutesForDay,
            sessionMinutes: sessionMinutesForDay,
            description: scenarioOverview,
            conversationType: entry.conversationType ?? null,
            assignedDate: assignment.date.toISOString(),
          };
        })
        .filter((entry): entry is FormattedListeningEntry => Boolean(entry));

      if (!formattedEntries.length) {
        return res.status(400).json({
          success: false,
          message: "No available days remain for this week based on your schedule",
        });
      }
      const normalizedPlanEntries = formattedEntries.map((entry: any) => {
        const baseTask = {
          originalTitle: entry.taskTitle,
          title: entry.taskTitle,
          skill: 'listening',
          dayNumber: entry.dayNumber,
          contextType: entry.scriptType,
          topicDomain: entry.topicDomain,
          accent: entry.accent ?? 'British',
          description: entry.description ?? '',
          audio: {
            estimatedDurationSec: entry.estimatedDurationSec ?? 360,
            accent: entry.accent ?? 'British',
          },
        };

        const normalized = normalizeTaskDuration(baseTask, {
          weekdayDuration: weekdayMinutes,
          weekendDuration: weekendMinutes,
          dayNumber: entry.dayNumber,
          date: new Date(entry.assignedDate),
        });

        normalized.durationMinutes = typeof normalized.durationMinutes === 'number'
          ? normalized.durationMinutes
          : entry.dayDurationMinutes ?? weekdayMinutes;

        normalized.duration = `${normalized.durationMinutes} min`;
        (normalized as any).assignedDate = entry.assignedDate;
        (normalized as any).planDayIndex = entry.dayNumber;
        (normalized as any).sequenceNumber = entry.sequenceNumber;
        (normalized as any).dayLabel = `Day ${entry.sequenceNumber}`;
        (normalized as any).dayType = entry.dayType;

        delete (normalized as any).durationLabel;
        delete (normalized as any).estimatedDurationSec;

        return normalized;
      });

      const planData = {
        weekFocus,
        plan: normalizedPlanEntries,
      };

      const weeklyPlan = await storage.createOrUpdateWeeklyStudyPlan(
        userId,
        weekNumber,
        'listening',
        weekFocus,
        planData,
      );

      const existingTasks = await storage.getTaskProgressByWeeklyPlan(weeklyPlan.id, userId);
      const usedTaskIds = new Set<string>();

      let updatedCount = 0;
      let createdCount = 0;

      for (let i = 0; i < formattedEntries.length; i++) {
        const entry = formattedEntries[i];
        const normalizedEntry = normalizedPlanEntries[i]; // Get corresponding normalized entry

        const candidate = existingTasks.find(
          (task) => task.dayNumber === entry.dayNumber && !usedTaskIds.has(task.id),
        );

        if (candidate) {
          usedTaskIds.add(candidate.id);
          const candidateProgressData = (candidate.progressData ?? {}) as Record<string, any>;
          const existingSegments = Array.isArray(candidateProgressData.segments)
            ? candidateProgressData.segments
            : [];
          const segments = ensureListeningSegments(existingSegments, normalizedEntry.durationMinutes, {
            baseTitle: entry.taskTitle,
            accent: entry.accent,
          });

          await storage.updateTaskContent(candidate.id, {
            taskTitle: entry.taskTitle,
            accent: entry.accent,
            scriptType: entry.scriptType,
            topicDomain: entry.topicDomain,
            contextLabel: entry.contextLabel,
            scenarioOverview: entry.scenarioOverview,
            estimatedDurationSec: undefined, // ⛔️ stop using top-level seconds
            duration: normalizedEntry.durationMinutes, // ✅ minutes for timer
            replayLimit: 3,
          });

          const mergedProgressData = {
            ...candidateProgressData,
            sessionDurationMinutes: normalizedEntry.durationMinutes,
            segments,
            assignedDate: entry.assignedDate,
            sessionPrefetch: {
              ...candidateProgressData.sessionPrefetch,
              // Preserve critical fields to prevent re-queuing
              status: candidateProgressData.sessionPrefetch?.status,
              batchId: candidateProgressData.sessionPrefetch?.batchId,
              total: PREFETCH_AUDIO_COUNT,
              ready: Boolean(candidateProgressData.sessionPrefetch?.ready),
              activityType: entry.scriptType,
              scenario: entry.contextLabel,
              accent: entry.accent,
              sessionMinutes: normalizedEntry.durationMinutes,
              dayType: entry.dayType,
              updatedAt: candidateProgressData.sessionPrefetch?.updatedAt,
              assignedDate: entry.assignedDate,
            },
          };
          await storage.updateTaskStatus(candidate.id, 'not-started', mergedProgressData);
          updatedCount += 1;
        } else {
          const segments = ensureListeningSegments(entry?.progressData?.segments, normalizedEntry.durationMinutes, {
            baseTitle: entry.taskTitle,
            accent: entry.accent,
          });

          const insertData = {
            id: uuidv4(),
            userId,
            weeklyPlanId: weeklyPlan.id,
            weekNumber,
            dayNumber: entry.dayNumber,
            taskTitle: entry.taskTitle,
            skill: 'listening' as const,
            status: 'not-started' as const,
            startedAt: null,
            completedAt: null,
            accent: entry.accent,
            replayLimit: 3,
            scriptType: entry.scriptType,
            difficulty: null,
            topicDomain: entry.topicDomain,
            contextLabel: entry.contextLabel,
            scenarioOverview: entry.scenarioOverview,
            estimatedDurationSec: undefined, // ⛔️ stop using top-level seconds
            duration: normalizedEntry.durationMinutes, // ✅ minutes
            progressData: {
              sessionDurationMinutes: normalizedEntry.durationMinutes,
              segments,
              assignedDate: entry.assignedDate,
              sessionPrefetch: {
                total: PREFETCH_AUDIO_COUNT,
                ready: false,
                activityType: entry.scriptType,
                scenario: entry.contextLabel,
                accent: entry.accent,
                sessionMinutes: normalizedEntry.durationMinutes,
                dayType: entry.dayType,
              },
            },
          };

          await storage.createTaskProgress(insertData);
          createdCount += 1;
        }
      }

      const isCurrentWeek = weekNumber === 1;
      const currentIsoDay = getIsoDayForDate(new Date(), PLANNER_TZ);
      const staleTasks = existingTasks.filter((task) => {
        if (usedTaskIds.has(task.id)) {
          return false;
        }
        if (isCurrentWeek && typeof task.dayNumber === 'number') {
          return task.dayNumber >= currentIsoDay;
        }
        return true;
      });
      if (staleTasks.length > 0) {
        await storage.deleteTaskProgressByIds(staleTasks.map((task) => task.id));
      }

      return res.status(200).json({
        success: true,
        weeklyPlanId: weeklyPlan.id,
        weekNumber,
        weekFocus,
        tasksCreated: createdCount,
        tasksUpdated: updatedCount,
        tasksDeleted: staleTasks.length,
      });
    } catch (error: any) {
      console.error('[Weekly Plan API] Error generating listening plan:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to generate listening weekly plan",
        error: error?.message ?? 'Unknown error',
      });
    }
  });

  // =====================================================================
  // Plan Generation Endpoints
  // =====================================================================
  
  // Generate IELTS study plan based on onboarding data (Firebase Auth version)
  app.post('/api/plan/generate', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const payload = req.body;
      
      // Use the database user ID from the ensureFirebaseUser middleware
      const user = req.user;
      // Always use the database ID, not Firebase UID for database operations
      const userId = user.id;
      const firebaseUid = req.firebaseUser.uid;
      
      // Log the payload and user information to the server console
      console.log(`[Plan API] Received onboarding data for plan generation for user: ${userId} (Firebase UID: ${firebaseUid})`);
      console.log('[Plan API] Onboarding payload summary:', {
        firstName: payload.firstName,
        targetBandScore: payload.targetBandScore,
        testDate: payload.testDate
      });
      
      // Preprocess the date format if it's a string
      if (payload.testDate && typeof payload.testDate === 'string') {
        try {
          payload.testDate = new Date(payload.testDate);
          console.log('[Plan API] Converted testDate from string to Date:', payload.testDate);
        } catch (e) {
          console.error('[Plan API] Error parsing test date:', e);
          payload.testDate = null;
        }
      }
      
      // Ensure study preferences are present before validation
      payload.studyPreferences = normalizeStudyPreferences(payload.studyPreferences);
      
      // Validate request data with detailed error reporting
      const validation = onboardingSchema.safeParse(payload);
      
      if (!validation.success) {
        const formattedErrors = validation.error.flatten();
        console.error('[Plan API] Onboarding validation failed:', {
          fieldErrors: formattedErrors.fieldErrors,
          formErrors: formattedErrors.formErrors
        });
        return res.status(400).json({ 
          success: false, 
          message: "Invalid onboarding data", 
          errors: formattedErrors
        });
      }
      
      const onboardingData = {
        ...validation.data,
        studyPreferences: normalizeStudyPreferences(validation.data.studyPreferences),
      };

      try {
        // Check debug mode flag
        const debugFlagEnabled = process.env.ENABLE_PLAN_DEBUG === "1";
        if (debugFlagEnabled) {
          console.log("[PlanGen][ROUTE] Debug mode enabled");
          const report = await generateIELTSPlan_debugWrapper(onboardingData);

          await storage.updateOnboardingStatus(userId, true);

          return res.status(200).json({
            success: true,
            message: "Debug diagnostics completed",
            debug: report,
          });
        }

        console.log('[Plan API] Calling OpenAI to generate IELTS plan...');
        const plan = await generateIELTSPlan(onboardingData);

        // Map onboarding text to numeric minutes
        const sessionMinutes = mapToMinutes(onboardingData.studyPreferences.dailyCommitment);
        // Check if listeningDurations already has numeric values or needs mapping
        const existingListening = onboardingData.studyPreferences.listeningDurations;
        const listeningDurations = {
          weekday: typeof existingListening?.weekday === 'number'
            ? existingListening.weekday
            : sessionMinutes,
          weekend: typeof existingListening?.weekend === 'number'
            ? existingListening.weekend
            : sessionMinutes,
        };

        console.log('[SESSION][config] Mapped onboarding to minutes:', {
          dailyCommitment: onboardingData.studyPreferences.dailyCommitment,
          sessionMinutes,
          listeningDurations
        });

        const studyPlanId = uuidv4();
        const studyPlanData = {
          id: studyPlanId,
          userId: userId,
          fullName: onboardingData.fullName,
          phoneNumber: onboardingData.phoneNumber || "",
          targetBandScore: onboardingData.targetBandScore.toString(),
          testDate: onboardingData.testDate,
          notDecided: onboardingData.notDecided ? "true" : "false",
          skillRatings: onboardingData.skillRatings,
          immigrationGoal: onboardingData.immigrationGoal,
          studyPreferences: {
            ...onboardingData.studyPreferences,
            sessionMinutes, // Add numeric sessionMinutes
            listeningDurations, // Add numeric listening durations
          },
          plan,
        };

        await storage.runInTransaction(async (txStorage) => {
          console.log("[Plan API] Saving main study plan to database (transaction)...");
          await txStorage.createStudyPlan(studyPlanData);

          if (plan.weeklyPlans && Array.isArray(plan.weeklyPlans)) {
            console.log("[Plan API] Processing weekly plans for persistence...");

            for (const weeklyPlan of plan.weeklyPlans) {
              const weekNumber = weeklyPlan.week;
              const skillActivities: {
                listening: any[];
                reading: any[];
                writing: any[];
                speaking: any[];
                [key: string]: any[];
              } = {
                listening: [],
                reading: [],
                writing: [],
                speaking: [],
              };

              if (weeklyPlan.days && Array.isArray(weeklyPlan.days)) {
                for (const day of weeklyPlan.days) {
                  if (day.activities && Array.isArray(day.activities)) {
                    for (const activity of day.activities) {
                      const skill = activity.skill?.toLowerCase();
                      if (skill && skill in skillActivities) {
                        const dayName =
                          ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][day.day - 1] ||
                          `Day ${day.day}`;

                        const normalizedActivity =
                          skill === "listening" ? normalizeListeningActivity(activity) : activity;

                        const durationLabel =
                          typeof normalizedActivity.duration === "string"
                            ? normalizedActivity.duration
                            : typeof activity.duration === "string"
                              ? activity.duration
                              : "30 min";

                        const durationMinutes =
                          skill === "listening" && typeof normalizedActivity.durationMinutes === "number"
                            ? normalizedActivity.durationMinutes
                            : undefined;

                        const accentCandidate =
                          typeof normalizedActivity.accent === "string" && normalizedActivity.accent.length > 0
                            ? normalizedActivity.accent
                            : typeof activity.accent === "string" && activity.accent.length > 0
                              ? activity.accent
                              : undefined;

                        const baseActivity = {
                          title: normalizedActivity.title || activity.title,
                          day: dayName,
                          duration: durationLabel,
                          status: "not-started",
                          skill,
                          accent: normalizeAccent(accentCandidate),
                          description: normalizedActivity.description || activity.description,
                          contextType: normalizedActivity.contextType || "general",
                          resources: normalizedActivity.resources || activity.resources,
                        } as any;

                        if (durationMinutes !== undefined) {
                          baseActivity.durationMinutes = durationMinutes;
                        }

                        skillActivities[skill].push(baseActivity);
                      }
                    }
                  }
                }
              }

              const tz = PLANNER_TZ;
              const availability = buildAvailabilityFromSchedule(onboardingData.studyPreferences.schedule);
              const weights = deriveWeightsFromSkillRatings(onboardingData.skillRatings ?? {}, onboardingData.targetBandScore ?? 7);
              const nowDate = new Date();
              const windowRange = resolveWeekWindow({
                weekNumber,
                tz,
                referenceDate: nowDate,
              });
              const rawDays = enumerateDays(windowRange.start, windowRange.end);
              const assignments = assignSkillsToDays(rawDays, {
                tz,
                today: nowDate,
                availability,
                weights,
              });

              const distributedActivities: Record<Skill, any[]> = {
                listening: [],
                reading: [],
                writing: [],
                speaking: [],
              };

              const skillQueues: Record<Skill, any[]> = {
                listening: [...skillActivities.listening],
                reading: [...skillActivities.reading],
                writing: [...skillActivities.writing],
                speaking: [...skillActivities.speaking],
              };

              assignments.forEach((assignment, sequenceIndex) => {
                let targetSkill: Skill = assignment.skill;
                if (!skillQueues[targetSkill]?.length) {
                  const fallback = SKILL_ORDER.find((skill) => skillQueues[skill]?.length);
                  if (!fallback) {
                    return;
                  }
                  targetSkill = fallback;
                }

                const queue = skillQueues[targetSkill];
                const activity = queue.shift();
                if (!activity) {
                  return;
                }

                const isoDay = getIsoDayForDate(assignment.date, tz);
                const assignedActivity = {
                  ...activity,
                  dayNumber: isoDay,
                  day: `Day ${sequenceIndex + 1}`,
                  sequenceNumber: sequenceIndex + 1,
                  assignedDate: assignment.date.toISOString(),
                };
                distributedActivities[targetSkill].push(assignedActivity);
              });

              for (const [skillFocus, activities] of Object.entries(distributedActivities)) {
                if (activities.length === 0) {
                  continue;
                }

                const weekFocus = weeklyPlan.goals?.join(", ") || `Week ${weekNumber} focus`;
                const planData = {
                  weekFocus,
                  plan: activities,
                  progressMetrics: weeklyPlan.progressMetrics || [],
                };

                console.log(`[Plan API] Saving weekly plan: Week ${weekNumber} - ${skillFocus}`);
                const createdWeeklyPlan = await txStorage.createOrUpdateWeeklyStudyPlan(
                  userId,
                  weekNumber,
                  skillFocus,
                  weekFocus,
                  planData,
                );

                if (skillFocus === "listening") {
                  const userLevel = onboardingData.skillRatings.listening || 1;
                  const targetBand = onboardingData.targetBandScore || 7;

                  console.log(
                    `[Plan API] Pre-generating scripts for ${activities.length} listening tasks`,
                  );
                  const generatedScripts = await preGenerateScriptsForListeningTasks(
                    userId,
                    createdWeeklyPlan.id,
                    weekNumber,
                    activities,
                    userLevel,
                    targetBand,
                  );

                  if (generatedScripts.length > 0) {
                    const planWithGeneratedMetadata = Array.isArray(planData.plan)
                      ? planData.plan.map((task: any) => {
                          const sourceTitle = task.originalTitle || task.title;
                          const script = generatedScripts.find((s: any) => s.taskTitle === sourceTitle);
                          if (!script) {
                            return task;
                          }

                          const nextTitle = script.generatedTitle || task.title;
                          const scriptMinutes =
                            typeof script.estimatedDurationSec === 'number'
                              ? Math.max(1, Math.round(script.estimatedDurationSec / 60))
                              : undefined;
                          const existingMinutes =
                            typeof task.durationMinutes === 'number'
                              ? task.durationMinutes
                              : typeof task.duration === 'string' && /\d+/.test(task.duration)
                                ? parseInt(task.duration.replace(/\D/g, ''), 10)
                                : undefined;
                          const resolvedMinutes = existingMinutes ?? scriptMinutes ?? DEFAULT_SESSION_MINUTES;
                          const resolvedLabel =
                            typeof task.duration === 'string' && task.duration.trim().length > 0
                              ? task.duration
                              : `${resolvedMinutes} min`;

                          return {
                            ...task,
                            originalTitle: sourceTitle,
                            title: nextTitle,
                            accent: script.accent || task.accent,
                            contextType: script.scriptType || task.contextType,
                            description: script.scenarioOverview || task.description,
                            topicDomain: script.topicDomain || task.topicDomain,
                            contextLabel: script.contextLabel || task.contextLabel,
                            durationMinutes: resolvedMinutes,
                            duration: resolvedLabel,
                          };
                        })
                      : planData.plan;

                    const updatedPlanData = {
                      ...planData,
                      plan: planWithGeneratedMetadata,
                      preGeneratedScripts: generatedScripts,
                    };

                    await txStorage.createOrUpdateWeeklyStudyPlan(
                      userId,
                      weekNumber,
                      skillFocus,
                      weekFocus,
                      updatedPlanData,
                    );
                    console.log(
                      `[Plan API] Stored ${generatedScripts.length} pre-generated scripts in weekly plan`,
                    );
                  }
                }
              }
            }
          }

          await txStorage.updateOnboardingStatus(userId, true);
        });

        console.log("[Plan API] Study plan and weekly plans saved successfully");

        // Return success with plan ID
        return res.status(200).json({
          success: true,
          planId: studyPlanId,
          message: "Study plan generated and saved successfully",
          plan
        });
      } catch (aiError: any) {
        console.error('[Plan API] Error generating IELTS plan with OpenAI:', aiError);
        return res.status(500).json({
          success: false,
          message: "Failed to generate IELTS plan",
          error: typeof aiError === 'object' ? aiError.message || "Unknown OpenAI error" : String(aiError)
        });
      }
    } catch (error: any) {
      console.error('[Plan API] Error in plan generation endpoint:', error);
      return res.status(500).json({
        success: false,
        message: "Server error while processing plan generation",
        error: error.message
      });
    }
  });
  
  // Get weekly study plan by week number (Firebase Auth version)
  app.get('/api/plan/weekly/:weekNumber', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { weekNumber } = req.params;
      const weekNum = parseInt(weekNumber);
      
      if (isNaN(weekNum) || weekNum < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid week number. Must be a positive integer."
        });
      }
      
      console.log(`[Weekly Plan API] GET weekly plans for user ${userId}, week ${weekNum}`);
      
      // Fetch all weekly plans for this user and week
      const weeklyPlans = await storage.getWeeklyStudyPlansByWeek(userId, weekNum);
      
      if (weeklyPlans.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No study plans found for week ${weekNum}`,
          week: weekNum,
          skills: {}
        });
      }
      
      // Group plans by skill
      const skillsData: { [key: string]: any } = {};
      for (const plan of weeklyPlans) {
        let planData = plan.planData;
        if (plan.skillFocus === 'listening') {
          try {
            const progressIds = await ensureProgressForWeeklyPlan({
              userId,
              weeklyPlan: plan,
            });
            const parsedPlan = (plan.planData as any) ?? {};
            if (Array.isArray(parsedPlan.plan)) {
              planData = {
                ...parsedPlan,
                plan: parsedPlan.plan.map((entry: any, index: number) => ({
                  ...entry,
                  progressId: progressIds[index] ?? entry?.progressId ?? null,
                })),
              };
            }
          } catch (ensureErr) {
            console.error('[Weekly Plan API] ensureProgressForWeeklyPlan failed:', ensureErr);
          }
        }

        skillsData[plan.skillFocus] = {
          id: plan.id,
          weekNumber: plan.weekNumber,
          skillFocus: plan.skillFocus,
          weekFocus: plan.weekFocus,
          planData,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt
        };
      }
      
      console.log(`[Weekly Plan API] Found ${weeklyPlans.length} plans for week ${weekNum}`);
      
      return res.status(200).json({
        success: true,
        week: weekNum,
        skills: skillsData
      });
    } catch (error: any) {
      console.error('[Weekly Plan API] Error fetching weekly plans:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch weekly plans",
        error: error.message
      });
    }
  });

  // Get user onboarding data (Firebase Auth version)
  app.get('/api/user/onboarding', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      console.log(`[User Onboarding API] GET onboarding data for user ${userId}`);
      
      // Get the most recent study plan for this user
      const studyPlans = await storage.getStudyPlansByUserId(userId);
      
      if (studyPlans.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No onboarding data found. Please complete onboarding first."
        });
      }
      
      // Get the most recent study plan
      const latestPlan = studyPlans[0]; // Assuming getStudyPlansByUserId returns in descending order
      
      console.log(`[User Onboarding API] Found onboarding data for user ${userId}`);
      
      return res.status(200).json({
        success: true,
        data: {
          fullName: latestPlan.fullName,
          phoneNumber: latestPlan.phoneNumber,
          targetBandScore: parseFloat(latestPlan.targetBandScore),
          testDate: latestPlan.testDate,
          notDecided: latestPlan.notDecided === 'true',
          skillRatings: latestPlan.skillRatings,
          immigrationGoal: latestPlan.immigrationGoal,
          studyPreferences: latestPlan.studyPreferences,
          createdAt: latestPlan.createdAt,
          updatedAt: latestPlan.updatedAt
        }
      });
    } catch (error: any) {
      console.error('[User Onboarding API] Error fetching onboarding data:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch onboarding data",
        error: error.message
      });
    }
  });

  // Get a specific task progress by ID (Firebase Auth version)
  app.get('/api/firebase/task-progress/:progressId', verifyFirebaseAuth, ensureFirebaseUser, getTaskProgressById);
  
  // Get onboarding status (Firebase Auth version)
  app.get('/api/firebase/auth/onboarding-status', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      console.log(`[Onboarding API] GET onboarding status for user ${userId}`);
      
      // Get the user from the database
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Get the latest study plan to include preferences
      let preferences: any = {};
      
      try {
        const studyPlans = await storage.getStudyPlansByUserId(userId);
        const latestPlan = studyPlans.length > 0 ? studyPlans[studyPlans.length - 1] : null;
        if (latestPlan && latestPlan.studyPreferences) {
          const prefs = latestPlan.studyPreferences as any;
          const durations = resolveSessionDurations(prefs, prefs.sessionMinutes ?? DEFAULT_SESSION_MINUTES);
          preferences = {
            sessionMinutes: prefs.sessionMinutes ?? DEFAULT_SESSION_MINUTES,
            dailyCommitment: prefs.dailyCommitment,
            schedule: prefs.schedule,
            style: prefs.style,
            listeningDurations: {
              weekday: durations.weekday,
              weekend: durations.weekend,
            }
          };
        } else {
          preferences = {
            sessionMinutes: DEFAULT_SESSION_MINUTES,
            listeningDurations: {
              weekday: DEFAULT_SESSION_MINUTES,
              weekend: DEFAULT_SESSION_MINUTES,
            }
          };
        }
        console.log('[SESSION][config]', { sessionMinutes: preferences.sessionMinutes, listeningDurations: preferences.listeningDurations });
      } catch (error) {
        console.warn('[Onboarding API] Could not fetch study preferences:', error);
        preferences = {
          sessionMinutes: DEFAULT_SESSION_MINUTES,
          listeningDurations: {
            weekday: DEFAULT_SESSION_MINUTES,
            weekend: DEFAULT_SESSION_MINUTES,
          }
        };
      }
      
      // Return the onboarding status with preferences
      return res.status(200).json({
        success: true,
        onboardingCompleted: user.onboardingCompleted || false,
        userId: user.id,
        firebaseUid: user.firebaseUid,
        preferences,
        source: 'database'
      });
    } catch (error: any) {
      console.error('[Onboarding API] Error fetching onboarding status:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch onboarding status",
        error: error.message
      });
    }
  });
  
  // Complete onboarding (Firebase Auth version)
  app.post('/api/firebase/auth/complete-onboarding', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      console.log(`[Onboarding API] POST complete onboarding for user ${userId}`);
      
      // Update the user's onboarding status
      const updatedUser = await storage.updateOnboardingStatus(userId, true);
      
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      
      // Return success
      return res.status(200).json({
        success: true,
        message: "Onboarding marked complete",
        userId: updatedUser.id
      });
    } catch (error: any) {
      console.error('[Onboarding API] Error completing onboarding:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to complete onboarding",
        error: error.message
      });
    }
  });
  
  // Get task content (Firebase Auth version)
  app.get('/api/firebase/task-content/:id', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      
      // 4) Server route tracing
      console.log('[Task Content API] hit', { taskId: id, uid: userId });
      console.log(`[Task Content API] HIT for taskId: ${id}`);
      console.log(`[Task Content API] Fetching task content for task ID: ${id}`);
      
      // Get the task with all its content
      let taskWithContent = await storage.getTaskWithContent(id);
      
      // 4) Log found task status
      console.log('[Task Content API] found task?', !!taskWithContent, 'status', taskWithContent?.status, { 
        hasScript: !!taskWithContent?.scriptText, 
        hasAudio: !!taskWithContent?.audioUrl 
      });
      
      if (!taskWithContent) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }
      
      // Ensure the user owns this task
      if (taskWithContent.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this task content"
        });
      }
      
      const progressData = (taskWithContent.progressData ?? {}) as Record<string, any>;
      const sessionPrefetch = progressData.sessionPrefetch ?? {};

      if (taskWithContent.skill && taskWithContent.skill.toLowerCase() === 'listening') {
        const status = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
        const ready = Boolean(sessionPrefetch.ready) && (status === PREFETCH_STATUS_READY || status === PREFETCH_STATUS_READY_PARTIAL);

        // Guard: Don't re-queue if already queued/running, or if ready
        if (!ready && status !== PREFETCH_STATUS_QUEUED && status !== PREFETCH_STATUS_RUNNING) {
          await enqueueListeningPrefetch(taskWithContent, userId);

          const currentProgress = (taskWithContent.progressData ?? {}) as Record<string, any>;
          const latestPrefetch = currentProgress.sessionPrefetch ?? {};
          const latestStatus = latestPrefetch.status ?? PREFETCH_STATUS_QUEUED;

          const phase = latestStatus === PREFETCH_STATUS_IDLE ? 'idle'
            : latestStatus === PREFETCH_STATUS_QUEUED ? 'queued'
            : latestStatus === PREFETCH_STATUS_RUNNING ? 'warming'
            : latestStatus === PREFETCH_STATUS_ERROR ? 'error'
            : latestStatus === PREFETCH_STATUS_READY_PARTIAL ? 'partial'
            : latestStatus;

          const minimalTaskContent = {
            id,
            taskTitle: taskWithContent.taskTitle,
            weekNumber: taskWithContent.weekNumber,
            dayNumber: taskWithContent.dayNumber,
            skill: taskWithContent.skill,
            scriptText: null,
            audioUrl: taskWithContent.audioUrl ?? null,
            questions: [],
            progressData: taskWithContent.progressData,
          };

          return res.status(200).json({
            success: true,
            ready: false,
            phase,
            etaSecs: phase === 'queued' || phase === 'warming' ? 45 : null,
            session: {
              status: phase,
              retryCount: latestPrefetch.retryCount ?? 0,
              message: latestPrefetch.message ?? 'Preparing listening session assets',
              errorCode: latestPrefetch.errorCode ?? null,
            },
            taskSummary: {
              id,
              title: taskWithContent.taskTitle,
              activityType: latestPrefetch.activityType ?? taskWithContent.scriptType ?? 'dialogue',
              scenario: latestPrefetch.scenario ?? taskWithContent.contextLabel ?? taskWithContent.topicDomain ?? 'Listening Practice',
              sessionMinutes: latestPrefetch.sessionMinutes ?? null,
            },
            taskContent: minimalTaskContent,
          });
        }
      }

      // STEP 1: Auto-generate script if missing (for listening tasks only)
      if (!taskWithContent.scriptText && taskWithContent.taskTitle && 
          taskWithContent.skill && taskWithContent.skill.toLowerCase() === 'listening') {
        
        console.log(`[Pipeline Stage 1] Starting script generation for listening task ${id}`);
        
        try {
          // Generate script using OpenAI
          const scriptResult = await generateListeningScriptForTask(
            taskWithContent,
            5, // Default user level if not available
            7.0 // Default target band if not available
          );
          
          if (scriptResult && scriptResult.success && scriptResult.scriptText && scriptResult.scriptText.trim().length > 0) {
            // Generate dynamic title if needed
            let updatedTitle = taskWithContent.taskTitle;
            if (needsTitleUpdate(taskWithContent.taskTitle) && scriptResult.contextLabel) {
              updatedTitle = makeListeningTaskTitle({
                scriptType: scriptResult.scriptType === 'dialogue' || scriptResult.scriptType === 'monologue'
                  ? scriptResult.scriptType
                  : undefined,
                contextLabel: scriptResult.contextLabel,
                topicDomain: scriptResult.topicDomain,
                scenarioOverview: scriptResult.scenarioOverview
              });
              console.log(`[Pipeline Stage 1] Updated title from "${taskWithContent.taskTitle}" to "${updatedTitle}"`);
            }
            
            // Update task with generated script and metadata
            await storage.updateTaskContent(id, {
              scriptText: scriptResult.scriptText,
              scriptType: scriptResult.scriptType || 'dialogue',
              difficulty: scriptResult.difficulty || 'intermediate',
              accent: scriptResult.accent,
              ieltsPart: scriptResult.ieltsPart,
              topicDomain: scriptResult.topicDomain,
              contextLabel: scriptResult.contextLabel,
              scenarioOverview: scriptResult.scenarioOverview,
              estimatedDurationSec: scriptResult.estimatedDurationSec,
              taskTitle: updatedTitle
            });
            
            // Update the task object with new metadata (but not scriptText for API response)
            taskWithContent.taskTitle = updatedTitle;
            taskWithContent.scriptType = scriptResult.scriptType || 'dialogue';
            taskWithContent.difficulty = scriptResult.difficulty || 'intermediate';
            taskWithContent.accent = scriptResult.accent || null;
            taskWithContent.ieltsPart = scriptResult.ieltsPart || null;
            taskWithContent.topicDomain = scriptResult.topicDomain || null;
            taskWithContent.contextLabel = scriptResult.contextLabel || null;
            taskWithContent.scenarioOverview = scriptResult.scenarioOverview || null;
            taskWithContent.estimatedDurationSec = scriptResult.estimatedDurationSec || null;
            
            console.log(`[Pipeline Stage 1] ✅ Script generation completed for task ${id} (${scriptResult.scriptText.length} chars)`);
          } else {
            console.error(`[Pipeline Stage 1] ❌ Script generation failed for task ${id}: ${scriptResult?.error || 'Unknown error'}`);
          }
        } catch (scriptError) {
          console.error(`[Pipeline Stage 1] ❌ Script generation error for task ${id}:`, scriptError);
        }
      } else if (taskWithContent.scriptText) {
        console.log(`[Pipeline Stage 1] ✅ Script already exists for task ${id} (${taskWithContent.scriptText.length} chars)`);
      }

      // STEP 2: Auto-generate questions if missing (when scriptText exists and skill is listening)
      if (taskWithContent.scriptText && taskWithContent.skill && 
          taskWithContent.skill.toLowerCase() === 'listening' && !taskWithContent.questions) {
        
        console.log(`[Pipeline Stage 2] Starting question generation for task ${id}`);
        
        try {
          const questionResult = await generateQuestionsFromScript(
            taskWithContent.scriptText,
            taskWithContent.taskTitle || "IELTS Listening Practice",
            taskWithContent.difficulty || "intermediate"
          );
          
          if (questionResult.success && questionResult.questions && questionResult.questions.length > 0) {
            // Update task with generated questions
            await storage.updateTaskContent(id, {
              questions: questionResult.questions
            });
            
            // Update the task object to return the new questions
            taskWithContent.questions = questionResult.questions;
            
            console.log(`[Pipeline Stage 2] ✅ Question generation completed for task ${id} (${questionResult.questions.length} questions)`);
          } else {
            console.warn(`[Pipeline Stage 2] ❌ Question generation failed for task ${id}: ${questionResult.error}`);
            // Set empty array as fallback instead of null
            taskWithContent.questions = [];
          }
        } catch (questionError) {
          console.error(`[Pipeline Stage 2] ❌ Question generation error for task ${id}:`, questionError);
          // Set empty array as fallback instead of null
          taskWithContent.questions = [];
        }
      } else if (taskWithContent.questions) {
        console.log(`[Pipeline Stage 2] ✅ Questions already exist for task ${id} (${Array.isArray(taskWithContent.questions) ? taskWithContent.questions.length : 'unknown'} questions)`);
      }

      // STEP 3: Auto-generate audio if missing (when scriptText exists and skill is listening)
      if (taskWithContent.scriptText && taskWithContent.skill && 
          taskWithContent.skill.toLowerCase() === 'listening' && !taskWithContent.audioUrl) {
        
        console.log(`[Pipeline Stage 3] Starting audio generation for task ${id}`);
        
        try {
          const scriptValidation = validateTranscriptComplete(taskWithContent.scriptText);
          if (!scriptValidation.ok) {
            console.warn(`[Pipeline Stage 3] Skipping audio generation for task ${id} due to incomplete script`, {
              reason: scriptValidation.reason,
            });
          } else {
            const accent = taskWithContent.accent || "British";
            const audioResult = await generateAudioFromScript(
              taskWithContent.scriptText,
              accent,
              userId,
              id,
              taskWithContent.weekNumber
            );
            
            if (audioResult.success && audioResult.audioUrl && audioResult.duration) {
              const sessionMinutes = resolveSessionMinutesFromTask(taskWithContent);
              // Update task with audio URL (duration remains session-based)
              await storage.updateTaskContent(id, {
                audioUrl: audioResult.audioUrl,
                duration: sessionMinutes,
                accent: accent
              });
              
              // Update the task object to return the new audio info
              taskWithContent.audioUrl = audioResult.audioUrl;
              taskWithContent.duration = sessionMinutes;
              taskWithContent.accent = accent;
              
              console.log(`[Pipeline Stage 3] ✅ Audio generation completed for task ${id} (${audioResult.duration}s)`);
            } else {
              console.warn(`[Pipeline Stage 3] ❌ Audio generation failed for task ${id}: ${audioResult.error}`);
            }
          }
        } catch (audioError) {
          console.error(`[Pipeline Stage 3] ❌ Audio generation error for task ${id}:`, audioError);
        }
      } else if (taskWithContent.audioUrl) {
        console.log(`[Pipeline Stage 3] ✅ Audio already exists for task ${id} (${taskWithContent.duration || 'unknown'}s)`);
      }
      
      // Optional: Normalize questions for client compatibility
      const normalizeQuestionsForClient = (qs: any): any[] => {
        return (Array.isArray(qs) ? qs : []).map((q: any, i: number) => {
          const id = String(q?.id ?? `q${i + 1}`);
          const text = typeof q?.text === 'string' ? q.text : (q?.question ?? '');
          const type = q?.type ?? 'multiple-choice';
          const options = Array.isArray(q?.options)
            ? q.options.map((o: any, oi: number) => ({
                id: String(o?.id ?? `o${oi + 1}`),
                label: String(o?.label ?? o?.text ?? ''),
              }))
            : undefined;

          return {
            ...q,
            id,
            text, // Add text field for UI compatibility 
            type,
            options,
          };
        });
      };

      // Apply normalization if questions exist
      if (taskWithContent.questions) {
        taskWithContent.questions = normalizeQuestionsForClient(taskWithContent.questions);
      }

      // Remove scriptText from API response (keep it in DB but don't expose to client)
      if (taskWithContent.scriptText !== undefined) {
        taskWithContent.scriptText = null;
      }
      
      // Log final payload keys before response
      console.log(`[Task Content API] Final response payload keys for ${id}:`, {
        hasTaskContent: !!taskWithContent,
        hasScriptText: false, // Explicitly removed from response
        hasAudioUrl: !!taskWithContent.audioUrl,
        questionsCount: Array.isArray(taskWithContent.questions) ? taskWithContent.questions.length : 0,
        taskTitle: taskWithContent.taskTitle,
        ieltsPart: taskWithContent.ieltsPart,
        contextLabel: taskWithContent.contextLabel,
        topicDomain: taskWithContent.topicDomain
      });
      
      return res.status(200).json({
        success: true,
        taskContent: taskWithContent
      });
    } catch (error: any) {
      console.error('[Task Content API] Error fetching task content:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch task content"
      });
    }
  });
  
  // Get all weekly plans for a specific week (Firebase Auth version)
  app.get('/api/firebase/weekly-plans/week/:weekNumber', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const weekNumber = parseInt(req.params.weekNumber, 10);
      
      console.log(`[Weekly Plans API] GET weekly plans for week ${weekNumber} for user ${userId}`);
      
      // Validate week number
      if (isNaN(weekNumber) || weekNumber < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid week number. Week number must be a positive integer."
        });
      }
      
      // Get all weekly plans for this week
      const plans = await storage.getWeeklyStudyPlansByWeek(userId, weekNumber);
      
      console.log(`[Weekly Plans API] Found ${plans.length} weekly plans for week ${weekNumber}`);
      
      return res.status(200).json({
        success: true,
        plans,
        weekNumber
      });
    } catch (error: any) {
      console.error(`[Weekly Plans API] Error fetching weekly plans for week:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch weekly plans",
        error: error.message
      });
    }
  });

  // POST task attempt submission for AI Coach analytics
  app.post('/api/firebase/task-progress/:id/attempt', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { startedAt, submittedAt, durationMs, answers } = req.body ?? {};
      if (!startedAt || !submittedAt || typeof durationMs !== 'number' || !Array.isArray(answers)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid attempt payload. Required fields: startedAt, submittedAt, durationMs, answers' 
        });
      }

      // Load task content for correctness calculation with ownership validation
      const task = await storage.getTaskProgressById(id, userId);
      if (!task) {
        return res.status(404).json({ 
          success: false, 
          message: 'Task not found or access denied' 
        });
      }

      console.log(`[Task Attempt API] Processing attempt submission for task ${id}`, {
        userId,
        answersCount: answers.length,
        durationMs
      });

      // Normalize server questions to calculate correctness
      const LETTERS = ['A', 'B', 'C', 'D'];
      const normalizedQs = (Array.isArray(task.questions) ? task.questions : []).map((q: any, qi: number) => {
        const options = Array.isArray(q.options)
          ? q.options.map((opt: any, oi: number) =>
              typeof opt === 'string' 
                ? { id: `option${oi+1}`, text: opt } 
                : { id: opt?.id ?? `option${oi+1}`, text: opt?.text ?? '' }
            )
          : [];
        
        const letter = (q?.correctAnswer ?? '').toString().trim().toUpperCase();
        const idx = LETTERS.indexOf(letter);
        const correctOptionId = idx >= 0 && options[idx] ? options[idx].id : null;

        return {
          id: q?.id ?? `q${qi+1}`,
          text: q?.text ?? q?.question ?? '',
          options,
          correctOptionId,
          explanation: q?.explanation ?? '',
        };
      });

      const byId = new Map(normalizedQs.map(q => [q.id, q]));

      // Add type for attempt answer details
      type AttemptAnswerDetail = {
        questionId: string;
        isCorrect: boolean;
        pickedOptionId: string | null;
        pickedOptionText: string | null;
        correctOptionId: string;
        correctOptionText: string;
        explanation?: string;
      };

      // Calculate detailed results per question with resolved option text
      const detailed: AttemptAnswerDetail[] = answers.map((a: any) => {
        const q = byId.get(a.questionId);
        const correctOptionId = q?.correctOptionId ?? '';
        const pickedOptionId = a?.pickedOptionId ?? null;
        
        // Find the actual option objects to get their text
        const pickedOption = pickedOptionId ? q?.options?.find((opt: any) => opt.id === pickedOptionId) : null;
        const correctOption = correctOptionId ? q?.options?.find((opt: any) => opt.id === correctOptionId) : null;
        
        const isCorrect = !!(pickedOptionId && correctOptionId && pickedOptionId === correctOptionId);
        
        return {
          questionId: String(a.questionId),
          isCorrect,
          pickedOptionId,
          pickedOptionText: pickedOption?.text ?? null,
          correctOptionId,
          correctOptionText: correctOption?.text ?? '',
          explanation: q?.explanation ?? undefined,
        };
      });

      const correct = detailed.filter(d => d.isCorrect).length;
      const total = detailed.length;
      const percent = total ? Math.round((correct / total) * 100) : 0;

      const attempt = {
        id: crypto.randomUUID(),
        taskProgressId: id,
        userId,
        startedAt,
        submittedAt,
        durationMs,
        answers: detailed.map(d => ({
          questionId: d.questionId,
          pickedOptionId: d.pickedOptionId,
          correctOptionId: d.correctOptionId,
          isCorrect: d.isCorrect,
        })), // Keep simpler structure for database storage
        score: { correct, total, percent },
      };

      // Persist attempt to database
      await storage.insertTaskAttempt(attempt);

      console.log(`[Task Attempt API] Successfully saved attempt ${attempt.id}`, {
        score: attempt.score,
        detailedCount: detailed.length
      });

      return res.json({
        success: true,
        attemptId: attempt.id,
        score: attempt.score,
        detailed
      });

    } catch (err: any) {
      console.error('[POST /task-progress/:id/attempt] error', err);
      return res.status(500).json({ 
        success: false, 
        message: err?.message ?? 'Server error processing attempt submission' 
      });
    }
  });

  // ========== SESSION MANAGEMENT ENDPOINTS ==========

  // Start or resume a session for a task
  app.post('/api/session/start', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId, durationMinutes } = req.body;

      if (!taskProgressId || !durationMinutes) {
        return res.status(400).json({
          success: false,
          message: 'taskProgressId and durationMinutes are required'
        });
      }

      // Get task progress
      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      let sessionState: import('@shared/schema').SessionState = progressData.sessionState;

      // Initialize or resume session
      if (!sessionState || !sessionState.startedAt) {
        // New session
        sessionState = {
          status: "running",
          durationMinutes,
          startedAt: now,
          consumedMs: 0,
          remainingMs: durationMinutes * 60_000,
          currentAudioIndex: 0,
          lastSyncedAt: now
        };
      } else if (sessionState.status === "paused") {
        // Resume from pause
        sessionState.status = "running";
        sessionState.pausedAt = undefined;
        sessionState.lastSyncedAt = now;
      }

      // Update task
      await storage.updateTaskProgress(taskProgressId, {
        progressData: { ...progressData, sessionState },
        status: "in-progress",
        startedAt: task.startedAt || new Date()
      });

      console.log('[Session Start]', { userId, taskProgressId, status: sessionState.status });

      return res.json({
        success: true,
        sessionState
      });

    } catch (err: any) {
      console.error('[POST /session/start] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error starting session'
      });
    }
  });

  // Pause a running session
  app.post('/api/session/pause', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.body;

      if (!taskProgressId) {
        return res.status(400).json({
          success: false,
          message: 'taskProgressId is required'
        });
      }

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      const sessionState: import('@shared/schema').SessionState = progressData.sessionState;

      if (!sessionState) {
        return res.status(400).json({
          success: false,
          message: 'No active session found'
        });
      }

      // Calculate consumed time
      if (sessionState.status === "running") {
        const activeTime = now - (sessionState.pausedAt || sessionState.startedAt || now);
        sessionState.consumedMs += activeTime;
        sessionState.remainingMs = (sessionState.durationMinutes * 60_000) - sessionState.consumedMs;
        sessionState.status = "paused";
        sessionState.pausedAt = now;
        sessionState.lastSyncedAt = now;
      }

      await storage.updateTaskProgress(taskProgressId, {
        progressData: { ...progressData, sessionState }
      });

      console.log('[Session Pause]', { userId, taskProgressId, remainingMs: sessionState.remainingMs });

      return res.json({
        success: true,
        sessionState
      });

    } catch (err: any) {
      console.error('[POST /session/pause] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error pausing session'
      });
    }
  });

  // Resume a paused session
  app.post('/api/session/resume', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.body;

      if (!taskProgressId) {
        return res.status(400).json({
          success: false,
          message: 'taskProgressId is required'
        });
      }

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      const sessionState: import('@shared/schema').SessionState = progressData.sessionState;

      if (!sessionState || sessionState.status !== "paused") {
        return res.status(400).json({
          success: false,
          message: 'No paused session found'
        });
      }

      sessionState.status = "running";
      sessionState.pausedAt = undefined;
      sessionState.lastSyncedAt = now;

      await storage.updateTaskProgress(taskProgressId, {
        progressData: { ...progressData, sessionState }
      });

      console.log('[Session Resume]', { userId, taskProgressId, remainingMs: sessionState.remainingMs });

      return res.json({
        success: true,
        sessionState
      });

    } catch (err: any) {
      console.error('[POST /session/resume] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error resuming session'
      });
    }
  });

  // Finish a session (natural completion or expiry)
  app.post('/api/session/finish', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId, sessionResult, isExpired } = req.body;

      if (!taskProgressId || !sessionResult) {
        return res.status(400).json({
          success: false,
          message: 'taskProgressId and sessionResult are required'
        });
      }

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      const sessionState: import('@shared/schema').SessionState = progressData.sessionState;

      if (!sessionState) {
        return res.status(400).json({
          success: false,
          message: 'No active session found'
        });
      }

      // Update session state
      sessionState.status = isExpired ? "expired" : "completed";
      sessionState.sessionResult = sessionResult;
      sessionState.readyForStrike = true;
      sessionState.lastSyncedAt = now;

      await storage.updateTaskProgress(taskProgressId, {
        progressData: { ...progressData, sessionState },
        status: "completed",
        completedAt: new Date()
      });

      console.log('[Session Finish]', { userId, taskProgressId, status: sessionState.status });

      return res.json({
        success: true,
        sessionState
      });

    } catch (err: any) {
      console.error('[POST /session/finish] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error finishing session'
      });
    }
  });

  // Sync session state (for drift prevention)
  app.get('/api/session/sync/:taskProgressId', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { taskProgressId } = req.params;

      const task = await storage.getTaskProgress(taskProgressId);
      if (!task || task.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied or task not found'
        });
      }

      const now = Date.now();
      const progressData = task.progressData as any || {};
      const sessionState: import('@shared/schema').SessionState = progressData.sessionState;

      if (!sessionState) {
        return res.json({
          success: true,
          sessionState: null
        });
      }

      // Update remaining time if running
      if (sessionState.status === "running" && sessionState.startedAt) {
        const activeTime = now - (sessionState.pausedAt || sessionState.startedAt);
        sessionState.consumedMs += activeTime;
        sessionState.remainingMs = Math.max(0, (sessionState.durationMinutes * 60_000) - sessionState.consumedMs);
        sessionState.lastSyncedAt = now;

        // Auto-expire if time ran out
        if (sessionState.remainingMs <= 0) {
          sessionState.status = "expired";
        }

        // Update in DB
        await storage.updateTaskProgress(taskProgressId, {
          progressData: { ...progressData, sessionState }
        });
      }

      return res.json({
        success: true,
        sessionState
      });

    } catch (err: any) {
      console.error('[GET /session/sync] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error syncing session'
      });
    }
  });

  // Get AI advisor feedback for a completed audio
  app.post('/api/session/advisor', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const { audioIndex, questions, scriptExcerpt } = req.body;

      if (audioIndex === undefined || !Array.isArray(questions)) {
        return res.status(400).json({
          success: false,
          message: 'audioIndex and questions array are required'
        });
      }

      const feedback = await generateAdvisorFeedback({
        audioIndex,
        questions,
        scriptExcerpt
      });

      if (!feedback.success) {
        return res.status(500).json(feedback);
      }

      return res.json(feedback);

    } catch (err: any) {
      console.error('[POST /session/advisor] error', err);
      return res.status(500).json({
        success: false,
        message: err?.message ?? 'Server error generating advisor feedback'
      });
    }
  });

  // Create next listening task during a session (Firebase Auth version)
  app.post('/api/session/next-listening-task', verifyFirebaseAuth, ensureFirebaseUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { progressId, taskId, remainingMs } = req.body;
      
      // Validate remaining time
      if (remainingMs < NEXT_MIN_MS) {
        console.log('[NEXT][server]', { userId, fromProgressId: progressId, remainingMs, ok: false, reason: 'time_exhausted' });
        return res.status(200).json({
          ok: false,
          reason: 'time_exhausted'
        });
      }
      
      // Verify user owns the progressId
      const currentTask = await storage.getTaskProgress(progressId);
      if (!currentTask || currentTask.userId !== userId) {
        return res.status(403).json({
          ok: false,
          reason: 'access_denied'
        });
      }
      
      const currentProgressData = (currentTask.progressData ?? {}) as Record<string, any>;
      const batchId =
        typeof currentProgressData.sessionBatchId === 'string'
          ? currentProgressData.sessionBatchId
          : null;
      const currentOrder =
        typeof currentProgressData.sessionOrder === 'number'
          ? currentProgressData.sessionOrder
          : null;

      if (batchId && currentTask.weeklyPlanId) {
        const planTasks = await storage.getTaskProgressByWeeklyPlan(currentTask.weeklyPlanId, userId);
        const nextPrefetched = planTasks
          .filter((task) => {
            if (task.id === currentTask.id) return false;
            const pd = (task.progressData ?? {}) as Record<string, any>;
            if (pd?.sessionBatchId !== batchId) return false;
            if (typeof pd?.sessionOrder !== 'number') return false;
            if (currentOrder !== null && pd.sessionOrder <= currentOrder) return false;
            if (task.status !== 'not-started') return false;

            // Filter by readiness: must have ready or ready_partial status and audio URL
            const sessionPrefetch = pd?.sessionPrefetch ?? {};
            const status = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
            const ready = (status === PREFETCH_STATUS_READY || status === PREFETCH_STATUS_READY_PARTIAL) && Boolean(task.audioUrl);

            return ready;
          })
          .sort((a, b) => {
            const ao = ((a.progressData ?? {}) as any)?.sessionOrder ?? 0;
            const bo = ((b.progressData ?? {}) as any)?.sessionOrder ?? 0;
            return ao - bo;
          })[0];

        if (nextPrefetched) {
          console.log('[NEXT][server]', {
            userId,
            fromProgressId: progressId,
            remainingMs,
            ok: true,
            progressId: nextPrefetched.id,
            source: 'prefetch',
          });

          return res.status(200).json({
            ok: true,
            progressId: nextPrefetched.id,
            taskId: nextPrefetched.id,
          });
        }

        // No ready task found - return warming state
        const hasWarmingTasks = planTasks.some((task) => {
          const pd = (task.progressData ?? {}) as Record<string, any>;
          if (pd?.sessionBatchId !== batchId) return false;
          const sessionPrefetch = pd?.sessionPrefetch ?? {};
          const status = sessionPrefetch.status ?? PREFETCH_STATUS_IDLE;
          return status === PREFETCH_STATUS_QUEUED || status === PREFETCH_STATUS_RUNNING;
        });

        if (hasWarmingTasks) {
          console.log('[NEXT][server]', {
            userId,
            fromProgressId: progressId,
            remainingMs,
            ok: false,
            reason: 'warming',
          });

          return res.status(200).json({
            ok: false,
            reason: 'warming',
            phase: 'warming',
            message: 'Preparing next task in session',
          });
        }
      }

      // Create follow-up task
      const result = await createFollowUpListeningTask({
        userId,
        from: { progressId, taskId }
      });
      
      console.log('[NEXT][server]', { userId, fromProgressId: progressId, remainingMs, ok: true, ...result });
      
      // Trigger the 3-stage pipeline asynchronously
      (async () => {
        try {
          const newTask = await storage.getTaskProgress(result.progressId);
          if (!newTask) return;
          const sessionMinutes = resolveSessionMinutesFromTask(newTask);
          
          // Get user's target band and skill level
          const studyPlans = await storage.getStudyPlansByUserId(userId);
          const latestPlan = studyPlans.length > 0 ? studyPlans[studyPlans.length - 1] : null;
          
          if (!latestPlan) {
            console.error('[NEXT][pipeline] No study plan found for user');
            return;
          }
          
          const skillRatings = latestPlan.skillRatings as Record<string, number>;
          const userLevel = skillRatings?.listening || 1;
          const targetBand = parseFloat(latestPlan.targetBandScore) || 7;
          
          // Stage 1: Generate script
          console.log('[NEXT][pipeline] Starting script generation');
          const scriptResult = await generateListeningScriptForTask(newTask, userLevel, targetBand);
          
          if (scriptResult.success && scriptResult.scriptText) {
            const followUpTitle = makeListeningTaskTitle({
              scriptType: scriptResult.scriptType === 'dialogue' || scriptResult.scriptType === 'monologue'
                ? scriptResult.scriptType
                : undefined,
              contextLabel: scriptResult.contextLabel,
              topicDomain: scriptResult.topicDomain,
              scenarioOverview: scriptResult.scenarioOverview
            });

            await storage.updateTaskContent(result.progressId, {
              scriptText: scriptResult.scriptText,
              accent: scriptResult.accent!,
              scriptType: scriptResult.scriptType!,
              difficulty: scriptResult.difficulty!,
              duration: sessionMinutes,
              ieltsPart: scriptResult.ieltsPart,
              topicDomain: scriptResult.topicDomain,
              contextLabel: scriptResult.contextLabel,
              scenarioOverview: scriptResult.scenarioOverview,
              estimatedDurationSec: scriptResult.estimatedDurationSec,
              taskTitle: followUpTitle
            });
            newTask.taskTitle = followUpTitle;
            
            // Stage 2: Generate questions
            console.log('[NEXT][pipeline] Starting question generation');
            const questionsResult = await generateQuestionsFromScript(
              scriptResult.scriptText,
              newTask.taskTitle,
              scriptResult.difficulty || 'intermediate'
            );
            
            if (questionsResult.success && questionsResult.questions) {
              await storage.updateTaskContent(result.progressId, {
                questions: questionsResult.questions
              });
            }
            
            // Stage 3: Generate audio
            console.log('[NEXT][pipeline] Starting audio generation');
            const followUpScriptValidation = validateTranscriptComplete(scriptResult.scriptText);
            if (!followUpScriptValidation.ok) {
              console.warn('[NEXT][pipeline] Skipping audio generation due to incomplete script', {
                progressId: result.progressId,
                reason: followUpScriptValidation.reason,
              });
            } else {
              const audioResult = await generateAudioFromScript(
                scriptResult.scriptText,
                scriptResult.accent || 'British',
                userId,
                result.progressId,
                newTask.weekNumber
              );
              
              if (audioResult.success && audioResult.audioUrl) {
                await storage.updateTaskContent(result.progressId, {
                  audioUrl: audioResult.audioUrl,
                  duration: sessionMinutes
                });
              }
            }
          }
          
          console.log('[NEXT][pipeline] Pipeline complete for', result.progressId);
        } catch (error) {
          console.error('[NEXT][pipeline] Error:', error);
        }
      })();
      
      return res.status(200).json({
        ok: true,
        progressId: result.progressId,
        taskId: result.taskId
      });
      
    } catch (error: any) {
      console.error('[NEXT][server] Error creating next task:', error);
      return res.status(500).json({
        ok: false,
        reason: 'server_error',
        message: error.message
      });
    }
  });

  // Register regenerate routes for SSE-S3 audio fixing
  registerRegenerateRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
