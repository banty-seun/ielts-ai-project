import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRoute, Link as WouterLink, useLocation } from 'wouter';
import { ChevronLeft, Play, Pause, RotateCcw, Volume2, AlignLeft, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
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
import { getFreshWithAuth, postFreshWithAuth } from '@/lib/apiClient';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_SESSION_MINUTES, NEXT_MIN_MS, SESSION_START_KEY, msToMMSS } from '@shared/constants';
import type { ListeningRendererRoot } from '@shared/listening';
import { SessionWarmup } from '@/components/SessionWarmup';
import { useCountdownTimer } from '@/hooks/useCountdown';
import { findSessionStartKey } from '@/lib/sessionKey';

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
  groupId?: string | null;
  optionOrder?: string[];
}

type ListeningSegment = {
  id: string;
  ieltsPart?: number;
  type?: string;
  title?: string;
  audioUrl?: string | null;
  estimatedDurationSec?: number;
  accent?: string | null;
  voiceId?: string | null;
};

type SegmentResultRecord = {
  segmentId: string;
  correct: number;
  total: number;
  attempted?: number;
  incorrect?: number;
  unanswered?: number;
  accuracy?: number;
  timingSummary?: {
    totalResponseMs?: number | null;
    averageResponseMs?: number | null;
    maxResponseMs?: number | null;
    sectionElapsedMs?: number | null;
  } | null;
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

const buildTopIssuesBySection = (analysis: any) => {
  const weaknessProfile = Array.isArray(analysis?.weakness_profile) ? analysis.weakness_profile : [];
  if (!weaknessProfile.length) return [];

  const severityWeight: Record<string, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  const bySection = new Map<number, {
    sectionNo: number;
    tags: Set<string>;
    minQuestion: number | null;
    maxQuestion: number | null;
    highestSeverity: string;
    confidenceSum: number;
    confidenceCount: number;
  }>();

  weaknessProfile.forEach((entry: any) => {
    const sections = Array.isArray(entry?.affected_sections) ? entry.affected_sections : [];
    const questions = Array.isArray(entry?.evidence_questions) ? entry.evidence_questions : [];
    const minQuestion = questions.length ? Math.min(...questions) : null;
    const maxQuestion = questions.length ? Math.max(...questions) : null;
    const severity = typeof entry?.severity === 'string' ? entry.severity : 'low';
    const confidence = Number(entry?.confidence ?? 0);

    sections.forEach((rawSectionNo: any) => {
      const sectionNo = Number(rawSectionNo);
      if (!Number.isFinite(sectionNo) || sectionNo <= 0) return;
      const existing = bySection.get(sectionNo) ?? {
        sectionNo,
        tags: new Set<string>(),
        minQuestion: null,
        maxQuestion: null,
        highestSeverity: 'low',
        confidenceSum: 0,
        confidenceCount: 0,
      };
      existing.tags.add(String(entry?.tag ?? 'general'));
      if (minQuestion !== null) {
        existing.minQuestion = existing.minQuestion === null ? minQuestion : Math.min(existing.minQuestion, minQuestion);
      }
      if (maxQuestion !== null) {
        existing.maxQuestion = existing.maxQuestion === null ? maxQuestion : Math.max(existing.maxQuestion, maxQuestion);
      }
      if ((severityWeight[severity] ?? 0) > (severityWeight[existing.highestSeverity] ?? 0)) {
        existing.highestSeverity = severity;
      }
      if (Number.isFinite(confidence) && confidence > 0) {
        existing.confidenceSum += confidence;
        existing.confidenceCount += 1;
      }
      bySection.set(sectionNo, existing);
    });
  });

  return [...bySection.values()]
    .sort((a, b) => {
      const severityDelta = (severityWeight[b.highestSeverity] ?? 0) - (severityWeight[a.highestSeverity] ?? 0);
      if (severityDelta !== 0) return severityDelta;
      const aConfidence = a.confidenceCount > 0 ? a.confidenceSum / a.confidenceCount : 0;
      const bConfidence = b.confidenceCount > 0 ? b.confidenceSum / b.confidenceCount : 0;
      if (bConfidence !== aConfidence) return bConfidence - aConfidence;
      return a.sectionNo - b.sectionNo;
    })
    .slice(0, 4)
    .map((item) => ({
      sectionNo: item.sectionNo,
      tags: [...item.tags],
      questionRange:
        item.minQuestion !== null && item.maxQuestion !== null
          ? item.minQuestion === item.maxQuestion
            ? `Q${item.minQuestion}`
            : `Q${item.minQuestion}-Q${item.maxQuestion}`
          : null,
      severity: item.highestSeverity,
      confidence: item.confidenceCount > 0 ? Number((item.confidenceSum / item.confidenceCount).toFixed(2)) : null,
    }));
};

const formatEvidenceQuestionLabel = (questionIds: number[]) => {
  if (!questionIds.length) return "No question references";
  return `Q${questionIds.join(", Q")}`;
};

const buildStrategyEvidenceLinks = (analysis: any) => {
  const strategies = Array.isArray(analysis?.personalized_strategies) ? analysis.personalized_strategies : [];
  return strategies
    .map((strategy: any, strategyIndex: number) => {
      const refs = Array.isArray(strategy?.evidence_refs) ? strategy.evidence_refs : [];
      if (!refs.length) return null;
      const normalizedRefs = refs
        .map((ref: any) => {
          const sectionId = String(ref?.section_id ?? "").trim();
          const partId = Number(ref?.part_id ?? 0);
          const questionIds: number[] = Array.isArray(ref?.question_ids)
            ? ref.question_ids
                .map((questionId: any) => Number(questionId))
                .filter((questionId: number) => Number.isInteger(questionId) && questionId > 0)
            : [];
          const errorTags = Array.isArray(ref?.error_tags)
            ? ref.error_tags.map((tag: any) => String(tag ?? "").trim()).filter(Boolean)
            : [];
          return {
            sectionId,
            partId: Number.isFinite(partId) && partId > 0 ? partId : null,
            questionIds: [...new Set(questionIds)].sort((a, b) => a - b),
            errorTags,
          };
        })
        .filter((ref: { sectionId: string; partId: number | null }) => Boolean(ref.sectionId) && ref.partId !== null);
      if (!normalizedRefs.length) return null;
      return {
        id: `strategy-evidence-${strategyIndex + 1}`,
        title: String(strategy?.title ?? `Strategy ${strategyIndex + 1}`),
        action: String(strategy?.action ?? ""),
        refs: normalizedRefs,
      };
    })
    .filter(Boolean)
    .slice(0, 4) as Array<{
    id: string;
    title: string;
    action: string;
    refs: Array<{
      sectionId: string;
      partId: number | null;
      questionIds: number[];
      errorTags: string[];
    }>;
  }>;
};

const NEXT_STATUS_POLL_BASE_MS = Math.max(
  5000,
  Number((import.meta as any).env?.VITE_LISTENING_NEXT_STATUS_POLL_MS ?? 15000),
);
const NEXT_STATUS_POLL_MAX_MS = Math.max(
  NEXT_STATUS_POLL_BASE_MS,
  Number((import.meta as any).env?.VITE_LISTENING_NEXT_STATUS_POLL_MAX_MS ?? 60000),
);
const STARTUP_STATUS_POLL_BASE_MS = Math.max(
  2000,
  Number((import.meta as any).env?.VITE_LISTENING_STARTUP_POLL_MS ?? 5000),
);
const STARTUP_STATUS_POLL_MAX_MS = Math.max(
  STARTUP_STATUS_POLL_BASE_MS,
  Number((import.meta as any).env?.VITE_LISTENING_STARTUP_POLL_MAX_MS ?? 30000),
);

const friendlyNextPartStatus = (status: NextPartStatus) => {
  switch (status) {
    case "ready":
      return "Next part ready";
    case "warming":
      return "Next part warming";
    case "queued":
      return "Next part queued";
    case "error":
      return "Next part needs retry";
    default:
      return "No next part";
  }
};

type SegmentReviewState = {
  sectionId: string;
  segmentId: string;
  segmentLabel: string;
  attempted: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  total: number;
  percent: number;
  accuracy: number;
  challengeTags: string[];
  questionOutcomes: Array<{
    questionId: string;
    order: number;
    status: "correct" | "incorrect" | "unanswered";
    responseTimeMs?: number | null;
  }>;
  timingSummary?: {
    totalResponseMs?: number | null;
    averageResponseMs?: number | null;
    maxResponseMs?: number | null;
    sectionElapsedMs?: number | null;
  } | null;
  strengths: string[];
  focusNext: string[];
  nextIndex: number;
  isFinal: boolean;
};

type NextPartStatus = "ready" | "warming" | "queued" | "error" | "none";

type NextPartStatusState = {
  status: NextPartStatus;
  phase: string;
  etaSecs: number | null;
  progressId: string | null;
  message: string | null;
  retryCount: number;
  final: boolean;
  transitionTimeoutSecs: number;
  fetchError: boolean;
};

type RuntimeDraftSnapshot = {
  version: number;
  answers?: Record<string, string>;
  questionTelemetry?: Record<string, any>;
  currentQuestionIndex?: number;
  segmentIndex?: number;
  segmentId?: string | null;
  blockId?: string | null;
  questionId?: string | null;
  updatedAt?: string;
};

const buildQuestionBlockLookup = (
  questions: Question[],
  rendererPayload: ListeningRendererRoot | null | undefined,
) => {
  const lookup: Record<string, { blockId: string; blockIndex: number }> = {};
  if (rendererPayload && Array.isArray(rendererPayload.blocks) && rendererPayload.blocks.length > 0) {
    rendererPayload.blocks.forEach((block, blockIndex) => {
      const blockId = String((block as any)?.block_id ?? `block-${blockIndex + 1}`);
      if (Array.isArray((block as any)?.questions)) {
        (block as any).questions.forEach((question: any) => {
          const questionId = String(question?.question_id ?? question?.id ?? '').trim();
          if (!questionId) return;
          lookup[questionId] = { blockId, blockIndex };
        });
      }
    });
  }

  if (Object.keys(lookup).length > 0) {
    return lookup;
  }

  const fallbackOrder = new Map<string, number>();
  questions.forEach((question) => {
    const rawBlockId =
      typeof question.groupId === 'string' && question.groupId.trim().length > 0
        ? question.groupId
        : 'block-1';
    if (!fallbackOrder.has(rawBlockId)) {
      fallbackOrder.set(rawBlockId, fallbackOrder.size);
    }
    lookup[question.id] = {
      blockId: rawBlockId,
      blockIndex: fallbackOrder.get(rawBlockId) ?? 0,
    };
  });

  return lookup;
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

function getOrderedOptions(question: Question): QuestionOption[] {
  if (!Array.isArray(question.options) || !question.options.length) {
    return [];
  }
  if (Array.isArray(question.optionOrder) && question.optionOrder.length) {
    const optionMap = new Map(question.options.map((opt) => [opt.id, opt]));
    const ordered = question.optionOrder
      .map((optionId) => optionMap.get(optionId))
      .filter(Boolean) as QuestionOption[];
    if (ordered.length) {
      return ordered;
    }
  }
  return question.options;
}

function deriveSegmentAssignmentsClient(
  segments: ListeningSegment[],
  questions: Question[],
  serverAssignments: Record<string, string[]>,
): Record<string, string[]> {
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
}

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
        {summary.correct} correct · {summary.incorrect} incorrect · {summary.unanswered} unanswered
      </p>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
      <div className="p-2 rounded border bg-gray-50 text-gray-700">Attempted: {summary.attempted}</div>
      <div className="p-2 rounded border bg-gray-50 text-gray-700">Total: {summary.total}</div>
      <div className="p-2 rounded border bg-gray-50 text-gray-700">Accuracy: {summary.accuracy.toFixed(1)}%</div>
      <div className="p-2 rounded border bg-gray-50 text-gray-700">
        Avg response: {summary.timingSummary?.averageResponseMs ? `${Math.round(summary.timingSummary.averageResponseMs / 1000)}s` : "—"}
      </div>
    </div>
    {summary.challengeTags.length > 0 && (
      <div className="mb-4 flex flex-wrap gap-2">
        {summary.challengeTags.map((tag) => (
          <span key={tag} className="px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs">
            {friendlySegmentTag(tag)}
          </span>
        ))}
      </div>
    )}
    {summary.questionOutcomes.length > 0 && (
      <div className="mb-6">
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Question review</h4>
        <div className="flex flex-wrap gap-2" role="list" aria-label="Per-question status chips">
          {summary.questionOutcomes.map((outcome) => (
            <span
              key={outcome.questionId}
              role="listitem"
              className={cn(
                "px-2 py-1 rounded-full text-xs border",
                outcome.status === "correct" && "bg-green-50 text-green-700 border-green-200",
                outcome.status === "incorrect" && "bg-red-50 text-red-700 border-red-200",
                outcome.status === "unanswered" && "bg-gray-50 text-gray-700 border-gray-300",
              )}
            >
              Q{outcome.order} · {outcome.status}
            </span>
          ))}
        </div>
      </div>
    )}
    <div className="grid gap-4 md:grid-cols-2 mb-6">
      <SummaryBulletList title="Strengths" items={summary.strengths} />
      <SummaryBulletList title="Focus Next" items={summary.focusNext} />
    </div>
    <div className="flex justify-end">
      <Button onClick={onContinue} disabled={loading} aria-label={summary.isFinal ? "Acknowledge section result and finish session" : `Acknowledge section result and continue to ${nextLabel}`}>
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
}) => {
  const trendLabel = summary?.trendImpact ?? summary?.trend ?? null;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Session Complete</h2>
        <p className="text-4xl font-bold text-indigo-600">{summary?.scorePercent ?? 0}%</p>
        {trendLabel && (
          <p className="text-sm text-gray-500 mt-1">
            Trend: {trendLabel === "up" ? "Improving" : trendLabel === "down" ? "Needs attention" : "Steady"}
          </p>
        )}
      </div>
      {(typeof summary?.recommendationAdopted === 'boolean' || summary?.loopBreakMetric) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {typeof summary?.recommendationAdopted === 'boolean' && (
            <span
              className={cn(
                'px-2 py-1 text-xs rounded-full border',
                summary.recommendationAdopted
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-gray-50 text-gray-700 border-gray-300',
              )}
            >
              {summary.recommendationAdopted ? 'Recommendation adopted' : 'Recommendation not yet adopted'}
            </span>
          )}
          {summary?.loopBreakMetric && (
            <span className="px-2 py-1 text-xs rounded-full border bg-amber-50 text-amber-700 border-amber-200">
              Loop break: {String(summary.loopBreakMetric).replaceAll('_', ' ').toLowerCase()}
            </span>
          )}
        </div>
      )}
      {Array.isArray(summary?.topIssuesBySection) && summary.topIssuesBySection.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Issues by Section</CardTitle>
            <CardDescription>Section-specific weakness areas from your latest coach analysis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.topIssuesBySection.map((entry: any) => (
              <div key={`section-issue-${entry.sectionNo}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-sm font-medium text-amber-900">
                  Section {entry.sectionNo}
                  {entry.questionRange ? ` · ${entry.questionRange}` : ''}
                </div>
                <div className="text-xs text-amber-800 mt-1">
                  {Array.isArray(entry.tags) && entry.tags.length
                    ? entry.tags.map((tag: string) => friendlySegmentTag(tag)).join(", ")
                    : "General listening"}
                  {entry.confidence ? ` · ${(entry.confidence * 100).toFixed(0)}% confidence` : ''}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {Array.isArray(summary?.strategyEvidenceLinks) && summary.strategyEvidenceLinks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Evidence Links</CardTitle>
            <CardDescription>Coach recommendations mapped to your exact section/part/question evidence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.strategyEvidenceLinks.map((item: any) => (
              <div key={item.id} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-sm font-medium text-gray-900">{item.title}</div>
                {item.action ? <div className="text-xs text-gray-600 mt-0.5">{item.action}</div> : null}
                <div className="mt-2 space-y-1">
                  {(Array.isArray(item.refs) ? item.refs : []).map((ref: any, refIndex: number) => {
                    const sectionLabel = String(ref?.sectionId ?? "").trim() || "section";
                    const partLabel = Number(ref?.partId ?? 0);
                    const questionIds = Array.isArray(ref?.questionIds) ? ref.questionIds : [];
                    const errorTags = Array.isArray(ref?.errorTags) ? ref.errorTags : [];
                    return (
                      <div key={`${item.id}-ref-${refIndex}`} className="text-xs text-gray-700">
                        <span className="font-medium">
                          {sectionLabel} · P{partLabel}
                        </span>
                        <span className="ml-2">{formatEvidenceQuestionLabel(questionIds)}</span>
                        {errorTags.length > 0 ? (
                          <span className="ml-2 text-amber-700">
                            {errorTags.map((tag: string) => friendlySegmentTag(tag)).join(", ")}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
};

const NextPartStatusBadge = ({ status, phase, etaSecs }: { status: NextPartStatus; phase: string; etaSecs: number | null }) => {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full border text-xs",
        status === "ready" && "bg-green-50 text-green-700 border-green-200",
        (status === "warming" || status === "queued") && "bg-blue-50 text-blue-700 border-blue-200",
        status === "error" && "bg-red-50 text-red-700 border-red-200",
        status === "none" && "bg-gray-50 text-gray-600 border-gray-200",
      )}
      aria-live="polite"
    >
      {friendlyNextPartStatus(status)}
      {(status === "warming" || status === "queued") && etaSecs ? ` (~${etaSecs}s)` : ""}
      {phase && phase !== status ? ` · ${phase}` : ""}
    </span>
  );
};

const TransitionFallbackLoader = ({
  status,
  message,
  timedOut,
  onRetry,
  onExit,
}: {
  status: NextPartStatusState;
  message: string;
  timedOut: boolean;
  onRetry: () => void;
  onExit: () => void;
}) => (
  <Card className="p-6 sm:p-8">
    <div className="text-center">
      <div className="inline-flex h-12 w-12 rounded-full bg-indigo-50 items-center justify-center mb-4">
        <Loader2 className="h-6 w-6 text-indigo-600 animate-spin" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900">Generating next audio...</h3>
      <p role="status" aria-live="polite" className="text-sm text-gray-600 mt-2">{message || status.message || "Preparing the next part."}</p>
      <div className="mt-3">
        <NextPartStatusBadge status={status.status} phase={status.phase} etaSecs={status.etaSecs} />
      </div>
      {timedOut && (
        <p className="text-sm text-amber-700 mt-4">
          This is taking longer than expected. You can retry or safely return to dashboard.
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button
          onClick={onRetry}
          disabled={!timedOut}
          aria-label="Retry next part transition"
          className="min-h-[44px]"
        >
          Retry
        </Button>
        <Button
          onClick={onExit}
          variant="outline"
          aria-label="Exit safely to dashboard"
          className="min-h-[44px]"
        >
          Exit safely
        </Button>
      </div>
    </div>
  </Card>
);

// Page shell component for consistent layout; route-level protection is applied in App
const PageShell = ({ children, timerDisplay }: { children: React.ReactNode; timerDisplay?: React.ReactNode }) => (
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

const StartupEntryFallback = ({
  phase,
  etaSecs,
  taskSummary,
  sessionInfo,
  onRefresh,
}: {
  phase: 'idle' | 'queued' | 'warming' | 'running' | 'error';
  etaSecs?: number | null;
  taskSummary?: {
    id: string;
    title: string;
    activityType?: string;
    scenario?: string;
    sessionMinutes?: number | null;
  } | null;
  sessionInfo?: {
    status: string;
    retryCount: number;
    message: string;
    errorCode?: string | null;
  } | null;
  onRefresh: () => void;
}) => (
  <div className="container mx-auto px-4 py-12">
    <div className="max-w-2xl mx-auto border rounded-lg p-6 bg-white">
      <h2 className="text-xl font-semibold mb-2">Preparing listening session</h2>
      <p className="text-gray-600 mb-4">
        Part 1 is still warming up. You will enter the session once it is ready.
      </p>
      <SessionWarmup
        phase={phase}
        etaSecs={etaSecs}
        taskSummary={taskSummary}
        sessionInfo={sessionInfo}
        skillType="listening"
        onRefresh={onRefresh}
      />
      <div className="mt-4 flex gap-3">
        <button
          className="px-4 py-2 rounded bg-gray-900 text-white min-h-[44px]"
          onClick={onRefresh}
        >
          Retry now
        </button>
        <WouterLink className="px-4 py-2 rounded border min-h-[44px]" href="/dashboard">
          Back to Dashboard
        </WouterLink>
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
          <audio controls preload="metadata" src={audioUrl ?? ""} className="w-full" aria-label="Listening audio player" />
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

  // Queries with explicit enabled
  const {
    data: contentData,
    status: contentStatus,
    fetchStatus: contentFetchStatus,
    error: contentError,
  } = useTaskContent(taskId, { enabled: contentEnabled });

  // Extract content and readiness metadata
  const content = contentData?.data;
  const ready =
    typeof contentData?.ready === 'boolean'
      ? contentData.ready
      : contentStatus === 'success';
  const phase = contentData?.phase ?? 'idle';
  const etaSecs = contentData?.etaSecs ?? null;
  const taskSummary = contentData?.taskSummary ?? null;
  const sessionInfo = contentData?.session ?? null;
  const startupPollAttemptRef = useRef(0);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    if (ready) {
      startupPollAttemptRef.current = 0;
      return;
    }
    if (!(phase === "queued" || phase === "warming" || phase === "running")) {
      return;
    }
    const attempt = startupPollAttemptRef.current;
    const delay = Math.min(
      STARTUP_STATUS_POLL_BASE_MS * Math.max(1, 2 ** attempt),
      STARTUP_STATUS_POLL_MAX_MS,
    );
    const timer = window.setTimeout(() => {
      startupPollAttemptRef.current = Math.min(attempt + 1, 8);
      void queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-content/${taskId}`] });
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase, ready, taskId]);

  const {
    taskProgress: progressRecords,
    isLoading: progressLoading,
    isFetching: progressFetching,
    error: progressError,
  } = useTaskProgress(taskId ?? "", { enabled: progressEnabled });
  const progressLoadLogRef = useRef(false);
  useEffect(() => {
    if (!taskId || !progressEnabled) return;
    if (progressFetching && !progressLoadLogRef.current) {
      progressLoadLogRef.current = true;
    } else if (!progressFetching && progressLoadLogRef.current) {
      progressLoadLogRef.current = false;
    }
  }, [taskId, progressEnabled, progressFetching, progressError]);
  const activeProgress = Array.isArray(progressRecords) ? progressRecords[0] : undefined;
  const progressMetadata = (activeProgress?.progressData ?? {}) as Record<string, any>;
  const routeDayNumberRaw = legacyDayParam ? Number(legacyDayParam) : undefined;
  const routeDayNumber = Number.isFinite(routeDayNumberRaw) ? routeDayNumberRaw : undefined;
  const resolvedDayNumber = activeProgress?.dayNumber ?? routeDayNumber;
  const progressDayType = typeof progressMetadata?.sessionPrefetch?.dayType === 'string'
    ? progressMetadata.sessionPrefetch.dayType
    : undefined;

  const segments: ListeningSegment[] = useMemo(() => {
    const progressSegments = Array.isArray(progressMetadata?.segments) ? progressMetadata.segments : [];
    const manifestAssets = Array.isArray(content?.manifest?.audio_assets) ? content.manifest.audio_assets : [];
    const manifestByPart = new Map<number, any>();
    manifestAssets.forEach((asset: any, index: number) => {
      const part = Number(asset?.segment_no ?? index + 1);
      if (Number.isFinite(part) && part > 0) {
        manifestByPart.set(part, asset);
      }
    });

    if (progressSegments.length > 0) {
      return progressSegments.map((segment: any, index: number) => {
        const part = Number(segment?.ieltsPart ?? segment?.segmentNo ?? index + 1);
        const manifestAsset = manifestByPart.get(part);
        if (!manifestAsset) {
          return segment;
        }
        return {
          ...segment,
          audioUrl: typeof manifestAsset?.url === "string" ? manifestAsset.url : segment?.audioUrl ?? null,
          estimatedDurationSec: Number(manifestAsset?.duration_seconds ?? segment?.estimatedDurationSec ?? 0),
          accent: typeof manifestAsset?.accent === "string" ? manifestAsset.accent : segment?.accent ?? null,
          voiceId: typeof manifestAsset?.voice_id === "string" ? manifestAsset.voice_id : segment?.voiceId ?? null,
        };
      });
    }

    if (!manifestAssets.length) {
      return [];
    }

    return manifestAssets
      .map((asset: any, index: number) => ({
        id: `manifest-segment-${Number(asset?.segment_no ?? index + 1)}`,
        ieltsPart: Number(asset?.segment_no ?? index + 1),
        type: index % 2 === 0 ? "dialogue" : "monologue",
        title: `Part ${Number(asset?.segment_no ?? index + 1)}`,
        audioUrl: typeof asset?.url === "string" ? asset.url : null,
        estimatedDurationSec: Number(asset?.duration_seconds ?? 0),
        accent: typeof asset?.accent === "string" ? asset.accent : null,
        voiceId: typeof asset?.voice_id === "string" ? asset.voice_id : null,
      }))
      .filter((segment: ListeningSegment) => Number(segment.estimatedDurationSec ?? 0) > 0 && Boolean(segment.audioUrl));
  }, [progressMetadata?.segments, content?.manifest?.audio_assets]);
  const initialSegmentResults = useMemo(
    () => (Array.isArray(progressMetadata?.segmentResults) ? progressMetadata.segmentResults : []) as SegmentResultRecord[],
    [progressMetadata?.segmentResults],
  );
  const [segmentResults, setSegmentResults] = useState<SegmentResultRecord[]>(initialSegmentResults);
  const [segmentReview, setSegmentReview] = useState<SegmentReviewState | null>(null);
  const segmentResultsSig = useMemo(() => JSON.stringify(initialSegmentResults), [initialSegmentResults]);
  useEffect(() => {
    setSegmentResults((prev) => {
      const prevSig = JSON.stringify(prev);
      return prevSig === segmentResultsSig ? prev : initialSegmentResults;
    });
  }, [initialSegmentResults, segmentResultsSig]);
  const persistedSectionResults = useMemo(
    () => (Array.isArray(progressMetadata?.sectionResults) ? progressMetadata.sectionResults : []) as Array<Record<string, any>>,
    [progressMetadata?.sectionResults],
  );
  const pendingSectionResult = useMemo(() => {
    const pending = persistedSectionResults
      .filter((result) => !result?.acknowledged)
      .sort((a, b) => {
        const aAt = Date.parse(String(a?.submittedAt ?? 0));
        const bAt = Date.parse(String(b?.submittedAt ?? 0));
        return bAt - aAt;
      });
    return pending[0] ?? null;
  }, [persistedSectionResults]);

  const initialAssignments = useMemo(
    () => ((progressMetadata?.segmentAssignments ?? {}) as Record<string, string[]>),
    [progressMetadata?.segmentAssignments],
  );
  const [segmentAssignments, setSegmentAssignments] = useState<Record<string, string[]>>(initialAssignments);
  const initialAssignmentsSig = useMemo(() => JSON.stringify(initialAssignments), [initialAssignments]);
  useEffect(() => {
    setSegmentAssignments((prev) => {
      const prevSig = JSON.stringify(prev);
      return prevSig === initialAssignmentsSig ? prev : initialAssignments;
    });
  }, [initialAssignments, initialAssignmentsSig]);

  const initialSessionSummary = useMemo(() => {
    const summary = progressMetadata?.sessionSummary ?? null;
    const coachLatest = progressMetadata?.performanceCoach?.latest ?? null;
    const topIssuesBySection = buildTopIssuesBySection(coachLatest);
    if (!summary && !coachLatest) {
      return null;
    }
    return {
      ...(summary ?? {}),
      recommendationAdopted:
        coachLatest?.closed_loop?.recommendation_adopted ??
        undefined,
      trendImpact:
        coachLatest?.closed_loop?.trend_impact ??
        coachLatest?.trend?.direction ??
        null,
      loopBreakMetric:
        coachLatest?.closed_loop?.loop_break_metric ??
        null,
      sourceAnalysisId:
        coachLatest?.closed_loop?.source_analysis_id ??
        null,
      topIssuesBySection,
      strategyEvidenceLinks: buildStrategyEvidenceLinks(coachLatest),
    };
  }, [progressMetadata?.sessionSummary, progressMetadata?.performanceCoach?.latest]);
  const [sessionSummary, setSessionSummary] = useState<any>(initialSessionSummary);
  const sessionSummarySig = useMemo(() => JSON.stringify(initialSessionSummary), [initialSessionSummary]);
  useEffect(() => {
    setSessionSummary((prev: any) => {
      const prevSig = JSON.stringify(prev ?? null);
      return prevSig === sessionSummarySig ? prev : initialSessionSummary;
    });
  }, [initialSessionSummary, sessionSummarySig]);

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
  useEffect(() => {
    if (segmentReview || !pendingSectionResult) {
      return;
    }
    const sectionId = String(pendingSectionResult.sectionId ?? "");
    if (!sectionId) {
      return;
    }
    const pendingIndex = segments.findIndex((segment) => segment.id === sectionId);
    const resolvedCurrentIndex = pendingIndex >= 0 ? pendingIndex : Math.max(0, firstIncompleteIndex - 1);
    const resolvedNextIndex = resolvedCurrentIndex + 1;
    const feedback = buildSegmentFeedback(
      pendingSectionResult.tagStats as Record<string, { correct: number; total: number }> | undefined,
      Number(pendingSectionResult.accuracy ?? pendingSectionResult.percent ?? 0),
    );
    const outcomes = Array.isArray(pendingSectionResult.perQuestion)
      ? pendingSectionResult.perQuestion.map((item: any, idx: number) => ({
          questionId: String(item?.questionId ?? `q${idx + 1}`),
          order: Number(item?.order ?? idx + 1),
          status:
            item?.status === "correct" || item?.status === "incorrect" || item?.status === "unanswered"
              ? item.status
              : "unanswered",
          responseTimeMs: typeof item?.responseTimeMs === "number" ? item.responseTimeMs : null,
        }))
      : [];
    setSegmentReview({
      sectionId,
      segmentId: sectionId,
      segmentLabel: formatSegmentLabel(segments[resolvedCurrentIndex] ?? { id: sectionId, ieltsPart: resolvedCurrentIndex + 1 }, resolvedCurrentIndex),
      attempted: Number(pendingSectionResult.attempted ?? 0),
      correct: Number(pendingSectionResult.correct ?? 0),
      incorrect: Number(pendingSectionResult.incorrect ?? 0),
      unanswered: Number(pendingSectionResult.unanswered ?? 0),
      total: Number(pendingSectionResult.total ?? 0),
      percent: Number(pendingSectionResult.accuracy ?? pendingSectionResult.percent ?? 0),
      accuracy: Number(pendingSectionResult.accuracy ?? pendingSectionResult.percent ?? 0),
      challengeTags: Array.isArray(pendingSectionResult.challengeTags) ? pendingSectionResult.challengeTags : [],
      questionOutcomes: outcomes,
      timingSummary: pendingSectionResult.timingSummary ?? null,
      strengths: feedback.strengths,
      focusNext: feedback.focusNext,
      nextIndex: resolvedNextIndex,
      isFinal: resolvedNextIndex >= segments.length,
    });
  }, [firstIncompleteIndex, pendingSectionResult, segmentReview, segments]);

  const useLegacyFlow = segments.length === 0;
  const sessionComplete = !useLegacyFlow && (!!sessionSummary || segmentIndex >= segments.length);
  const [submittingSegment, setSubmittingSegment] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [nextPartStatus, setNextPartStatus] = useState<NextPartStatusState>({
    status: "queued",
    phase: "queued",
    etaSecs: null,
    progressId: null,
    message: null,
    retryCount: 0,
    final: false,
    transitionTimeoutSecs: 90,
    fetchError: false,
  });
  const [nextStatusErrorCount, setNextStatusErrorCount] = useState(0);
  const [transitionBlocking, setTransitionBlocking] = useState(false);
  const [transitionTimedOut, setTransitionTimedOut] = useState(false);
  const [transitionMessage, setTransitionMessage] = useState("Preparing next part...");

  const sessionMinutes = useMemo(() => {
    // Priority 1: Use normalized task duration from database
    if (typeof activeProgress?.duration === 'number' && activeProgress.duration > 0) {
      return activeProgress.duration;
    }

    // Priority 2: Fallback to progressData sessionDurationMinutes (legacy)
    const progressMinutes = Number(progressMetadata?.sessionDurationMinutes);
    if (!Number.isNaN(progressMinutes) && progressMinutes > 0) {
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
        return candidate;
      }
    }

    // Priority 4: Use general session minutes from preferences
    if (typeof preferences?.sessionMinutes === 'number' && preferences.sessionMinutes > 0) {
      return preferences.sessionMinutes;
    }

    // Priority 5: Fallback to default
    return DEFAULT_SESSION_MINUTES;
  }, [activeProgress?.duration, progressMetadata?.sessionDurationMinutes, preferences?.listeningDurations, preferences?.sessionMinutes, resolvedDayNumber, progressDayType]);

  const totalMs = useMemo(() => Math.max(0, (sessionMinutes ?? 0) * 60 * 1000), [sessionMinutes]);
  
  // Simulate TanStack v5 status patterns for consistency
  const progressStatus = progressLoading ? 'pending' : progressError ? 'error' : 'success';
  const progressFetchStatus = progressLoading ? 'fetching' : 'idle';

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
  const [questionTelemetry, setQuestionTelemetry] = useState<
    Record<
      string,
      {
        firstSeenAt?: number;
        firstAnsweredAt?: number;
        lastAnsweredAt?: number;
        answerChangeCount: number;
        replayCountAtAnswer: number;
      }
    >
  >({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const sectionStartedAtRef = useRef<number>(Date.now());
  const playStartCountRef = useRef(0);

  // Session tracking and attempt submission
const startMsRef = useRef<number | null>(null);
const [submitting, setSubmitting] = useState(false);
const [results, setResults] = useState<AttemptResponse | null>(null);
const pendingRuntimeRestoreRef = useRef<RuntimeDraftSnapshot | null>(null);

// Session timer state
const [timerFrozen, setTimerFrozen] = useState(false);
const [creatingNext, setCreatingNext] = useState(false);
const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
const [sessionStartMs, setSessionStartMs] = useState<number | null>(null);
const [hasSessionStarted, setHasSessionStarted] = useState(false);
const [timeUp, setTimeUp] = useState(false);
const countdownTickLogRef = useRef<number | null>(null);
const nextLogCounterRef = useRef(0);
const pauseLogRef = useRef<string | null>(null);
const segmentFeedbackLogRef = useRef<string | null>(null);
const sessionFeedbackLoggedRef = useRef(false);
const currentRemainingMs = typeof countdownRemaining === 'number' ? countdownRemaining : totalMs;
const canStartNextSession = currentRemainingMs >= NEXT_MIN_MS;
const runtimeDraftKey = useMemo(
  () => (taskId ? `listening:runtime:${taskId}` : null),
  [taskId],
);
const clearRuntimeDraft = useCallback(() => {
  if (!runtimeDraftKey || typeof window === "undefined") return;
  window.localStorage.removeItem(runtimeDraftKey);
}, [runtimeDraftKey]);

  // Firebase auth context
  const { getToken, currentUser } = useFirebaseAuthContext();
  const startupBoostedTaskRef = useRef<string | null>(null);

  useEffect(() => {
    if (!taskId || startupBoostedTaskRef.current === taskId) {
      return;
    }
    startupBoostedTaskRef.current = taskId;
    void postFreshWithAuth(
      "/api/listening/readiness/boost",
      {
        taskProgressId: taskId,
        source: "session_open",
      },
      getToken,
    ).catch(() => undefined);
  }, [getToken, taskId]);

  useEffect(() => {
    if (!taskId || sessionComplete || timeUp) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const pollStatus = async () => {
      try {
        const data = await getFreshWithAuth<any>(
          `/api/session/next-part-status/${encodeURIComponent(taskId)}`,
          getToken,
        );
        if (cancelled) return;
        setNextPartStatus({
          status:
            data?.status === "ready" || data?.status === "warming" || data?.status === "queued" || data?.status === "error" || data?.status === "none"
              ? data.status
              : "queued",
          phase: typeof data?.phase === "string" ? data.phase : "queued",
          etaSecs: typeof data?.etaSecs === "number" ? data.etaSecs : null,
          progressId: typeof data?.progressId === "string" ? data.progressId : null,
          message: typeof data?.message === "string" ? data.message : null,
          retryCount: Number(data?.retryCount ?? 0),
          final: Boolean(data?.final),
          transitionTimeoutSecs:
            typeof data?.transition_timeout_secs === "number" && data.transition_timeout_secs > 0
              ? data.transition_timeout_secs
              : 90,
          fetchError: false,
        });
        setNextStatusErrorCount(0);
      } catch (_error) {
        if (cancelled) return;
        setNextPartStatus((prev) => ({
          ...prev,
          fetchError: true,
          message: "Status unavailable. Retrying...",
        }));
        setNextStatusErrorCount((prev) => prev + 1);
      } finally {
        if (cancelled) return;
        const base = NEXT_STATUS_POLL_BASE_MS;
        const errorCount = Math.max(0, nextStatusErrorCount);
        const delay = Math.min(base * Math.max(1, 2 ** errorCount), NEXT_STATUS_POLL_MAX_MS);
        timerId = window.setTimeout(() => {
          void pollStatus();
        }, delay);
      }
    };

    void pollStatus();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [getToken, nextStatusErrorCount, sessionComplete, taskId, timeUp]);

  // Session timer logic
  const sessionIdentity = user?.id ?? activeProgress?.userId ?? currentUser?.uid ?? null;
const ymd = useMemo(() => new Date().toISOString().split('T')[0], []);
const sessionStartKey = useMemo(() => {
  if (!sessionIdentity || !progressId) {
    return null;
  }
  return SESSION_START_KEY(sessionIdentity, ymd, progressId);
}, [progressId, sessionIdentity, ymd]);

  // Adopt session started from dashboard (do not seed here)
useEffect(() => {
  const identity = user?.id ?? currentUser?.uid ?? null;
  if (!identity || !progressId) return;
  const found = findSessionStartKey(identity, progressId);
  if (found) {
    startMsRef.current = found.startMs;
    setSessionStartMs(found.startMs);
    setHasSessionStarted(true);
    const initialRemaining = Math.max(0, totalMs - (Date.now() - found.startMs));
    setCountdownRemaining((prev) => (prev !== initialRemaining ? initialRemaining : prev));
    if (initialRemaining <= 0) {
      setTimeUp(true);
      setTimerFrozen(true);
    }
  } else {
  }
}, [user?.id, currentUser?.uid, progressId, totalMs]);

  const handleCountdownChange = useCallback((next: number) => {
    setCountdownRemaining((prev) => (prev !== next ? next : prev));
  }, []);

const shouldPauseForFeedback = Boolean(segmentReview || (sessionSummary && !timeUp));
const countdownPauseReason = timeUp
  ? 'time_up'
  : shouldPauseForFeedback
    ? 'feedback'
    : timerFrozen
      ? 'frozen'
      : null;

  const startMsForCountdown = hasSessionStarted ? sessionStartMs : null;
  useEffect(() => {
  }, [progressId, sessionStartKey, sessionStartMs, hasSessionStarted, totalMs, countdownPauseReason, countdownRemaining]);

  useCountdownTimer({
    progressId: sessionStartKey ?? progressId ?? null,
    totalMs,
    startMs: startMsForCountdown,
    paused: Boolean(countdownPauseReason),
    onChange: handleCountdownChange,
  });

useEffect(() => {
  if (typeof countdownRemaining !== "number") {
    return;
  }
  const seconds = Math.floor(countdownRemaining / 1000);
  if (
    countdownTickLogRef.current === null ||
    Math.abs((countdownTickLogRef.current ?? seconds) - seconds) >= 5
  ) {
    countdownTickLogRef.current = seconds;
  }
}, [countdownRemaining]);

useEffect(() => {
}, [progressId, taskId]);

useEffect(() => {
  if (!sessionStartKey) {
    return;
  }

  const stored = localStorage.getItem(sessionStartKey);
  if (!stored) {
    return;
  }

  const parsed = Number(stored);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return;
  }

  startMsRef.current = parsed;
  setSessionStartMs(parsed);
  setHasSessionStarted(true);
  const initialRemaining = Math.max(0, totalMs - (Date.now() - parsed));
  countdownTickLogRef.current = null;
  setCountdownRemaining((prev) => (prev !== initialRemaining ? initialRemaining : prev));
  if (initialRemaining <= 0) {
    setTimeUp(true);
    setTimerFrozen(true);
  }
}, [
  activeProgress?.id,
  progressId,
  sessionStartKey,
  totalMs,
]);

useEffect(() => {
  if (segmentReview) {
    const key = `${segmentReview.segmentId}:${segmentReview.nextIndex}:${segmentReview.isFinal}`;
    if (segmentFeedbackLogRef.current !== key) {
      segmentFeedbackLogRef.current = key;
    }
    return;
  }
  if (sessionSummary && !sessionFeedbackLoggedRef.current) {
    sessionFeedbackLoggedRef.current = true;
  }
}, [segmentReview, sessionSummary]);

useEffect(() => {
  if (!hasSessionStarted || timeUp) {
    return;
  }
  if (typeof countdownRemaining === 'number' && countdownRemaining <= 0) {
    setTimerFrozen(true);
    setTimeUp(true);
  }
}, [countdownRemaining, hasSessionStarted, timeUp]);

useEffect(() => {
  if (!hasSessionStarted) {
    return;
  }
  if (countdownPauseReason) {
    const marker = `pause:${countdownPauseReason}`;
    if (pauseLogRef.current !== marker) {
      pauseLogRef.current = marker;
    }
  } else if (pauseLogRef.current) {
    pauseLogRef.current = null;
  }
}, [countdownPauseReason, hasSessionStarted]);

useEffect(() => {
  if (timeUp) {
    audioRef.current?.pause();
  }
}, [timeUp]);

  // Reset attempt state when switching to a new task
useEffect(() => {
  if (!taskId) return;

  pendingRuntimeRestoreRef.current = null;
  setAnswers({});
  setQuestionTelemetry({});
  setCurrentQuestionIndex(0);
  setIsSubmitted(false);
  setResults(null);
  setTimerFrozen(false);
  setSubmitting(false);
  setCreatingNext(false);
  setCountdownRemaining(null);
  startMsRef.current = null;
  setTimeUp(false);
  setSegmentReview(null);
  sectionStartedAtRef.current = Date.now();
  playStartCountRef.current = 0;

  const audioEl = audioRef.current;
  if (audioEl) {
    audioEl.pause();
      audioEl.currentTime = 0;
    }

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [taskId]);

useEffect(() => {
  if (!runtimeDraftKey || typeof window === "undefined" || segmentReview || sessionSummary) {
    return;
  }
  try {
    const raw = window.localStorage.getItem(runtimeDraftKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as RuntimeDraftSnapshot;
    pendingRuntimeRestoreRef.current = parsed;
    if (parsed.answers && typeof parsed.answers === "object") {
      setAnswers(parsed.answers);
    }
    if (typeof parsed.segmentIndex === "number" && parsed.segmentIndex >= 0) {
      setSegmentIndex(parsed.segmentIndex);
    }
    if (parsed.questionTelemetry && typeof parsed.questionTelemetry === "object") {
      setQuestionTelemetry(parsed.questionTelemetry);
    }
  } catch (_error) {
    window.localStorage.removeItem(runtimeDraftKey);
  }
}, [runtimeDraftKey, segmentReview, sessionSummary]);

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
  const segmentOrderMap = useMemo(
    () => ((progressMetadata?.segmentOrder ?? {}) as Record<string, string[]>),
    [progressMetadata?.segmentOrder],
  );
  const questionsById = useMemo(() => {
    const map = new Map<string, Question>();
    questions.forEach((q) => map.set(q.id, q));
    return map;
  }, [questions]);
  const currentSegment = !useLegacyFlow && segmentIndex < segments.length ? segments[segmentIndex] : null;
  const currentSegmentQuestionIds = currentSegment ? segmentAssignmentMap[currentSegment.id] ?? [] : [];
  const orderedSegmentQuestionIds = useMemo(() => {
    if (currentSegment?.id) {
      const serverOrder = segmentOrderMap[currentSegment.id];
      if (Array.isArray(serverOrder) && serverOrder.length) {
        return serverOrder;
      }
    }
    return currentSegmentQuestionIds;
  }, [currentSegment?.id, currentSegmentQuestionIds, segmentOrderMap]);
  const currentSegmentQuestions = orderedSegmentQuestionIds
    .map((questionId) => questionsById.get(questionId))
    .filter(Boolean) as Question[];
  const currentAccent =
    currentSegment?.accent ??
    segments[segmentIndex]?.accent ??
    progressMetadata?.accent ??
    progressMetadata?.sessionPrefetch?.accent ??
    content?.accent ??
    (activeProgress as any)?.accent ??
    undefined;
  const currentVoiceId =
    currentSegment?.voiceId ??
    segments[segmentIndex]?.voiceId ??
    (Array.isArray(segments) ? segments.find((segment) => segment?.voiceId)?.voiceId : undefined) ??
    undefined;
  const accentBadgeLabel = currentAccent ? `${currentAccent} Accent` : undefined;
  const activeQuestions = useMemo(
    () => (useLegacyFlow ? questions : currentSegmentQuestions),
    [useLegacyFlow, questions, currentSegmentQuestions],
  );
  const rendererPayload = (content?.rendererPayload ?? null) as ListeningRendererRoot | null;
  const activeQuestionBlockLookup = useMemo(
    () => buildQuestionBlockLookup(activeQuestions, rendererPayload),
    [activeQuestions, rendererPayload],
  );
  const currentQuestion = activeQuestions[currentQuestionIndex];
  const totalQuestions = activeQuestions.length;
  const isLastQuestion = currentQuestionIndex === Math.max(0, totalQuestions - 1);
  const currentQuestionBlock = currentQuestion
    ? activeQuestionBlockLookup[currentQuestion.id] ?? null
    : null;
  useEffect(() => {
    const pending = pendingRuntimeRestoreRef.current;
    if (!pending || segmentReview || sessionSummary) {
      return;
    }

    const hasSegmentId = typeof pending.segmentId === "string" && pending.segmentId.trim().length > 0;
    if (!useLegacyFlow && hasSegmentId) {
      const restoredSegmentIndex = segments.findIndex((segment) => segment.id === pending.segmentId);
      if (restoredSegmentIndex >= 0 && restoredSegmentIndex !== segmentIndex) {
        setSegmentIndex(restoredSegmentIndex);
        return;
      }
    } else if (typeof pending.segmentIndex === "number" && pending.segmentIndex >= 0) {
      const boundedSegmentIndex = Math.min(
        pending.segmentIndex,
        Math.max(0, segments.length - 1),
      );
      if (boundedSegmentIndex !== segmentIndex) {
        setSegmentIndex(boundedSegmentIndex);
        return;
      }
    }

    let restoredQuestionIndex: number | null = null;
    if (typeof pending.questionId === "string" && pending.questionId.trim().length > 0) {
      const questionIndex = activeQuestions.findIndex((question) => question.id === pending.questionId);
      if (questionIndex >= 0) {
        restoredQuestionIndex = questionIndex;
      }
    }
    if (restoredQuestionIndex === null && typeof pending.blockId === "string" && pending.blockId.trim().length > 0) {
      const questionIndex = activeQuestions.findIndex(
        (question) => activeQuestionBlockLookup[question.id]?.blockId === pending.blockId,
      );
      if (questionIndex >= 0) {
        restoredQuestionIndex = questionIndex;
      }
    }
    if (restoredQuestionIndex === null && typeof pending.currentQuestionIndex === "number" && pending.currentQuestionIndex >= 0) {
      restoredQuestionIndex = Math.min(
        pending.currentQuestionIndex,
        Math.max(0, activeQuestions.length - 1),
      );
    }

    if (restoredQuestionIndex !== null && restoredQuestionIndex !== currentQuestionIndex) {
      setCurrentQuestionIndex(restoredQuestionIndex);
      return;
    }

    pendingRuntimeRestoreRef.current = null;
  }, [
    activeQuestionBlockLookup,
    activeQuestions,
    currentQuestionIndex,
    segmentIndex,
    segmentReview,
    segments,
    sessionSummary,
    useLegacyFlow,
  ]);
  useEffect(() => {
    if (currentQuestionIndex >= activeQuestions.length && activeQuestions.length > 0) {
      setCurrentQuestionIndex(0);
    }
  }, [activeQuestions.length, currentQuestionIndex]);
  useEffect(() => {
    if (!runtimeDraftKey || typeof window === "undefined") return;
    if (sessionSummary || segmentReview || transitionBlocking) return;
    const snapshot: RuntimeDraftSnapshot = {
      version: 2,
      answers,
      questionTelemetry,
      currentQuestionIndex,
      segmentIndex,
      segmentId: currentSegment?.id ?? null,
      blockId: currentQuestionBlock?.blockId ?? null,
      questionId: currentQuestion?.id ?? null,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(runtimeDraftKey, JSON.stringify(snapshot));
  }, [
    answers,
    currentQuestion?.id,
    currentQuestionBlock?.blockId,
    currentQuestionIndex,
    currentSegment?.id,
    questionTelemetry,
    runtimeDraftKey,
    segmentIndex,
    segmentReview,
    sessionSummary,
    transitionBlocking,
  ]);

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
    
    const onPlay = () => {
      setIsPlaying(true);
      if ((el.currentTime ?? 0) < 1) {
        playStartCountRef.current += 1;
      }
    };
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
  useEffect(() => {
    if (!currentQuestion?.id) return;
    setQuestionTelemetry((prev) => {
      const existing = prev[currentQuestion.id];
      if (existing?.firstSeenAt) {
        return prev;
      }
      return {
        ...prev,
        [currentQuestion.id]: {
          firstSeenAt: Date.now(),
          answerChangeCount: existing?.answerChangeCount ?? 0,
          replayCountAtAnswer: existing?.replayCountAtAnswer ?? 0,
          firstAnsweredAt: existing?.firstAnsweredAt,
          lastAnsweredAt: existing?.lastAnsweredAt,
        },
      };
    });
  }, [currentQuestion?.id]);
  useEffect(() => {
    nextLogCounterRef.current += 1;
  }, [currentQuestionIndex, segmentIndex, isLastQuestion]);

  const handleSelectAnswer = (answerId: string) => {
    if (!currentQuestion) return;
    setAnswers(prev => {
      const prevValue = prev[currentQuestion.id];
      const now = Date.now();
      setQuestionTelemetry((telemetryPrev) => {
        const current = telemetryPrev[currentQuestion.id] ?? {
          firstSeenAt: now,
          answerChangeCount: 0,
          replayCountAtAnswer: 0,
        };
        return {
          ...telemetryPrev,
          [currentQuestion.id]: {
            ...current,
            firstAnsweredAt: current.firstAnsweredAt ?? now,
            lastAnsweredAt: now,
            answerChangeCount:
              typeof prevValue === "string" && prevValue !== answerId
                ? current.answerChangeCount + 1
                : current.answerChangeCount,
            replayCountAtAnswer: Math.max(0, playStartCountRef.current - 1),
          },
        };
      });
      return {
        ...prev,
        [currentQuestion.id]: answerId,
      };
    });
  };

  const handleTextAnswer = (text: string) => {
    if (!currentQuestion) return;
    setAnswers(prev => {
      const prevValue = prev[currentQuestion.id];
      const now = Date.now();
      setQuestionTelemetry((telemetryPrev) => {
        const current = telemetryPrev[currentQuestion.id] ?? {
          firstSeenAt: now,
          answerChangeCount: 0,
          replayCountAtAnswer: 0,
        };
        return {
          ...telemetryPrev,
          [currentQuestion.id]: {
            ...current,
            firstAnsweredAt: current.firstAnsweredAt ?? now,
            lastAnsweredAt: now,
            answerChangeCount:
              typeof prevValue === "string" && prevValue !== text
                ? current.answerChangeCount + 1
                : current.answerChangeCount,
            replayCountAtAnswer: Math.max(0, playStartCountRef.current - 1),
          },
        };
      });
      return {
        ...prev,
        [currentQuestion.id]: text,
      };
    });
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
    // Only block if unanswered
    const unanswered = (content?.questions ?? []).filter((q: any) => !answers[q.id]);
    if (unanswered.length) {
      toast({
        title: "Answer all questions",
        description: "Please answer each question before submitting.",
        variant: "destructive",
      });
      return;
    }
    try {
      if (!taskId || typeof taskId !== 'string') {
        throw new Error(`Invalid taskId: ${String(taskId)}`);
      }
      if (!content?.questions?.length) {
        throw new Error('No questions to submit');
      }
      if (submitting) {
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
          const telemetry = questionTelemetry[String(q.id)] ?? {};
          const responseTimeMs =
            typeof telemetry.firstSeenAt === "number" && typeof telemetry.lastAnsweredAt === "number"
              ? Math.max(0, telemetry.lastAnsweredAt - telemetry.firstSeenAt)
              : typeof telemetry.firstSeenAt === "number"
                ? Math.max(0, Date.now() - telemetry.firstSeenAt)
                : undefined;
          const unanswered = !(typeof rawValue === "string" && rawValue.trim().length > 0);
          return {
            questionId: String(q.id),
            pickedOptionId: typeof rawValue === 'string' ? rawValue : "",
            timeMs: responseTimeMs,
            replayCountAtAnswer: telemetry.replayCountAtAnswer ?? 0,
            answerChangeCount: telemetry.answerChangeCount ?? 0,
            unanswered,
          };
        }),
      };

      const attemptPath = `/api/firebase/task-progress/${encodeURIComponent(taskId)}/attempt`;

      const data = await postFreshWithAuth<AttemptResponse>(attemptPath, payload, getToken);
      if (!data?.success) {
        throw new Error((data as any)?.message ?? 'Submit failed');
      }

      setResults(data);
      setTimerFrozen(true); // Freeze the timer after submission

      toast({
        title: "Practice Complete!",
        description: `You scored ${data.score.correct} out of ${data.score.total} (${data.score.percent}%)`,
      });
      const currentRemainingMs = typeof countdownRemaining === 'number' ? countdownRemaining : totalMs;

      // Auto-create next task if enough time remains
      if (currentRemainingMs >= NEXT_MIN_MS && taskId && progressId) {
        try {
          setCreatingNext(true);
          
          const nextData = await postFreshWithAuth<any>('/api/session/next-listening-task', {
            progressId,
            taskId,
            remainingMs: currentRemainingMs
          }, getToken);
          
          if (nextData.ok) {
            const nextPath = `/practice/${encodeURIComponent(nextData.progressId)}`;
            setLocation(nextPath);
          } else if (nextData.reason === 'time_exhausted') {
            // Session complete - show in UI
          }
        } catch (nextErr) {
          toast({
            title: "Note",
            description: "Couldn't create next practice. Your session is saved.",
          });
        } finally {
          setCreatingNext(false);
        }
      } else {
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
      const rendererMode = content?.contractMode === 'dual' ? 'dual' : 'legacy';
      const data = await postFreshWithAuth<any>(
        `/api/task-progress/${encodeURIComponent(taskId)}/finalize`,
        { rendererMode },
        getToken,
      );
      if (data?.success === false) {
        throw new Error(data?.message ?? "Unable to finalize session.");
      }
      setSessionSummary({
        scorePercent: data?.scorePercent ?? 0,
        strengths: data?.strengths ?? [],
        focusNext: data?.focusNext ?? [],
        trend: data?.trend ?? "flat",
        recommendationAdopted: data?.performanceCoach?.closed_loop?.recommendation_adopted ?? undefined,
        trendImpact:
          data?.performanceCoach?.closed_loop?.trend_impact ??
          data?.performanceCoach?.trend?.direction ??
          null,
        loopBreakMetric: data?.performanceCoach?.closed_loop?.loop_break_metric ?? null,
        sourceAnalysisId: data?.performanceCoach?.closed_loop?.source_analysis_id ?? null,
        topIssuesBySection: buildTopIssuesBySection(data?.performanceCoach ?? null),
        strategyEvidenceLinks: buildStrategyEvidenceLinks(data?.performanceCoach ?? null),
      });
      setTimerFrozen(true);
      clearRuntimeDraft();
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
  }, [clearRuntimeDraft, content?.contractMode, getToken, taskId, toast]);

  const handleSegmentSubmit = useCallback(async () => {
    if (!hasSessionStarted) {
      toast({
        title: "Start required",
        description: "Start the listening session before submitting a segment.",
      });
      return;
    }
    if (timeUp) {
      toast({
        title: "Time is up",
        description: "Finish the session to review your results.",
      });
      return;
    }
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
      const sectionElapsedMs = Math.max(0, Date.now() - sectionStartedAtRef.current);
      const payloadAnswers = questionIds.map((questionId) => {
        const rawValue = answers[questionId];
        const telemetry = questionTelemetry[questionId] ?? {};
        const responseTimeMs =
          typeof telemetry.firstSeenAt === "number" && typeof telemetry.lastAnsweredAt === "number"
            ? Math.max(0, telemetry.lastAnsweredAt - telemetry.firstSeenAt)
            : typeof telemetry.firstSeenAt === "number"
              ? Math.max(0, Date.now() - telemetry.firstSeenAt)
              : null;
        return {
          questionId,
          choiceId: typeof rawValue === "string" ? rawValue : "",
          responseTimeMs,
          answerChangeCount: telemetry.answerChangeCount ?? 0,
          replayCount: telemetry.replayCountAtAnswer ?? 0,
        };
      });
      const data = await postFreshWithAuth<any>(
        `/api/task-progress/${encodeURIComponent(taskId)}/segment/${encodeURIComponent(currentSegment.id)}/submit`,
        { answers: payloadAnswers, sectionElapsedMs },
        getToken,
      );
      if (data?.success === false) {
        throw new Error(data?.message ?? "Segment submission failed");
      }

      setSegmentResults((prev) => [
        ...prev.filter((result) => result.segmentId !== currentSegment.id),
        {
          segmentId: currentSegment.id,
          attempted: data?.attempted ?? payloadAnswers.filter((answer) => String(answer.choiceId ?? "").trim().length > 0).length,
          correct: data?.correct ?? 0,
          incorrect: data?.incorrect ?? Math.max(0, (data?.attempted ?? payloadAnswers.length) - (data?.correct ?? 0)),
          unanswered: data?.unanswered ?? 0,
          total: data?.total ?? payloadAnswers.length,
          accuracy: data?.accuracy ?? data?.percent ?? 0,
          timingSummary: data?.timingSummary ?? null,
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
        sectionId: String(data?.sectionId ?? currentSegment.id),
        segmentId: currentSegment.id,
        segmentLabel: formatSegmentLabel(currentSegment, segmentIndex),
        attempted: data?.attempted ?? payloadAnswers.filter((answer) => String(answer.choiceId ?? "").trim().length > 0).length,
        correct: data?.correct ?? 0,
        incorrect: data?.incorrect ?? Math.max(0, (data?.attempted ?? payloadAnswers.length) - (data?.correct ?? 0)),
        unanswered: data?.unanswered ?? 0,
        total: data?.total ?? payloadAnswers.length,
        percent: data?.percent ?? 0,
        accuracy: data?.accuracy ?? data?.percent ?? 0,
        challengeTags: Array.isArray(data?.challengeTags) ? data.challengeTags : (data?.mistakeTags ?? []),
        questionOutcomes: Array.isArray(data?.questionOutcomes)
          ? data.questionOutcomes.map((outcome: any, idx: number) => ({
              questionId: String(outcome?.questionId ?? `q${idx + 1}`),
              order: Number(outcome?.order ?? idx + 1),
              status:
                outcome?.status === "correct" || outcome?.status === "incorrect" || outcome?.status === "unanswered"
                  ? outcome.status
                  : "unanswered",
              responseTimeMs: typeof outcome?.responseTimeMs === "number" ? outcome.responseTimeMs : null,
            }))
          : [],
        timingSummary: data?.timingSummary ?? null,
        strengths: feedback.strengths,
        focusNext: feedback.focusNext,
        nextIndex,
        isFinal: nextIndex >= segments.length,
      });

      setIsSubmitted(false);
      setCurrentQuestionIndex(0);
      setAnswers({});
      setQuestionTelemetry({});
      sectionStartedAtRef.current = Date.now();
      playStartCountRef.current = 0;
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
    hasSessionStarted,
    answers,
    questionTelemetry,
    currentSegment,
    currentSegmentQuestionIds,
    finalizeSession,
    getToken,
    handleLegacySubmit,
    hasAnswered,
    timeUp,
    segmentIndex,
    segments.length,
    taskId,
    toast,
    useLegacyFlow,
  ]);

  const handleSegmentReviewContinue = useCallback(async () => {
    if (!segmentReview) return;
    const summary = segmentReview;
    try {
      if (taskId) {
        await postFreshWithAuth(
          `/api/task-progress/${encodeURIComponent(taskId)}/segment/${encodeURIComponent(summary.sectionId)}/acknowledge`,
          {},
          getToken,
        );
      }
    } catch (_error) {
      // Non-blocking: continue flow even if acknowledge call fails.
    }
    if (summary.isFinal) {
      setSegmentIndex(summary.nextIndex);
      const finalized = await finalizeSession();
      if (finalized) {
        setSegmentReview(null);
        clearRuntimeDraft();
      }
      return;
    }
    setSegmentIndex(summary.nextIndex);
    setSegmentReview(null);
  }, [clearRuntimeDraft, finalizeSession, getToken, segmentReview, taskId]);

  const handleFinishDueToTimeout = useCallback(async () => {
    if (!timeUp) return;
    await finalizeSession();
  }, [finalizeSession, timeUp]);

  const runNextSessionTransition = useCallback(async (forceRetry = false) => {
    if (!taskId) return;
    if (!canStartNextSession) {
      clearRuntimeDraft();
      setLocation("/dashboard");
      return;
    }

    const timeoutMs = Math.max(
      30_000,
      Math.min(180_000, (nextPartStatus.transitionTimeoutSecs || 90) * 1000),
    );
    const startedAt = Date.now();
    let attempts = 0;
    let requestedCreation = false;

    try {
      setCreatingNext(true);
      setTransitionBlocking(true);
      setTransitionTimedOut(false);
      setTransitionMessage("Preparing next part...");

      while (Date.now() - startedAt < timeoutMs) {
        attempts += 1;
        let statusData: any = null;
        try {
          statusData = await getFreshWithAuth<any>(
            `/api/session/next-part-status/${encodeURIComponent(taskId)}`,
            getToken,
          );
        } catch (_error) {
          statusData = null;
        }

        if (statusData) {
          setNextPartStatus({
            status:
              statusData?.status === "ready" ||
              statusData?.status === "warming" ||
              statusData?.status === "queued" ||
              statusData?.status === "error" ||
              statusData?.status === "none"
                ? statusData.status
                : "queued",
            phase: typeof statusData?.phase === "string" ? statusData.phase : "queued",
            etaSecs: typeof statusData?.etaSecs === "number" ? statusData.etaSecs : null,
            progressId: typeof statusData?.progressId === "string" ? statusData.progressId : null,
            message: typeof statusData?.message === "string" ? statusData.message : null,
            retryCount: Number(statusData?.retryCount ?? 0),
            final: Boolean(statusData?.final),
            transitionTimeoutSecs:
              typeof statusData?.transition_timeout_secs === "number" && statusData.transition_timeout_secs > 0
                ? statusData.transition_timeout_secs
                : 90,
            fetchError: false,
          });
          setTransitionMessage(
            typeof statusData?.message === "string" && statusData.message.trim().length > 0
              ? statusData.message
              : "Preparing next part...",
          );

          if (statusData?.status === "ready" && typeof statusData?.progressId === "string") {
            clearRuntimeDraft();
            setLocation(`/practice/${encodeURIComponent(statusData.progressId)}`);
            return;
          }
        }

        const shouldRequestCreation =
          !requestedCreation &&
          (forceRetry ||
            statusData?.status === "none" ||
            statusData?.status === "error" ||
            !statusData);

        if (shouldRequestCreation) {
          requestedCreation = true;
          const nextData = await postFreshWithAuth<any>(
            '/api/session/next-listening-task',
            {
              progressId: taskId,
              taskId,
              remainingMs: currentRemainingMs,
            },
            getToken,
          );
          if (nextData.ok && nextData.progressId) {
            clearRuntimeDraft();
            setLocation(`/practice/${encodeURIComponent(nextData.progressId)}`);
            return;
          }
          if (nextData?.reason === "time_exhausted") {
            clearRuntimeDraft();
            setLocation("/dashboard");
            return;
          }
          setTransitionMessage(nextData?.message ?? "Still preparing the next part...");
        } else {
          void postFreshWithAuth(
            "/api/listening/readiness/boost",
            { taskProgressId: taskId, source: "transition_wait" },
            getToken,
          ).catch(() => undefined);
        }

        const delay = Math.min(
          NEXT_STATUS_POLL_BASE_MS * Math.max(1, attempts),
          NEXT_STATUS_POLL_MAX_MS,
        );
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
      setTransitionTimedOut(true);
      setTransitionMessage("This transition is taking longer than expected.");
    } catch (error: any) {
      setTransitionTimedOut(true);
      setTransitionMessage(error?.message ?? "Unable to prepare the next part right now.");
      toast({
        title: "Next session error",
        description: error?.message ?? "Unable to prepare the next session.",
        variant: "destructive",
      });
    } finally {
      setCreatingNext(false);
    }
  }, [
    canStartNextSession,
    clearRuntimeDraft,
    currentRemainingMs,
    getToken,
    nextPartStatus.transitionTimeoutSecs,
    setLocation,
    taskId,
    toast,
  ]);

  const handleStartNextSession = useCallback(async () => {
    await runNextSessionTransition(false);
  }, [runNextSessionTransition]);

  const handleRetryTransition = useCallback(async () => {
    setTransitionTimedOut(false);
    await runNextSessionTransition(true);
  }, [runNextSessionTransition]);

  const handleBackToDashboard = useCallback(() => {
    clearRuntimeDraft();
    setCreatingNext(false);
    setTransitionBlocking(false);
    setLocation('/dashboard');
  }, [clearRuntimeDraft, setLocation]);

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
  if (!ready && (phase === 'queued' || phase === 'warming' || phase === 'running' || phase === 'error')) {
    return (
      <StartupEntryFallback
        phase={phase as 'queued' | 'warming' | 'running' | 'error'}
        etaSecs={etaSecs}
        taskSummary={taskSummary}
        sessionInfo={sessionInfo}
        onRefresh={() => {
          startupPollAttemptRef.current = 0;
          void queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-content/${taskId}`] });
        }}
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
const finishDueToTimeoutBlock = (
  <div className="p-6 text-center bg-white border rounded-lg shadow-sm">
    <h3 className="text-xl font-semibold text-gray-900 mb-2">Session time is up</h3>
    <p className="text-sm text-gray-600 mb-4">
      Your listening session has reached the time limit. Finish to review your results.
    </p>
    <Button
      onClick={handleFinishDueToTimeout}
      disabled={finalizing}
      aria-label="Finish timed out session and show results"
      className="min-h-[44px]"
    >
      {finalizing ? 'Finishing...' : 'Finish & see results'}
    </Button>
  </div>
);

  // Removed gating banner; practice adopts session if available and stays usable otherwise

const legacyQuestionsBlock = timeUp ? (
  finishDueToTimeoutBlock
) : questions.length > 0 ? (
  <div>
    <h2 className="text-xl font-semibold mb-4">Question {currentQuestionIndex + 1} of {questions.length}</h2>
      
      {currentQuestion && (
        <div className="mb-6">
          <p className="text-lg mb-4">{currentQuestion.text}</p>
          
          {currentQuestion.type === 'multiple-choice' && currentQuestion.options && (
            <div className="space-y-2">
              {getOrderedOptions(currentQuestion).map((option) => (
                <label key={option.id} className="flex items-center space-x-3 p-3 min-h-[44px] border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name={`question-${currentQuestion.id}`}
                    value={option.id}
                    checked={answers[currentQuestion.id] === option.id}
                    onChange={() => handleSelectAnswer(option.id)}
                    className="text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={`Select option ${(option as any).label ?? (option as any).text ?? option.id}`}
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
              className="w-full p-3 min-h-[44px] border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              aria-label={`Answer for question ${currentQuestionIndex + 1}`}
            />
          )}
        </div>
      )}
      
        <div className="flex justify-between items-center">
          <button
            onClick={handlePrevQuestion}
            disabled={currentQuestionIndex === 0}
            className="px-4 py-2 min-h-[44px] border rounded disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Go to previous question"
        >
          Previous
        </button>
        
        <div className="flex gap-2">
          {!isLastQuestion ? (
            <button
              onClick={handleNextQuestion}
              className="px-4 py-2 min-h-[44px] rounded bg-gray-900 text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Go to next question"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleLegacySubmit}
              disabled={submitting || results !== null || timeUp}
              className="px-4 py-2 min-h-[44px] rounded bg-green-600 text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Submit answers for this practice"
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
              className="px-4 py-2 min-h-[44px] bg-gray-900 text-white rounded hover:bg-gray-800 mr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Back to dashboard"
            >
              Back to Dashboard
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 min-h-[44px] bg-gray-600 text-white rounded hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Retry this practice"
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
              {getOrderedOptions(currentQuestion).map((option) => (
                <label key={option.id} className="flex items-center space-x-3 p-3 min-h-[44px] border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name={`segment-question-${currentQuestion.id}`}
                    value={option.id}
                    checked={answers[currentQuestion.id] === option.id}
                    onChange={() => handleSelectAnswer(option.id)}
                    className="text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={`Select option ${option.label}`}
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
              className="w-full p-3 min-h-[44px] border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              aria-label={`Answer for section question ${currentQuestionIndex + 1}`}
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
    timeUp ? (
      finishDueToTimeoutBlock
    ) : transitionBlocking ? (
      <TransitionFallbackLoader
        status={nextPartStatus}
        message={transitionMessage}
        timedOut={transitionTimedOut}
        onRetry={handleRetryTransition}
        onExit={handleBackToDashboard}
      />
    ) : sessionComplete && sessionSummary ? (
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
          <audio controls preload="metadata" src={(currentSegment?.audioUrl ?? audioSrc) || ""} className="w-full" aria-label="Current section audio player" />
        </div>
        {renderSegmentQuestion()}
        <div className="flex justify-between items-center mt-4">
          <button
            onClick={handlePrevQuestion}
            disabled={currentQuestionIndex === 0}
            className="px-4 py-2 min-h-[44px] border rounded disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Go to previous section question"
          >
            Previous
          </button>
          <div className="flex gap-2">
            {!isLastQuestion ? (
              <button
                onClick={handleNextQuestion}
                className="px-4 py-2 min-h-[44px] rounded bg-gray-900 text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Go to next section question"
              >
                Next
              </button>
            ) : (
              <Button
                onClick={handleSegmentSubmit}
                disabled={submittingSegment || finalizing}
                aria-label={segmentIndex === segments.length - 1 ? "Finish session" : "Submit section"}
                className="min-h-[44px]"
              >
                {submittingSegment ? "Submitting..." : segmentIndex === segments.length - 1 ? "Finish session" : "Submit segment"}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  ) : null;

  const baseQuestionsBlock = useLegacyFlow ? legacyQuestionsBlock : segmentedQuestionsBlock;
  const questionsBlock = baseQuestionsBlock;

  // Timer display component
  const timerStatusLabel = timeUp
    ? "Session complete"
    : shouldPauseForFeedback || timerFrozen
      ? "(paused)"
      : undefined;
  const timerDisplay = (
    <div className="flex items-center gap-2 text-sm flex-wrap justify-end">
      <Clock className="h-4 w-4 text-gray-500" />
      <span
        aria-live="polite"
        className={cn(
        "font-mono",
        timerFrozen ? "text-gray-400" : currentRemainingMs < 60000 ? "text-red-600" : "text-gray-600"
      )}
      >
        {msToMMSS(currentRemainingMs)}
      </span>
      {timerStatusLabel && (
        <span className="text-xs text-gray-400">
          {timerStatusLabel}
        </span>
      )}
      {creatingNext && <span className="text-xs text-blue-600">Creating next task...</span>}
      {!sessionComplete && (
        <NextPartStatusBadge
          status={nextPartStatus.status}
          phase={nextPartStatus.phase}
          etaSecs={nextPartStatus.etaSecs}
        />
      )}
      {nextPartStatus.fetchError && (
        <span className="text-[11px] text-gray-500">retrying status...</span>
      )}
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
