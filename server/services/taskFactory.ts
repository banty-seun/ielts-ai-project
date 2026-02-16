import { v4 as uuidv4 } from 'uuid';
import { storage } from '../storage';
import { makeListeningTaskTitle } from './title';
import { resolveSessionMinutesFromTask } from './sessionDuration';
import {
  ACCENT_TO_TTS_VOICE,
  DEFAULT_ACCENT,
  IELTS_PARTS,
  LISTENING_SEGMENT_TYPES,
  LISTENING_SESSION_MINUTES,
  type Accent,
} from '../../shared/constants';
import { normalizeAccent } from '../utils/audio.ts';

export interface ListeningSegment {
  id: string;
  ieltsPart: (typeof IELTS_PARTS)[number];
  type: (typeof LISTENING_SEGMENT_TYPES)[number];
  title: string;
  transcript?: string | null;
  audioUrl?: string | null;
  estimatedDurationSec: number;
  accent?: Accent;
  voiceId?: string;
}

const clampSeconds = (value: number): number => Math.max(30, Math.round(value));

export function ensureListeningSegments(
  currentSegments: Array<Partial<ListeningSegment>> | null | undefined,
  sessionMinutes: number,
  options?: { baseTitle?: string; accent?: string | null },
): ListeningSegment[] {
  const totalSeconds = Math.max(120, Math.round((sessionMinutes || 0) * 60));
  const perSegmentSeconds = clampSeconds(Math.floor(totalSeconds / IELTS_PARTS.length));
  const normalizedAccent = normalizeAccent(options?.accent ?? DEFAULT_ACCENT);
  const defaultVoice = ACCENT_TO_TTS_VOICE[normalizedAccent] ?? ACCENT_TO_TTS_VOICE[DEFAULT_ACCENT];
  const baseSegments = IELTS_PARTS.map((part, index) => ({
    id: uuidv4(),
    ieltsPart: part,
    type: LISTENING_SEGMENT_TYPES[index % LISTENING_SEGMENT_TYPES.length],
    title: `${options?.baseTitle ?? 'Listening Practice'} — Part ${part}`,
    estimatedDurationSec: perSegmentSeconds,
  }));

  const existing = Array.isArray(currentSegments) ? currentSegments.filter(Boolean) : [];
  const existingByPart = new Map<number, Partial<ListeningSegment>>();
  existing.forEach((segment) => {
    if (!segment) return;
    const part = Number(segment.ieltsPart);
    if (!Number.isFinite(part)) return;
    existingByPart.set(part, segment);
  });

  return baseSegments.map((base, index) => {
    const fallbackExisting = existing[index];
    const matched = existingByPart.get(base.ieltsPart) ?? fallbackExisting;
    const accent = normalizeAccent((matched?.accent as string | undefined) ?? normalizedAccent);
    const voiceId = matched?.voiceId ?? ACCENT_TO_TTS_VOICE[accent] ?? defaultVoice;

    return {
      ...base,
      ...matched,
      id: typeof matched?.id === 'string' ? matched.id : base.id,
      ieltsPart: (matched?.ieltsPart as (typeof IELTS_PARTS)[number]) ?? base.ieltsPart,
      type: (matched?.type as (typeof LISTENING_SEGMENT_TYPES)[number]) ?? base.type,
      title:
        typeof matched?.title === 'string' && matched.title.trim().length > 0 ? matched.title : base.title,
      transcript: typeof matched?.transcript === 'string' ? matched.transcript : matched?.transcript ?? null,
      audioUrl: typeof matched?.audioUrl === 'string' ? matched.audioUrl : null,
      estimatedDurationSec:
        typeof matched?.estimatedDurationSec === 'number' && matched.estimatedDurationSec > 0
          ? clampSeconds(matched.estimatedDurationSec)
          : perSegmentSeconds,
      accent,
      voiceId,
    };
  });
}

export function buildListeningSegments(options: { sessionMinutes: number; baseTitle?: string }): ListeningSegment[] {
  return ensureListeningSegments([], options.sessionMinutes, options);
}

export async function createFollowUpListeningTask(opts: {
  userId: string;
  from: { progressId: string; taskId: string };
}): Promise<{ progressId: string; taskId: string }> {
  const { userId, from } = opts;
  
  // Read current task content to inherit properties
  const currentTask = await storage.getTaskProgress(from.progressId);
  if (!currentTask) {
    throw new Error('Follow-up source task not found');
  }

  if (currentTask.userId !== userId) {
    throw new Error('Follow-up task access denied');
  }
  
  const weeklyPlanId = currentTask.weeklyPlanId;
  if (!weeklyPlanId) {
    throw new Error('Follow-up task missing weekly plan reference');
  }
  
  // Get the weekly plan info to maintain week context
  const weeklyPlan = await storage.getWeeklyStudyPlan(weeklyPlanId);
  if (!weeklyPlan) {
    throw new Error(`Weekly plan ${weeklyPlanId} not found`);
  }

  const sessionMinutesRaw = resolveSessionMinutesFromTask(currentTask);
  const sessionMinutes = Math.max(sessionMinutesRaw, LISTENING_SESSION_MINUTES);
  
  // Build title with inherited context
  const title = makeListeningTaskTitle({
    scriptType: (currentTask.scriptType || 'dialogue') as 'dialogue' | 'monologue',
    contextLabel: currentTask.contextLabel || 'conversation',
    topicDomain: currentTask.topicDomain || 'general',
    scenarioOverview: currentTask.scenarioOverview || ''
  });
  const currentProgressData = (currentTask.progressData ?? {}) as Record<string, any>;
  const segments = ensureListeningSegments(currentProgressData.segments as any, sessionMinutes, {
    baseTitle: title,
    accent: currentTask.accent,
  });
  
  // Create new task progress with inherited properties
  const newProgressId = uuidv4();
  const newTaskId = uuidv4();
  
  const newTaskProgress = {
    id: newProgressId,
    userId,
    weeklyPlanId: currentTask.weeklyPlanId,
    weekNumber: currentTask.weekNumber,
    dayNumber: currentTask.dayNumber, // Same day, continuing session
    taskTitle: title,
    skill: 'listening' as const,
    status: 'not-started' as const,
    
    // Inherit key properties for continuity
    accent: currentTask.accent || 'British',
    ieltsPart: currentTask.ieltsPart,
    topicDomain: currentTask.topicDomain,
    contextLabel: currentTask.contextLabel,
    scriptType: currentTask.scriptType || 'dialogue',
    
    // These will be populated by the pipeline
    scriptText: null,
    audioUrl: null,
    questions: null,
    difficulty: null,
    duration: sessionMinutes,
    replayLimit: 3,
    progressData: {
      ...(currentTask.progressData ?? {}),
      sessionDurationMinutes: sessionMinutes,
      segments,
    },
    startedAt: null,
    completedAt: null,
    scenarioOverview: null,
    estimatedDurationSec: null,
    
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  await storage.createTaskProgress(newTaskProgress);
  
  console.log('[TASK_FACTORY][createFollowUp]', {
    userId,
    fromProgressId: from.progressId,
    newProgressId,
    newTaskId,
    title,
    inheritedAccent: currentTask.accent,
    inheritedPart: currentTask.ieltsPart
  });
  
  return {
    progressId: newProgressId,
    taskId: newTaskId
  };
}
