import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRoute, Link as WouterLink, useLocation } from 'wouter';
import { ChevronLeft, Play, Pause, RotateCcw, Volume2, AlignLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useTaskProgress } from '@/hooks/useTaskProgress';
import { useTaskContent } from '@/hooks/useTaskContent';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { QuotaErrorAlert } from '@/components/QuotaErrorAlert';
import { queryClient } from '@/lib/queryClient';
import { getFreshWithAuth, postJsonWithAuth } from '@/lib/apiClient';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_SESSION_MINUTES, NEXT_MIN_MS, SESSION_START_KEY, msToMMSS } from '@shared/constants';
import { SessionWarmup } from '@/components/SessionWarmup';
import { useCountdownTimer } from '@/hooks/useCountdown';

// Debug toggle
const DEBUG = Boolean((window as any).__DEBUG__);

// Types for attempt submission
type AttemptAnswerPayload = {
  questionId: string;
  pickedOptionId: string | null;
  timeMs?: number;
  replayCountAtAnswer?: number;
};

type AttemptSubmitPayload = {
  startedAt: string;
  submittedAt: string;
  durationMs: number;
  answers: AttemptAnswerPayload[];
};

type AttemptAnswerDetail = {
  questionId: string;
  isCorrect: boolean;
  pickedOptionId: string | null;
  pickedOptionText: string | null;
  correctOptionId: string;
  correctOptionText: string;
  explanation?: string;
};

type AttemptResponse = {
  success: boolean;
  score: { correct: number; total: number; percent: number };
  detailed: AttemptAnswerDetail[];
};

// Question types from API
// Use normalized types from useTaskContent hook
interface QuestionOption {
  id: string;
  label: string;
}

interface Question {
  id: string;
  text: string;
  type: 'multiple-choice' | 'fill-in-the-gap' | 'fill-in-multiple-gaps';
  options?: QuestionOption[];
  correctAnswer?: string;
  explanation?: string;
  hint?: string;
}

type ListeningSegment = {
  id: string;
  ieltsPart?: number;
  type?: string;
  title?: string;
  audioUrl?: string | null;
  estimatedDurationSec?: number;
};

type SegmentResultRecord = {
  segmentId: string;
  correct: number;
  total: number;
  mistakeTags?: string[];
  tagStats?: Record<string, { correct: number; total: number }>;
  submittedAt?: string;
};

const SEGMENT_TAG_LABELS: Record<string, string> = {
  numbers: "Numbers & dates",
  dates: "Dates & schedules",
  maps: "Maps",
  directions: "Directions",
  synonyms: "Synonym traps",
  vocabulary: "Vocabulary-in-context",
  detail: "Specific details",
  inference: "Inference",
  attitude: "Speaker attitude",
  general: "Overall",
};

const friendlySegmentTag = (tag: string) => SEGMENT_TAG_LABELS[tag] ?? tag.replace(/[-_]/g, " ");

const buildSegmentFeedback = (
  tagStats?: Record<string, { correct: number; total: number }>,
  percent: number = 0,
) => {
  const entries = Object.entries(tagStats ?? {}).map(([tag, stats]) => {
    const total = Number(stats.total ?? 0);
    const correct = Number(stats.correct ?? 0);
    return {
      tag,
      total,
      correct,
      accuracy: total > 0 ? correct / total : 0,
    };
  });

  entries.sort((a, b) => b.accuracy - a.accuracy);

  const strengths = entries
    .filter((entry) => entry.total >= 1 && entry.accuracy >= 0.75)
    .slice(0, 2)
    .map(
      (entry) =>
        `Strong on ${friendlySegmentTag(entry.tag)} (${entry.correct}/${entry.total} correct)`,
    );

  const focusNext = entries
    .filter((entry) => entry.total >= 1 && entry.accuracy <= 0.6)
    .slice(0, 2)
    .map(
      (entry) =>
        `Review ${friendlySegmentTag(entry.tag)} questions (${entry.correct}/${entry.total} correct)`,
    );

  if (!strengths.length) {
    strengths.push(
      percent >= 70
        ? "Solid accuracy overall — keep listening for keyword shifts."
        : "Stay focused on key details throughout each recording.",
    );
  }

  if (!focusNext.length) {
    focusNext.push(
      percent >= 90
        ? "Push for perfect by double-checking tricky paraphrases."
        : "Slow down to capture keywords before selecting an answer.",
    );
  }

  return { strengths, focusNext };
};

type SegmentReviewState = {
  segmentId: string;
  segmentLabel: string;
  correct: number;
  total: number;
  percent: number;
  strengths: string[];
  focusNext: string[];
  nextIndex: number;
  isFinal: boolean;
};

// Components for different question types
const determineDayType = (dayNumber?: number | null, explicit?: string | null) => {
  const explicitLower = typeof explicit === 'string' ? explicit.toLowerCase() : undefined;
  if (explicitLower === 'weekday' || explicitLower === 'weekend') {
    return explicitLower;
  }

  if (typeof dayNumber !== 'number' || Number.isNaN(dayNumber)) {
    return 'weekday';
  }

  const normalized = ((dayNumber - 1) % 7) + 1;
  return normalized === 6 || normalized === 7 ? 'weekend' : 'weekday';
};

const chunkQuestionIdsClient = (ids: string[], segmentCount: number, index: number) => {
  if (!ids.length || segmentCount <= 0) return [];
  const start = Math.floor((index / segmentCount) * ids.length);
  const rawEnd = Math.floor(((index + 1) / segmentCount) * ids.length);
  const end = Math.max(start + 1, rawEnd);
  return ids.slice(start, end);
};

const formatSegmentLabel = (segment: ListeningSegment, index: number) => {
  if (segment.ieltsPart) {
    return `Part ${segment.ieltsPart}`;
  }
  return `Segment ${index + 1}`;
};

const deriveSegmentAssignmentsClient = (
  segments: ListeningSegment[],
  questions: Question[],
  serverAssignments: Record<string, string[]>,
) => {
  if (!segments.length || !questions.length) {
    return {};
  }

  const combined: Record<string, string[]> = { ...serverAssignments };
  const ids = questions.map((q) => q.id);

  segments.forEach((segment, index) => {
    const segId = segment.id;
    if (!Array.isArray(combined[segId]) || !combined[segId].length) {
      combined[segId] = chunkQuestionIdsClient(ids, segments.length, index);
    }
  });

  return combined;
};

const MultipleChoiceQuestion = ({ 
  question, 
  selectedAnswer, 
  onSelectAnswer,
  isSubmitted
}: { 
  question: Question; 
  selectedAnswer: string | null;
  onSelectAnswer: (answerId: string) => void;
  isSubmitted: boolean;
}) => {
  if (!question.options) return null;

  return (
    <div className="my-6">
      <p className="font-medium mb-3">{question.text}</p>
      <RadioGroup 
        value={selectedAnswer || ""}
        onValueChange={(value) => !isSubmitted && onSelectAnswer(value)}
        className="space-y-3"
      >
        {question.options.map((option) => {
          const isCorrect = isSubmitted && option.id === question.correctAnswer;
          const isIncorrect = isSubmitted && selectedAnswer === option.id && option.id !== question.correctAnswer;

          return (
            <div key={option.id} className="flex items-center space-x-2">
              <RadioGroupItem 
                value={option.id} 
                id={option.id} 
                disabled={isSubmitted}
                className={cn(
                  isCorrect && "border-green-500 text-green-500",
                  isIncorrect && "border-red-500 text-red-500"
                )}
              />
              <Label 
                htmlFor={option.id}
                className={cn(
                  "cursor-pointer",
                  isCorrect && "text-green-500 font-medium",
                  isIncorrect && "text-red-500 font-medium line-through"
                )}
              >
                {option.label}
              </Label>
              {isCorrect && (
                <CheckCircle className="h-4 w-4 text-green-500 ml-2" />
              )}
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
};

const FillInTheGapQuestion = ({ 
  question, 
  answer, 
  onAnswerChange,
  isSubmitted
}: { 
  question: Question; 
  answer: string;
  onAnswerChange: (text: string) => void;
  isSubmitted: boolean;
}) => {
  return (
    <div className="my-6">
      <p className="font-medium mb-3">{question.text}</p>
      <div className="mt-2">
        <Textarea 
          placeholder="Type your answer here..."
          value={answer}
          onChange={(e) => !isSubmitted && onAnswerChange(e.target.value)}
          disabled={isSubmitted}
          className={cn(
            "resize-none h-20",
            isSubmitted && (
              answer === question.correctAnswer 
                ? "border-green-500 focus-visible:ring-green-500" 
                : "border-red-500 focus-visible:ring-red-500"
            )
          )}
        />

        {isSubmitted && (
          <div className="mt-3">
            <p className={cn(
              "text-sm font-medium",
              answer === question.correctAnswer ? "text-green-600" : "text-red-600"
            )}>
              {answer === question.correctAnswer 
                ? "Correct!" 
                : `Incorrect. The correct answer is: ${question.correctAnswer}`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const SegmentStepper = ({
  segments,
  currentIndex,
  completedIds,
}: {
  segments: ListeningSegment[];
  currentIndex: number;
  completedIds: Set<string>;
}) => {
  if (!segments.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {segments.map((segment, index) => {
        const status =
          completedIds.has(segment.id) ? "completed" : index === currentIndex ? "current" : "upcoming";
        return (
          <div
            key={segment.id}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border",
              status === "completed" && "bg-green-100 text-green-800 border-green-300",
              status === "current" && "bg-indigo-100 text-indigo-800 border-indigo-300",
              status === "upcoming" && "bg-gray-100 text-gray-600 border-gray-300",
            )}
          >
            {formatSegmentLabel(segment, index)}
          </div>
        );
      })}
    </div>
  );
};

const SummaryBulletList = ({ title, items }: { title: string; items: string[] }) => (
  <div>
    <h4 className="text-sm font-semibold text-gray-800 mb-2">{title}</h4>
    <ul className="list-disc pl-5 space-y-1 text-sm text-gray-600">
      {items.map((item, idx) => (
        <li key={`${title}-${idx}`}>{item}</li>
      ))}
    </ul>
  </div>
);

const SegmentResultSummary = ({
  summary,
  nextLabel,
  onContinue,
  loading,
}: {
  summary: SegmentReviewState;
  nextLabel: string;
  onContinue: () => void;
  loading: boolean;
}) => (
  <Card className="p-6">
    <div className="text-center mb-6">
      <p className="text-sm text-gray-500 mb-1">{summary.segmentLabel}</p>
      <p className="text-4xl font-bold text-indigo-600">{summary.percent}%</p>
      <p className="text-sm text-gray-600 mt-1">
        {summary.correct} of {summary.total} correct
      </p>
    </div>
    <div className="grid gap-4 md:grid-cols-2 mb-6">
      <SummaryBulletList title="Strengths" items={summary.strengths} />
      <SummaryBulletList title="Focus Next" items={summary.focusNext} />
    </div>
    <div className="flex justify-end">
      <Button onClick={onContinue} disabled={loading}>
        {loading ? "Please wait..." : summary.isFinal ? "Finish session" : `Continue to ${nextLabel}`}
      </Button>
    </div>
  </Card>
);

const SessionSummaryCard = ({
  summary,
  onBackToDashboard,
  onContinue,
  continueLabel,
  loading,
}: {
  summary: any;
  onBackToDashboard: () => void;
  onContinue: () => void;
  continueLabel: string;
  loading: boolean;
}) => (
  <div className="space-y-6">
    <div className="text-center">
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">Session Complete</h2>
      <p className="text-4xl font-bold text-indigo-600">{summary?.scorePercent ?? 0}%</p>
      {summary?.trend && (
        <p className="text-sm text-gray-500 mt-1">
          Trend: {summary.trend === "up" ? "Improving" : summary.trend === "down" ? "Needs attention" : "Steady"}
        </p>
      )}
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <SummaryBulletList title="Strengths" items={summary?.strengths ?? []} />
      <SummaryBulletList title="Focus Next" items={summary?.focusNext ?? []} />
    </div>
    <div className="flex flex-wrap gap-3">
      <Button onClick={onBackToDashboard} variant="outline">
        Back to plan
      </Button>
      <Button onClick={onContinue} disabled={loading}>
        {loading ? "Preparing..." : continueLabel}
      </Button>
    </div>
  </div>
);

// Page shell component for consistent layout
const PageShell = ({ children, timerDisplay }: { children: React.ReactNode; timerDisplay?: React.ReactNode }) => (
  <ProtectedRoute>
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <WouterLink href="/dashboard" className="flex items-center text-gray-600 hover:text-gray-900">
              <ChevronLeft className="h-5 w-5 mr-2" />
              Back to Dashboard
            </WouterLink>
            {timerDisplay}
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </div>
    </div>
  </ProtectedRoute>
);

// Loading spinner component
const Spinner = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
    <p className="text-gray-600">{label}</p>
  </div>
);

// Error panel component
const ErrorPanel = ({ message }: { message: string }) => (
  <div className="text-center py-12">
    <p className="text-red-600 mb-4">{message}</p>
    <Button onClick={() => window.location.reload()} variant="outline">
      Try Again
    </Button>
  </div>
);

// Empty state component
const EmptyState = ({ message }: { message: string }) => (
  <div className="text-center py-12">
    <p className="text-gray-600">{message}</p>
  </div>
);

// Legacy loading component
const LegacyLoading = () => (
  <div className="container mx-auto px-4 py-16">
    <div className="flex flex-col items-center justify-center text-center">
      <div className="animate-spin h-8 w-8 rounded-full border-2 border-gray-300 border-t-transparent mb-4" />
      <h2 className="text-lg font-medium">Loading practice session...</h2>
      <p className="text-sm text-gray-500 mt-1">Fetching task content</p>
    </div>
  </div>
);

// Legacy error component
const LegacyError = ({ title = "Error Loading Content", message = "Failed to load task content.", onRetry }: { 
  title?: string; 
  message?: string; 
  onRetry?: () => void 
}) => (
  <div className="container mx-auto px-4 py-12">
    <div className="max-w-2xl mx-auto border rounded-lg p-6 bg-white">
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <p className="text-gray-600 mb-6">{message}</p>
      <div className="flex gap-3">
        {onRetry && (
          <button className="px-4 py-2 rounded bg-gray-900 text-white" onClick={onRetry}>
            Try Again
          </button>
        )}
        <WouterLink className="px-4 py-2 rounded border" href="/dashboard">Back to Dashboard</WouterLink>
      </div>
    </div>
  </div>
);

// Legacy practice layout component
const LegacyPracticeLayout = ({
  title,
  week,
  day,
  accentLabel,
  audioUrl,
  replayCount,
  questionsBlock,
  timerDisplay,
}: {
  title: string;
  week?: string | number;
  day?: string | number;
  accentLabel?: string;
  audioUrl?: string | null;
  replayCount?: number;
  questionsBlock?: React.ReactNode;
  timerDisplay?: React.ReactNode;
}) => (
  <div className="container mx-auto px-4 py-6">
    {/* Top bar */}
    <div className="flex items-center justify-between mb-6">
      <WouterLink href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
        &larr; Back to Dashboard
      </WouterLink>
      {timerDisplay || <div className="text-sm text-gray-500">Session time: <span>—</span></div>}
    </div>

    {/* Title + chips */}
    <div className="mb-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {week && <span className="px-2 py-0.5 rounded-full bg-gray-100">Week {week}</span>}
        {day && <span className="px-2 py-0.5 rounded-full bg-gray-100">Day {day}</span>}
        <span className="px-2 py-0.5 rounded-full bg-gray-100">listening</span>
      </div>
    </div>

    {/* Audio card */}
    <div className="mb-6 border rounded-lg">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="font-medium">Audio Player</div>
          {accentLabel && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">{accentLabel}</span>}
        </div>
        <p className="text-sm text-gray-600 mt-1">Listen carefully to the audio and answer the questions.</p>
      </div>

      <div className="p-4">
        <div>
          <audio controls preload="metadata" src={audioUrl ?? ""} className="w-full" />
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
          <div>{typeof replayCount === "number" ? `${replayCount} replays remaining` : null}</div>
          <div>{accentLabel ? accentLabel.replace(" Accent", "").toLowerCase() + " accent" : null}</div>
        </div>
      </div>
    </div>

    {/* Questions */}
    <div>{questionsBlock}</div>
  </div>
);

export default function Practice() {
  const [matchProgressRoute, progressParams] = useRoute('/practice/:progressId');
  const [matchLegacyRoute, legacyParams] = useRoute('/practice/:week/:day');
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { preferences, isLoading: onboardingLoading } = useOnboardingStatus();
  
  const DEBUG = true;
  
  // Parse query params on location change
  const search = useMemo(() => (typeof window !== "undefined" ? window.location.search : ""), [location]);
  const qs = useMemo(() => new URLSearchParams(search), [search]);

  const legacyWeekParam = matchLegacyRoute ? legacyParams?.week : undefined;
  const legacyDayParam = matchLegacyRoute ? legacyParams?.day : undefined;
  const progressIdFromRoute = matchProgressRoute ? progressParams?.progressId : undefined;
  const progressIdFromQuery = qs.get("progressId") ?? undefined;
  const urlTaskId = qs.get("taskId") ?? undefined;
  const progressId = progressIdFromRoute ?? progressIdFromQuery ?? urlTaskId ?? undefined;

  // Final task id preference: progressId (primary) -> taskId query (legacy)
  const taskId = progressId || undefined;

  // Explicit query enabling
  const contentEnabled = Boolean(taskId);
  const progressEnabled = Boolean(taskId);

  if (DEBUG) {
    console.log("[PRACTICE][route]", {
      href: typeof window !== "undefined" ? window.location.href : "(ssr)",
      progressId,
      urlTaskId,
      progressIdFromRoute,
      progressIdFromQuery,
      taskId,
    });
  }
  
  // Queries with explicit enabled
  const {
    data: contentData,
    status: contentStatus,
    fetchStatus: contentFetchStatus,
    error: contentError,
  } = useTaskContent(taskId, { enabled: contentEnabled });

  // Extract content and readiness metadata
  const content = contentData?.data;
  const ready = contentData?.ready ?? true;
  const phase = contentData?.phase ?? 'idle';
  const etaSecs = contentData?.etaSecs ?? null;
  const taskSummary = contentData?.taskSummary ?? null;
  const sessionInfo = contentData?.session ?? null;

  const {
    taskProgress: progressRecords,
    isLoading: progressLoading,
    error: progressError,
  } = useTaskProgress(taskId ?? "", { enabled: progressEnabled });
  const activeProgress = Array.isArray(progressRecords) ? progressRecords[0] : undefined;
  const progressMetadata = (activeProgress?.progressData ?? {}) as Record<string, any>;
  const routeDayNumberRaw = legacyDayParam ? Number(legacyDayParam) : undefined;
  const routeDayNumber = Number.isFinite(routeDayNumberRaw) ? routeDayNumberRaw : undefined;
  const resolvedDayNumber = activeProgress?.dayNumber ?? routeDayNumber;
  const progressDayType = typeof progressMetadata?.sessionPrefetch?.dayType === 'string'
    ? progressMetadata.sessionPrefetch.dayType
    : undefined;

  const segments: ListeningSegment[] = Array.isArray(progressMetadata?.segments) ? progressMetadata.segments : [];
  const initialSegmentResults = useMemo(
    () => (Array.isArray(progressMetadata?.segmentResults) ? progressMetadata.segmentResults : []) as SegmentResultRecord[],
    [progressMetadata],
  );
  const [segmentResults, setSegmentResults] = useState<SegmentResultRecord[]>(initialSegmentResults);
  const [segmentReview, setSegmentReview] = useState<SegmentReviewState | null>(null);
  useEffect(() => {
    setSegmentResults(initialSegmentResults);
  }, [initialSegmentResults]);

  const initialAssignments = useMemo(
    () => ((progressMetadata?.segmentAssignments ?? {}) as Record<string, string[]>),
    [progressMetadata],
  );
  const [segmentAssignments, setSegmentAssignments] = useState<Record<string, string[]>>(initialAssignments);
  useEffect(() => {
    setSegmentAssignments(initialAssignments);
  }, [initialAssignments]);

  const [sessionSummary, setSessionSummary] = useState(progressMetadata?.sessionSummary ?? null);
  useEffect(() => {
    setSessionSummary(progressMetadata?.sessionSummary ?? null);
  }, [progressMetadata?.sessionSummary]);

  const completedSegmentIds = useMemo(() => new Set(segmentResults.map((result) => result.segmentId)), [segmentResults]);
  const firstIncompleteIndex = useMemo(() => {
    if (!segments.length) return 0;
    const idx = segments.findIndex((segment) => !completedSegmentIds.has(segment.id));
    return idx === -1 ? segments.length : idx;
  }, [segments, completedSegmentIds]);
  const [segmentIndex, setSegmentIndex] = useState(firstIncompleteIndex);
  useEffect(() => {
    if (segmentReview) {
      return;
    }
    setSegmentIndex((prev) => (prev !== firstIncompleteIndex ? firstIncompleteIndex : prev));
  }, [firstIncompleteIndex, segmentReview]);

  const useLegacyFlow = segments.length === 0;
  const sessionComplete = !useLegacyFlow && (!!sessionSummary || segmentIndex >= segments.length);
  const [submittingSegment, setSubmittingSegment] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const sessionMinutes = useMemo(() => {
    // Priority 1: Use normalized task duration from database
    if (typeof activeProgress?.duration === 'number' && activeProgress.duration > 0) {
      console.log('[SESSION][duration] Using task.durationMinutes:', activeProgress.duration);
      return activeProgress.duration;
    }

    // Priority 2: Fallback to progressData sessionDurationMinutes (legacy)
    const progressMinutes = Number(progressMetadata?.sessionDurationMinutes);
    if (!Number.isNaN(progressMinutes) && progressMinutes > 0) {
      console.log('[SESSION][duration] Using progressData.sessionDurationMinutes:', progressMinutes);
      return progressMinutes;
    }

    // Priority 3: Use weekday/weekend durations from preferences
    const listeningDurations = preferences?.listeningDurations;
    if (listeningDurations) {
      const dayType = determineDayType(resolvedDayNumber, progressDayType);
      const candidate = dayType === 'weekend'
        ? listeningDurations.weekend ?? listeningDurations.weekday
        : listeningDurations.weekday ?? listeningDurations.weekend;
      if (typeof candidate === 'number' && candidate > 0) {
        console.log('[SESSION][duration] Using listeningDurations:', candidate, '(', dayType, ')');
        return candidate;
      }
    }

    // Priority 4: Use general session minutes from preferences
    if (typeof preferences?.sessionMinutes === 'number' && preferences.sessionMinutes > 0) {
      console.log('[SESSION][duration] Using preferences.sessionMinutes:', preferences.sessionMinutes);
      return preferences.sessionMinutes;
    }

    // Priority 5: Fallback to default
    console.log('[SESSION][duration] Using DEFAULT_SESSION_MINUTES:', DEFAULT_SESSION_MINUTES);
    return DEFAULT_SESSION_MINUTES;
  }, [activeProgress?.duration, progressMetadata?.sessionDurationMinutes, preferences?.listeningDurations, preferences?.sessionMinutes, resolvedDayNumber, progressDayType]);

  const totalMs = useMemo(() => Math.max(0, (sessionMinutes ?? 0) * 60 * 1000), [sessionMinutes]);
  
  // Simulate TanStack v5 status patterns for consistency
  const progressStatus = progressLoading ? 'pending' : progressError ? 'error' : 'success';
  const progressFetchStatus = progressLoading ? 'fetching' : 'idle';

  useEffect(() => {
    if (progressStatus === 'success') {
      console.log('[PRACTICE][progress] loaded', {
        progressId: activeProgress?.id ?? progressId,
        records: Array.isArray(progressRecords) ? progressRecords.length : 0,
      });
    }
  }, [activeProgress?.id, progressId, progressRecords, progressStatus]);

  if (DEBUG) {
    console.log("[PRACTICE][query]", {
      taskId,
      contentStatus,
      contentFetchStatus,
      hasContent: Boolean(content?.id),
      progressStatus,
      progressFetchStatus,
      hasProgress: Array.isArray(progressRecords) && progressRecords.length > 0,
    });
  }

  // Derived loading flags (TanStack v5 style)
  const isFetchingContent = contentFetchStatus === "fetching";
  const isFetchingProgress = progressFetchStatus === "fetching";

  // Audio player refs and state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);

  // Questions state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Session tracking and attempt submission
const startMsRef = useRef<number | null>(null);
const [submitting, setSubmitting] = useState(false);
const [results, setResults] = useState<AttemptResponse | null>(null);

// Session timer state
const [timerFrozen, setTimerFrozen] = useState(false);
const [creatingNext, setCreatingNext] = useState(false);
const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
const [sessionStartMs, setSessionStartMs] = useState<number | null>(null);
const seededSessionKeyRef = useRef<string | null>(null);
const currentRemainingMs = typeof countdownRemaining === 'number' ? countdownRemaining : totalMs;
const canStartNextSession = currentRemainingMs >= NEXT_MIN_MS;

  // Firebase auth context
  const { getToken, currentUser } = useFirebaseAuthContext();

  // Session timer logic
  const sessionIdentity = user?.id ?? activeProgress?.userId ?? currentUser?.uid ?? null;
  const ymd = useMemo(() => new Date().toISOString().split('T')[0], []);
  const sessionStartKey = useMemo(() => {
    if (!sessionIdentity || !progressId) {
      return null;
    }
    return SESSION_START_KEY(sessionIdentity, ymd, progressId);
  }, [progressId, sessionIdentity, ymd]);

  const handleCountdownChange = useCallback((next: number) => {
    setCountdownRemaining((prev) => (prev !== next ? next : prev));
  }, []);

  useCountdownTimer({
    progressId: sessionStartKey ?? progressId ?? null,
    totalMs,
    startMs: sessionStartMs,
    paused: timerFrozen,
    onChange: handleCountdownChange,
  });

  useEffect(() => {
    console.log('[PRACTICE] ids', { taskId, progressId });
  }, [progressId, taskId]);

  useEffect(() => {
    if (!sessionStartKey || totalMs <= 0) {
      setSessionStartMs(null);
      if (!sessionStartKey) {
        seededSessionKeyRef.current = null;
      }
      return;
    }

    if (seededSessionKeyRef.current === sessionStartKey && sessionStartMs !== null) {
      return;
    }

    let stored = localStorage.getItem(sessionStartKey);
    if (!stored) {
      stored = String(Date.now());
      localStorage.setItem(sessionStartKey, stored);
    }

    const parsed = Number(stored);
    const validStart = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
    if (!Number.isFinite(parsed) || parsed <= 0) {
      localStorage.setItem(sessionStartKey, String(validStart));
    }

    startMsRef.current = validStart;
    seededSessionKeyRef.current = sessionStartKey;
    setSessionStartMs(validStart);

    const initialRemaining = Math.max(0, totalMs - (Date.now() - validStart));
    setCountdownRemaining((prev) => (prev !== initialRemaining ? initialRemaining : prev));

    console.log('[COUNTDOWN] seed', {
      key: sessionStartKey,
      progressId: activeProgress?.id ?? progressId,
      totalMs,
      startMs: validStart,
    });
  }, [activeProgress?.id, progressId, sessionStartKey, sessionStartMs, totalMs]);

  useEffect(() => {
    if (typeof countdownRemaining === 'number' && countdownRemaining <= 0) {
      setTimerFrozen(true);
    }
  }, [countdownRemaining]);

  // Reset attempt state when switching to a new task
  useEffect(() => {
    if (!taskId) return;

    setAnswers({});
    setCurrentQuestionIndex(0);
    setIsSubmitted(false);
    setResults(null);
    setTimerFrozen(false);
    setSubmitting(false);
    setCreatingNext(false);
    setCountdownRemaining(null);
    startMsRef.current = null;
    setSessionStartMs(null);
    seededSessionKeyRef.current = null;
    setSegmentReview(null);

    const audioEl = audioRef.current;
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [taskId]);

  // Title derivation stays here, single source of truth
  const routeQueryTitle = new URLSearchParams(location.split('?')[1] || '').get('title') ?? undefined;
  const title =
    (content?.scenario && content?.conversationType
      ? `${content.scenario}: ${content.conversationType}`
      : content?.title) ?? routeQueryTitle ?? 'Listening Practice';

  const audioSrc = content?.audioUrl ?? '';
  const questions = Array.isArray(content?.questions) ? content.questions : [];
  const segmentAssignmentMap = useMemo(
    () => deriveSegmentAssignmentsClient(segments, questions, segmentAssignments),
    [segments, questions, segmentAssignments],
  );
  const currentSegment = !useLegacyFlow && segmentIndex < segments.length ? segments[segmentIndex] : null;
  const currentSegmentQuestionIds = currentSegment ? segmentAssignmentMap[currentSegment.id] ?? [] : [];
  const currentAccent =
    currentSegment?.accent ??
    segments[segmentIndex]?.accent ??
    progressMetadata?.accent ??
    progressMetadata?.sessionPrefetch?.accent ??
    content?.accent ??
    activeProgress?.accent ??
    undefined;
  const currentVoiceId =
    currentSegment?.voiceId ??
    segments[segmentIndex]?.voiceId ??
    (Array.isArray(segments) ? segments.find((segment) => segment?.voiceId)?.voiceId : undefined) ??
    undefined;
  const accentBadgeLabel = currentAccent ? `${currentAccent} Accent` : undefined;
  const currentSegmentQuestions = currentSegment ? questions.filter((q) => currentSegmentQuestionIds.includes(q.id)) : questions;
  const activeQuestions = useMemo(
    () => (useLegacyFlow ? questions : currentSegmentQuestions),
    [useLegacyFlow, questions, currentSegmentQuestions],
  );
  useEffect(() => {
    if (currentQuestionIndex >= activeQuestions.length && activeQuestions.length > 0) {
      setCurrentQuestionIndex(0);
    }
  }, [activeQuestions.length, currentQuestionIndex]);

  // Audio element setup
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    
    const onCanPlay = () => {
      setDuration(el.duration || 0);
    };
    
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime || 0);
    };
    
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    
    const onError = (e: Event) => {
      if (DEBUG) console.error('[Audio] error', e);
      setIsPlaying(false);
    };

    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    
    return () => {
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, []);

  // Audio source management
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    
    if (!audioSrc) {
      el.removeAttribute('src');
      el.load();
      return;
    }
    
    if (el.src !== audioSrc) {
      el.src = audioSrc;
      el.load();
    }
  }, [audioSrc]);

  // Volume control
  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.volume = volume / 100;
    }
  }, [volume]);

  // Play handler with simple retry
  const handlePlay = async () => {
    const el = audioRef.current;
    if (!el || !audioSrc) return;
    
    try {
      await el.play();
    } catch (err) {
      if (DEBUG) console.warn('[Audio] play() failed, retrying shortly', err);
      await new Promise(r => setTimeout(r, 400));
      try { 
        await el.play(); 
      } catch (err2) { 
        if (DEBUG) console.error('[Audio] retry failed', err2);
      }
    }
  };

  const handlePause = () => {
    audioRef.current?.pause();
  };

  const handleSeek = (newTime: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  // Question navigation
  const currentQuestion = activeQuestions[currentQuestionIndex];
  const totalQuestions = activeQuestions.length;
  const isLastQuestion = currentQuestionIndex === Math.max(0, totalQuestions - 1);

  const handleSelectAnswer = (answerId: string) => {
    if (!currentQuestion) return;
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: answerId
    }));
  };

  const handleTextAnswer = (text: string) => {
    if (!currentQuestion) return;
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: text
    }));
  };

  const hasAnswered = useCallback(
    (questionId: string) => {
      const value = answers[questionId];
      if (typeof value === 'string') {
        return value.trim().length > 0;
      }
      return Boolean(value);
    },
    [answers],
  );

  const handleNextQuestion = useCallback(() => {
    setCurrentQuestionIndex((prev) => {
      if (totalQuestions === 0) return 0;
      return Math.min(prev + 1, totalQuestions - 1);
    });
  }, [totalQuestions]);

  const handlePrevQuestion = useCallback(() => {
    setCurrentQuestionIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleLegacySubmit = async () => {
    // Add pinpoint logging to confirm the original source of the SyntaxError
    console.log('[DEBUG submit] about to POST', { taskId, href: window.location.href });

    try {
      if (!taskId || typeof taskId !== 'string') {
        throw new Error(`Invalid taskId: ${String(taskId)}`);
      }
      if (!content?.questions?.length) {
        throw new Error('No questions to submit');
      }
      if (submitting) {
        console.log('[Practice] Already submitting, ignoring duplicate call');
        return;
      }

      setSubmitting(true);
      setIsSubmitted(true);

      const now = Date.now();
      const startedAtMs = startMsRef.current ?? now; // guard against undefined
      const payload = {
        startedAt: new Date(startedAtMs).toISOString(),
        submittedAt: new Date(now).toISOString(),
        durationMs: now - startedAtMs,
        answers: content.questions.map((q: any) => {
          const rawValue = answers[q.id];
          return {
            questionId: String(q.id),
            pickedOptionId: typeof rawValue === 'string' ? rawValue : "",
          };
        }),
      };

      // DEBUG: log the exact URL and payload BEFORE posting
      const attemptPath = `/api/firebase/task-progress/${encodeURIComponent(taskId)}/attempt`;
      console.log('[Practice][submit] path', attemptPath, 'payload', payload);

      const res = await postJsonWithAuth(attemptPath, getToken, payload);

      // If server returns non-JSON HTML/XML, parse() throws a different, clear error
      const ct = res.headers.get('content-type') ?? '';
      console.log('[Practice][submit] status', res.status, 'ct', ct);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Attempt POST failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
      }

      const data: AttemptResponse = await res.json();
      if (!data?.success) {
        throw new Error((data as any)?.message ?? 'Submit failed');
      }

      console.log('[Practice] Attempt submitted successfully:', {
        attemptId: (data as any).attemptId,
        score: data.score
      });

      setResults(data);
      setTimerFrozen(true); // Freeze the timer after submission

      toast({
        title: "Practice Complete!",
        description: `You scored ${data.score.correct} out of ${data.score.total} (${data.score.percent}%)`,
      });
      
      // Log submission with remaining time
      const currentRemainingMs = typeof countdownRemaining === 'number' ? countdownRemaining : totalMs;
      console.log('[SUBMIT][done]', { 
        score: data.score, 
        remainingMs: currentRemainingMs 
      });
      
      // Auto-create next task if enough time remains
      if (currentRemainingMs >= NEXT_MIN_MS && taskId && progressId) {
        try {
          setCreatingNext(true);
          console.log('[NEXT][client:req]', { progressId, taskId, remainingMs: currentRemainingMs });
          
          const nextRes = await postJsonWithAuth('/api/session/next-listening-task', getToken, {
            progressId,
            taskId,
            remainingMs: currentRemainingMs
          });
          
          const nextData = await nextRes.json();
          console.log('[NEXT][client:res]', nextData);
          
          if (nextData.ok) {
            console.log('[NEXT][client:nav]', nextData);
            const nextPath = `/practice/${encodeURIComponent(nextData.progressId)}`;
            setLocation(nextPath);
          } else if (nextData.reason === 'time_exhausted') {
            // Session complete - show in UI
            console.log('[NEXT][client:session_complete]', 'Not enough time for next task');
          }
        } catch (nextErr) {
          console.error('[NEXT][client:error]', nextErr);
          toast({
            title: "Note",
            description: "Couldn't create next practice. Your session is saved.",
          });
        } finally {
          setCreatingNext(false);
        }
      } else {
        console.log('[NEXT][client:session_complete]', 'Session complete or missing IDs');
      }

    } catch (err: any) {
      console.error('[Practice] Submit error:', err);
      toast({
        title: "Submission Error", 
        description: err?.message || String(err) || "Failed to save your answers. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const finalizeSession = useCallback(async () => {
    if (!taskId) return false;
    setFinalizing(true);
    try {
      const response = await postJsonWithAuth(
        `/api/task-progress/${encodeURIComponent(taskId)}/finalize`,
        getToken,
        {},
      );
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message ?? "Unable to finalize session.");
      }
      setSessionSummary({
        scorePercent: data?.scorePercent ?? 0,
        strengths: data?.strengths ?? [],
        focusNext: data?.focusNext ?? [],
        trend: data?.trend ?? "flat",
      });
      setTimerFrozen(true);
      await queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-progress/${taskId}`] });
      return true;
    } catch (error: any) {
      toast({
        title: "Finalize error",
        description: error?.message ?? "Failed to save your session results.",
        variant: "destructive",
      });
      return false;
    } finally {
      setFinalizing(false);
    }
  }, [getToken, taskId, toast]);

  const handleSegmentSubmit = useCallback(async () => {
    if (useLegacyFlow) {
      await handleLegacySubmit();
      return;
    }

    if (!taskId || !currentSegment) {
      toast({
        title: "Missing segment",
        description: "We couldn't find details for this segment.",
        variant: "destructive",
      });
      return;
    }

    const questionIds = currentSegmentQuestionIds;
    if (!questionIds.length) {
      toast({
        title: "Missing questions",
        description: "We couldn't find any questions for this segment.",
        variant: "destructive",
      });
      return;
    }

    const unansweredIds = questionIds.filter((questionId) => !hasAnswered(questionId));
    if (unansweredIds.length) {
      toast({
        title: "Unanswered questions",
        description: `${unansweredIds.length} question${unansweredIds.length > 1 ? "s" : ""} will be marked blank.`,
      });
    }

    setSubmittingSegment(true);
    try {
      const payloadAnswers = questionIds.map((questionId) => {
        const rawValue = answers[questionId];
        return {
          questionId,
          choiceId: typeof rawValue === "string" ? rawValue : "",
        };
      });
      const response = await postJsonWithAuth(
        `/api/task-progress/${encodeURIComponent(taskId)}/segment/${encodeURIComponent(currentSegment.id)}/submit`,
        getToken,
        { answers: payloadAnswers },
      );
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message ?? "Segment submission failed");
      }

      setSegmentResults((prev) => [
        ...prev.filter((result) => result.segmentId !== currentSegment.id),
        {
          segmentId: currentSegment.id,
          correct: data?.correct ?? 0,
          total: data?.total ?? payloadAnswers.length,
          mistakeTags: data?.mistakeTags ?? [],
          tagStats: data?.tagStats ?? {},
          submittedAt: new Date().toISOString(),
        },
      ]);

      if (data?.updatedAssignments) {
        setSegmentAssignments(data.updatedAssignments);
      }

      const nextIndex = typeof data?.nextSegmentIndex === "number" ? data.nextSegmentIndex : segmentIndex + 1;
      const feedback = buildSegmentFeedback(data?.tagStats ?? {}, data?.percent ?? 0);

      setSegmentReview({
        segmentId: currentSegment.id,
        segmentLabel: formatSegmentLabel(currentSegment, segmentIndex),
        correct: data?.correct ?? 0,
        total: data?.total ?? payloadAnswers.length,
        percent: data?.percent ?? 0,
        strengths: feedback.strengths,
        focusNext: feedback.focusNext,
        nextIndex,
        isFinal: nextIndex >= segments.length,
      });

      setIsSubmitted(false);
      setCurrentQuestionIndex(0);
      setAnswers({});
    } catch (error: any) {
      toast({
        title: "Submission error",
        description: error?.message ?? "Failed to submit this segment.",
        variant: "destructive",
      });
    } finally {
      setSubmittingSegment(false);
    }
  }, [
    answers,
    currentSegment,
    currentSegmentQuestionIds,
    finalizeSession,
    getToken,
    handleLegacySubmit,
    hasAnswered,
    segmentIndex,
    segments.length,
    taskId,
    toast,
    useLegacyFlow,
  ]);

  const handleSegmentReviewContinue = useCallback(async () => {
    if (!segmentReview) return;
    const summary = segmentReview;
    if (summary.isFinal) {
      setSegmentIndex(summary.nextIndex);
      const finalized = await finalizeSession();
      if (finalized) {
        setSegmentReview(null);
      }
      return;
    }
    setSegmentIndex(summary.nextIndex);
    setSegmentReview(null);
  }, [segmentReview, finalizeSession]);

  const handleStartNextSession = useCallback(async () => {
    if (!taskId) return;
    if (!canStartNextSession) {
      setLocation("/dashboard");
      return;
    }

    try {
      setCreatingNext(true);
      const nextRes = await postJsonWithAuth('/api/session/next-listening-task', getToken, {
        progressId: taskId,
        taskId,
        remainingMs: currentRemainingMs,
      });
      const nextData = await nextRes.json();

      if (nextData.ok && nextData.progressId) {
        setLocation(`/practice/${encodeURIComponent(nextData.progressId)}`);
      } else {
        toast({
          title: "Next session unavailable",
          description: nextData?.message ?? "We couldn't prepare the next session yet.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Next session error",
        description: error?.message ?? "Unable to prepare the next session.",
        variant: "destructive",
      });
    } finally {
      setCreatingNext(false);
    }
  }, [canStartNextSession, currentRemainingMs, getToken, setLocation, taskId, toast]);

  const handleBackToDashboard = useCallback(() => {
    setLocation('/dashboard');
  }, [setLocation]);

  const chipWeek = legacyWeekParam ?? (activeProgress?.weekNumber ? String(activeProgress.weekNumber) : undefined);
  const chipDay = legacyDayParam ?? (activeProgress?.dayNumber ? String(activeProgress.dayNumber) : undefined);

  // Missing task id → error (do NOT spin)
  if (!taskId) {
    return <LegacyError title="Missing progress id" message="We couldn't find this session's progress id in the URL." />;
  }

  // Loading gate
  if (isFetchingContent || isFetchingProgress) {
    return <LegacyLoading />;
  }

  // Check if session is not ready and show preparing state
  if (!ready && (phase === 'queued' || phase === 'warming' || phase === 'running')) {
    return (
      <LegacyPracticeLayout
        title={taskSummary?.title ?? 'Preparing Listening Session'}
        week={chipWeek}
        day={chipDay}
        questionsBlock={
          <SessionWarmup
            phase={phase as 'queued' | 'warming' | 'running'}
            etaSecs={etaSecs}
            taskSummary={taskSummary}
            sessionInfo={sessionInfo}
            skillType="listening"
            onRefresh={() => queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-content/${taskId}`] })}
          />
        }
      />
    );
  }

  if (contentStatus === 'error') {
    return (
      <LegacyError
        message={contentError instanceof Error ? contentError.message : 'Unknown error'}
        onRetry={() => queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-content/${taskId}`] })}
      />
    );
  }

  if (contentStatus === 'success' && !content?.id) {
    return (
      <LegacyError
        title="No content available"
        message="This task may still be generating. Try again shortly."
        onRetry={() => queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-content/${taskId}`] })}
      />
    );
  }

  // Prepare questions block for legacy layout
  const legacyQuestionsBlock = questions.length > 0 ? (
    <div>
      <h2 className="text-xl font-semibold mb-4">Question {currentQuestionIndex + 1} of {questions.length}</h2>
      
      {currentQuestion && (
        <div className="mb-6">
          <p className="text-lg mb-4">{currentQuestion.text}</p>
          
          {currentQuestion.type === 'multiple-choice' && currentQuestion.options && (
            <div className="space-y-2">
              {currentQuestion.options.map((option) => (
                <label key={option.id} className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name={`question-${currentQuestion.id}`}
                    value={option.id}
                    checked={answers[currentQuestion.id] === option.id}
                    onChange={() => handleSelectAnswer(option.id)}
                    className="text-blue-600"
                  />
                  <span>{(option as any).label ?? (option as any).text}</span>
                </label>
              ))}
            </div>
          )}
          
          {(currentQuestion.type === 'fill-in-the-gap' || currentQuestion.type === 'fill-in-multiple-gaps') && (
            <input
              type="text"
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => handleTextAnswer(e.target.value)}
              placeholder="Enter your answer..."
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          )}
        </div>
      )}
      
      <div className="flex justify-between items-center">
        <button
          onClick={handlePrevQuestion}
          disabled={currentQuestionIndex === 0}
          className="px-4 py-2 border rounded disabled:opacity-50"
        >
          Previous
        </button>
        
        <div className="flex gap-2">
          {!isLastQuestion ? (
            <button
              onClick={handleNextQuestion}
              className="px-4 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleLegacySubmit}
              disabled={submitting || results !== null}
              className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          )}
        </div>
      </div>
      
      {/* Results Display - render from server response only */}
      {results && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="font-semibold text-green-800 mb-2">Practice Complete!</h3>
          <p className="text-green-700 mb-4">
            You scored {results.score.correct} out of {results.score.total} questions correctly 
            ({results.score.percent}%)
          </p>
          
          {/* Show detailed explanations from server response */}
          {results.detailed && results.detailed.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-medium text-gray-900">Question Review:</h4>
              {results.detailed.map((detail, index) => {
                const question = questions.find(q => String(q.id) === String(detail.questionId));
                const isCorrect = detail.isCorrect;
                
                return (
                  <div key={detail.questionId} className={cn(
                    "p-3 rounded border",
                    isCorrect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                  )}>
                    <div className="flex items-start gap-2">
                      {isCorrect ? (
                        <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                      )}
                      
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          Question {index + 1}: {question?.text}
                        </p>
                        
                        <div className="mt-2 text-sm text-gray-700">
                          <div>Your answer: <span className={cn(
                            "font-medium",
                            isCorrect ? "text-green-700" : "text-red-700"
                          )}>
                            {detail.pickedOptionText || <em>Unanswered</em>}
                          </span></div>
                          
                          {!isCorrect && (
                            <div>Correct answer: <span className="font-medium text-green-700">
                              {detail.correctOptionText || '—'}
                            </span></div>
                          )}
                        </div>
                        
                        {detail.explanation && (
                          <div className="mt-3 p-2 bg-blue-50 border-l-2 border-blue-300 text-sm">
                            <div className="font-medium text-blue-900">Explanation:</div>
                            <div className="text-blue-800 mt-1">{detail.explanation}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          <div className="mt-4 pt-4 border-t border-green-200">
            <button
              onClick={() => window.location.href = "/dashboard"}
              className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 mr-3"
            >
              Back to Dashboard
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    </div>
  ) : (
    <div className="text-center py-8 text-gray-500">
      <p>No questions available for this task.</p>
    </div>
  );

  const renderSegmentQuestion = () => {
    if (!currentQuestion) {
      return <p className="text-gray-500">No questions available for this segment.</p>;
    }

    return (
      <>
        <h2 className="text-xl font-semibold mb-4">Question {currentQuestionIndex + 1} of {totalQuestions}</h2>
        <div className="mb-6">
          <p className="text-lg mb-4">{currentQuestion.text}</p>
          {currentQuestion.type === 'multiple-choice' && currentQuestion.options && (
            <div className="space-y-2">
              {currentQuestion.options.map((option) => (
                <label key={option.id} className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name={`segment-question-${currentQuestion.id}`}
                    value={option.id}
                    checked={answers[currentQuestion.id] === option.id}
                    onChange={() => handleSelectAnswer(option.id)}
                    className="text-blue-600"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          )}
          {(currentQuestion.type === 'fill-in-the-gap' || currentQuestion.type === 'fill-in-multiple-gaps') && (
            <input
              type="text"
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => handleTextAnswer(e.target.value)}
              placeholder="Enter your answer..."
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          )}
        </div>
      </>
    );
  };

  const nextSegmentLabel = segmentReview && !segmentReview.isFinal
    ? formatSegmentLabel(
        segments[segmentReview.nextIndex] ??
          { id: `segment-${segmentReview.nextIndex + 1}`, ieltsPart: segmentReview.nextIndex + 1 },
        segmentReview.nextIndex,
      )
    : "";

  const segmentedQuestionsBlock = !useLegacyFlow ? (
    sessionComplete && sessionSummary ? (
      <SessionSummaryCard
        summary={sessionSummary}
        onBackToDashboard={handleBackToDashboard}
        onContinue={handleStartNextSession}
        continueLabel={canStartNextSession ? "Continue to next audio" : "Finish session"}
        loading={creatingNext}
      />
    ) : segmentReview ? (
      <SegmentResultSummary
        summary={segmentReview}
        nextLabel={nextSegmentLabel}
        onContinue={handleSegmentReviewContinue}
        loading={segmentReview.isFinal ? finalizing : false}
      />
    ) : (
      <div>
        <SegmentStepper segments={segments} currentIndex={segmentIndex} completedIds={completedSegmentIds} />
        <div className="mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {formatSegmentLabel(currentSegment ?? segments[segmentIndex] ?? { id: 'segment', ieltsPart: segmentIndex + 1 }, segmentIndex)}
              </h3>
              <p className="text-sm text-gray-500">Listen and answer the questions for this part.</p>
            </div>
            {(accentBadgeLabel || currentVoiceId) && (
              <div className="flex flex-col items-end gap-1">
                {accentBadgeLabel && (
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-700">
                    {accentBadgeLabel}
                  </span>
                )}
                {currentVoiceId && (
                  <span className="text-[11px] uppercase tracking-wide text-gray-400">{currentVoiceId}</span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="mb-4">
          <audio controls preload="metadata" src={(currentSegment?.audioUrl ?? audioSrc) || ""} className="w-full" />
        </div>
        {renderSegmentQuestion()}
        <div className="flex justify-between items-center mt-4">
          <button
            onClick={handlePrevQuestion}
            disabled={currentQuestionIndex === 0}
            className="px-4 py-2 border rounded disabled:opacity-50"
          >
            Previous
          </button>
          <div className="flex gap-2">
            {!isLastQuestion ? (
              <button
                onClick={handleNextQuestion}
                className="px-4 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
              >
                Next
              </button>
            ) : (
              <Button
                onClick={handleSegmentSubmit}
                disabled={submittingSegment || finalizing}
              >
                {submittingSegment ? "Submitting..." : segmentIndex === segments.length - 1 ? "Finish session" : "Submit segment"}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  ) : null;

  const questionsBlock = useLegacyFlow ? legacyQuestionsBlock : segmentedQuestionsBlock;

  // Timer display component
  const timerDisplay = (
    <div className="flex items-center gap-2 text-sm">
      <Clock className="h-4 w-4 text-gray-500" />
      <span className={cn(
        "font-mono",
        timerFrozen ? "text-gray-400" : currentRemainingMs < 60000 ? "text-red-600" : "text-gray-600"
      )}>
        {msToMMSS(currentRemainingMs)}
      </span>
      {timerFrozen && <span className="text-xs text-gray-400">{currentRemainingMs <= 0 ? 'Session complete' : '(paused)'}</span>}
      {creatingNext && <span className="text-xs text-blue-600">Creating next task...</span>}
    </div>
  );

  return (
    <LegacyPracticeLayout
      title={title}
      week={chipWeek}
      day={chipDay}
      accentLabel={accentBadgeLabel}
      audioUrl={content?.audioUrl ?? null}
      replayCount={typeof content?.replayLimit === "number" ? content.replayLimit : undefined}
      questionsBlock={questionsBlock}
      timerDisplay={timerDisplay}
    />
  );
}
