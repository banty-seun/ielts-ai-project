import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRoute, Link as WouterLink, useLocation } from 'wouter';
import { ChevronLeft, Play, Pause, RotateCcw, Volume2, AlignLeft, CheckCircle, XCircle } from 'lucide-react';
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
import { getFreshWithAuth } from '@/lib/apiClient';

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

// Components for different question types
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

// Page shell component for consistent layout
const PageShell = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <WouterLink href="/" className="flex items-center text-gray-600 hover:text-gray-900">
              <ChevronLeft className="h-5 w-5 mr-2" />
              Back to Dashboard
            </WouterLink>
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
        <a className="px-4 py-2 rounded border" href="/">Back to Dashboard</a>
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
  transcript,
  replayCount,
  onToggleTranscript,
  questionsBlock,
}: {
  title: string;
  week?: string | number;
  day?: string | number;
  accentLabel?: string;
  audioUrl?: string | null;
  transcript?: string | null;
  replayCount?: number;
  onToggleTranscript?: () => void;
  questionsBlock?: React.ReactNode;
}) => (
  <div className="container mx-auto px-4 py-6">
    {/* Top bar */}
    <div className="flex items-center justify-between mb-6">
      <a href="/" className="text-sm text-gray-600 hover:text-gray-900">&larr; Back to Dashboard</a>
      <div className="text-sm text-gray-500">Session time: <span>—</span></div>
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
        <button className="text-sm text-gray-700 underline" onClick={onToggleTranscript}>
          Show transcript
        </button>

        <div className="mt-3">
          <audio controls preload="metadata" src={audioUrl ?? ""} className="w-full" />
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
          <div>{typeof replayCount === "number" ? `${replayCount} replays remaining` : null}</div>
          <div>{accentLabel ? accentLabel.replace(" Accent", "").toLowerCase() + " accent" : null}</div>
        </div>

        {transcript && (
          <div className="mt-4 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">{transcript}</div>
        )}
      </div>
    </div>

    {/* Questions */}
    <div>{questionsBlock}</div>
  </div>
);

export default function Practice() {
  const [, params] = useRoute('/practice/:week/:day');
  const [location] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const DEBUG = true;
  
  // Route params (fallback)
  const routeTaskId = (params as any)?.taskId as string | undefined;

  // Parse query params on location change
  const search = useMemo(() => (typeof window !== "undefined" ? window.location.search : ""), [location]);
  const qs = useMemo(() => new URLSearchParams(search), [search]);

  const progressId = qs.get("progressId") ?? undefined;
  const urlTaskId = qs.get("taskId") ?? undefined;

  // Final task id preference: progressId -> taskId -> route param
  const taskId = progressId || urlTaskId || routeTaskId;

  // Explicit query enabling
  const contentEnabled = Boolean(taskId);
  const progressEnabled = Boolean(taskId);

  if (DEBUG) {
    console.log("[PRACTICE][route]", {
      href: typeof window !== "undefined" ? window.location.href : "(ssr)",
      progressId,
      urlTaskId,
      routeTaskId,
      taskId,
    });
  }
  
  // Queries with explicit enabled
  const {
    data: content,
    status: contentStatus,
    fetchStatus: contentFetchStatus,
    error: contentError,
  } = useTaskContent(taskId, { enabled: contentEnabled });

  const {
    taskProgress: progress,
    isLoading: progressLoading,
    error: progressError,
    startTask,
  } = useTaskProgress(taskId ?? "", { enabled: progressEnabled });
  
  // Simulate TanStack v5 status patterns for consistency
  const progressStatus = progressLoading ? 'pending' : progressError ? 'error' : 'success';
  const progressFetchStatus = progressLoading ? 'fetching' : 'idle';

  if (DEBUG) {
    console.log("[PRACTICE][query]", {
      taskId,
      contentStatus,
      contentFetchStatus,
      hasContent: Boolean(content?.id),
      progressStatus,
      progressFetchStatus,
      hasProgress: Boolean(progress),
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
  const [showTranscript, setShowTranscript] = useState(false);

  // Session tracking and attempt submission
  const sessionStartRef = useRef<number>(Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [scoreSummary, setScoreSummary] = useState<{correct: number; total: number; percent: number} | null>(null);
  const [detailedResults, setDetailedResults] = useState<any[] | null>(null);

  // Firebase auth context
  const { getToken } = useFirebaseAuthContext();

  // Ensure startTask runs once per taskId
  const startedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId || startedRef.current === taskId) return;
    startedRef.current = taskId;
    void startTask({ taskId });
  }, [taskId]);

  // Title derivation stays here, single source of truth
  const routeQueryTitle = new URLSearchParams(location.split('?')[1] || '').get('title') ?? undefined;
  const title =
    (content?.scenario && content?.conversationType
      ? `${content.scenario}: ${content.conversationType}`
      : content?.title) ?? routeQueryTitle ?? 'Listening Practice';

  const transcript = content?.scriptText ?? '';
  const audioSrc = content?.audioUrl ?? '';
  const questions = Array.isArray(content?.questions) ? content.questions : [];

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
  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

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

  const goToNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const goToPreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const isCurrentQuestionAnswered = () => {
    return currentQuestion ? !!answers[currentQuestion.id] : false;
  };

  const areAllQuestionsAnswered = () => {
    return questions.every(q => !!answers[q.id]);
  };

  const handleSubmit = async () => {
    if (!taskId || !questions.length || isSubmitting) return;

    setIsSubmitting(true);
    setIsSubmitted(true);

    try {
      const now = Date.now();
      const payload: AttemptSubmitPayload = {
        startedAt: new Date(sessionStartRef.current).toISOString(),
        submittedAt: new Date(now).toISOString(),
        durationMs: now - sessionStartRef.current,
        answers: questions.map(q => ({
          questionId: q.id,
          pickedOptionId: answers[q.id] ?? null,
          // Optional: add timeMs and replayCountAtAnswer if tracked
        })),
      };

      console.log('[Practice] Submitting attempt:', {
        taskId,
        answersCount: payload.answers.length,
        durationMs: payload.durationMs
      });

      const response = await getFreshWithAuth(
        `/api/firebase/task-progress/${taskId}/attempt`,
        getToken,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();
      
      if (!data?.success) {
        throw new Error(data?.message ?? 'Failed to submit attempt');
      }

      console.log('[Practice] Attempt submitted successfully:', {
        attemptId: data.attemptId,
        score: data.score
      });

      // Store results for UI display
      setScoreSummary(data.score);
      setDetailedResults(data.detailed);
      setShowResults(true);

      toast({
        title: "Practice Complete!",
        description: `You scored ${data.score.correct} out of ${data.score.total} (${data.score.percent}%)`,
      });

    } catch (error: any) {
      console.error('[Practice] Submit error:', error);
      toast({
        title: "Submission Error", 
        description: error.message || "Failed to save your answers. Please try again.",
        variant: "destructive",
      });
      setIsSubmitting(false);
      setIsSubmitted(false);
    }
  };

  const calculateScore = (): number => {
    let score = 0;
    questions.forEach(question => {
      if (answers[question.id] === question.correctAnswer) {
        score++;
      }
    });
    return score;
  };

  // Missing task id → error (do NOT spin)
  if (!taskId) {
    return <LegacyError title="Missing task id" message="We couldn't find this session's task id in the URL." />;
  }

  // Loading gate
  if (isFetchingContent || isFetchingProgress) {
    return <LegacyLoading />;
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
  const questionsBlock = questions.length > 0 ? (
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
          onClick={goToPreviousQuestion}
          disabled={currentQuestionIndex === 0}
          className="px-4 py-2 border rounded disabled:opacity-50"
        >
          Previous
        </button>
        
        <div className="flex gap-2">
          {!isLastQuestion ? (
            <button
              onClick={goToNextQuestion}
              disabled={!isCurrentQuestionAnswered()}
              className="px-4 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!areAllQuestionsAnswered() || isSubmitting}
              className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
          )}
        </div>
      </div>
      
      {/* Results Display */}
      {showResults && scoreSummary && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="font-semibold text-green-800 mb-2">Practice Complete!</h3>
          <p className="text-green-700 mb-4">
            You scored {scoreSummary.correct} out of {scoreSummary.total} questions correctly 
            ({scoreSummary.percent}%)
          </p>
          
          {/* Show detailed explanations */}
          {detailedResults && detailedResults.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-medium text-gray-900">Question Review:</h4>
              {detailedResults.map((result, index) => {
                const question = questions.find(q => q.id === result.questionId);
                const isCorrect = result.isCorrect;
                
                return (
                  <div key={result.questionId} className={cn(
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
                            {result.pickedAnswer || "No answer"}
                          </span></div>
                          
                          {!isCorrect && (
                            <div>Correct answer: <span className="font-medium text-green-700">
                              {result.correctAnswer}
                            </span></div>
                          )}
                        </div>
                        
                        {result.explanation && (
                          <div className="mt-3 p-2 bg-blue-50 border-l-2 border-blue-300 text-sm">
                            <div className="font-medium text-blue-900">Explanation:</div>
                            <div className="text-blue-800 mt-1">{result.explanation}</div>
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
              onClick={() => window.location.href = "/"}
              className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800"
            >
              Back to Dashboard
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

  return (
    <LegacyPracticeLayout
      title={title}
      week={(params as any)?.week}
      day={(params as any)?.day}
      accentLabel={content?.accent ? `${content.accent} Accent` : undefined}
      audioUrl={content?.audioUrl ?? null}
      transcript={showTranscript ? (content?.scriptText ?? null) : null}
      replayCount={typeof content?.replayLimit === "number" ? content.replayLimit : undefined}
      onToggleTranscript={() => setShowTranscript(!showTranscript)}
      questionsBlock={questionsBlock}
    />
  );
}