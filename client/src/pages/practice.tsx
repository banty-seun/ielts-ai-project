import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRoute, Link as WouterLink } from 'wouter';
import { ChevronLeft, Play, Pause, RotateCcw, Volume2, AlignLeft, CheckCircle } from 'lucide-react';
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
import { useTaskProgress } from '@/hooks/useTaskProgress'; // Task progress hook
import { useTaskContent, type TaskContent } from '@/hooks/useTaskContent';
import { createComponentTracker } from '@/lib/firestoreTracker';

// Debug logs moved to useEffect
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { QuotaErrorAlert } from '@/components/QuotaErrorAlert';

// Mock data for the initial implementation
// These will be replaced with actual data from the API
interface QuestionOption {
  id: string;
  text: string;
}

interface BlankOption {
  id: string;
  text: string;
}

// Using inline type validation instead of a separate function

interface Blank {
  id: string;
  options: BlankOption[];
  correctAnswer: string;
}

interface Question {
  id: string;
  text: string;
  type: 'multiple-choice' | 'fill-in-the-gap' | 'fill-in-multiple-gaps';
  options?: QuestionOption[];
  correctAnswer?: string; // For multiple-choice and single fill-in-the-gap
  blanks?: Blank[]; // For fill-in-multiple-gaps
  explanation?: string; // Explanation of the answer for feedback
  hint?: string; // Hint for next time
}

// Component for multiple choice questions
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
                {option.text}
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

// Component for fill-in-the-gap questions
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

// Type guard for multiple gaps questions
interface MultipleGapsQuestion extends Omit<Question, 'type' | 'blanks'> {
  type: 'fill-in-multiple-gaps';
  blanks: Blank[];
}

function isMultipleGapsQuestion(question: Question): question is MultipleGapsQuestion {
  return question.type === 'fill-in-multiple-gaps' && !!question.blanks;
}

// Component for fill-in-multiple-gaps questions
const FillInMultipleGapsQuestion = ({ 
  question, 
  answers, 
  onAnswerChange,
  isSubmitted
}: { 
  question: MultipleGapsQuestion;
  answers: Record<string, string>;
  onAnswerChange: (blankId: string, value: string) => void;
  isSubmitted: boolean;
}) => {
  // Create a map of blanks for easier access
  const blanksMap: { [key: string]: Blank } = {};
  question.blanks.forEach(blank => {
    blanksMap[blank.id] = blank;
  });

  return (
    <div className="my-6">
      <p className="font-medium mb-3">{question.text}</p>
      <div className="space-y-4 mt-2">
        {question.blanks.map((blank) => (
          <div key={blank.id}>
            <p className="text-sm mb-2">{blank.id}:</p>
            <RadioGroup 
              value={answers[blank.id] || ""}
              onValueChange={(value) => !isSubmitted && onAnswerChange(blank.id, value)}
              className="space-y-2"
            >
              {blank.options.map((option) => {
                const isCorrect = isSubmitted && option.id === blank.correctAnswer;
                const isIncorrect = isSubmitted && answers[blank.id] === option.id && option.id !== blank.correctAnswer;

                return (
                  <div key={option.id} className="flex items-center space-x-2">
                    <RadioGroupItem 
                      value={option.id} 
                      id={`${blank.id}-${option.id}`} 
                      disabled={isSubmitted}
                      className={cn(
                        isCorrect && "border-green-500 text-green-500",
                        isIncorrect && "border-red-500 text-red-500"
                      )}
                    />
                    <Label 
                      htmlFor={`${blank.id}-${option.id}`}
                      className={cn(
                        "cursor-pointer",
                        isCorrect && "text-green-500 font-medium",
                        isIncorrect && "text-red-500 font-medium line-through"
                      )}
                    >
                      {option.text}
                    </Label>
                    {isCorrect && (
                      <CheckCircle className="h-4 w-4 text-green-500 ml-2" />
                    )}
                  </div>
                );
              })}
            </RadioGroup>
          </div>
        ))}
      </div>

      {isSubmitted && (
        <div className="mt-4">
          <p className="text-sm font-medium">Answers:</p>
          <ul className="list-disc list-inside pl-2 mt-1 space-y-1 text-sm">
            {question.blanks.map((blank) => {
              const correctOption = blank.options.find(o => o.id === blank.correctAnswer);
              const userOption = blank.options.find(o => o.id === answers[blank.id]);
              const isCorrect = answers[blank.id] === blank.correctAnswer;

              return (
                <li key={blank.id} className={isCorrect ? "text-green-600" : "text-red-600"}>
                  {blank.id}: {userOption ? userOption.text : "No answer"} 
                  {!isCorrect && (
                    <span className="text-green-600"> (Correct: {correctOption?.text})</span>
                  )}
                </li>
              );
            })}
          </ul>

          {question.explanation && (
            <div className="mt-2">
              <p className="text-sm font-medium mb-1">Explanation:</p>
              <p className="text-sm">{question.explanation}</p>
            </div>
          )}

          {question.hint && (
            <div className="mt-2">
              <p className="text-sm font-medium mb-1">Hint for next time:</p>
              <p className="text-sm italic">{question.hint}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Define an interface for our exercise set
interface ExerciseSet {
  id: string;
  title: string;
  accent: 'British' | 'Canadian' | 'American' | 'Australian';
  audioUrl: string;
  audioDuration: number;
  questions: Question[];
}

// Interface for exercise results
interface ExerciseResult {
  exerciseId: string;
  score: number;
  totalQuestions: number;
  completed: boolean;
  timestamp: number;
}

// Function to calculate the total score across exercise history
function calculateTotalScore(history: ExerciseResult[]): { score: number, total: number } {
  return history.reduce((acc, result) => {
    return {
      score: acc.score + result.score,
      total: acc.total + result.totalQuestions
    };
  }, { score: 0, total: 0 });
}

// Main Practice component
// Create a tracker for the Practice component
const practiceTracker = createComponentTracker('Practice');

const Practice = () => {
  // Debug render counter
  const renderCountRef = useRef(0);
  
  // Reference for storing last questions array for efficient comparison
  const lastQuestionsRef = useRef<Question[]>([]);
  
  // Reference to track if we've already fetched task progress data
  const hasFetchedRef = useRef(false);
  
  // Add mount delay pattern to prevent premature hook execution
  const [isMounted, setIsMounted] = useState(false);

  // Use a single useEffect for all diagnostic logs that should only run once
  useEffect(() => {
    console.log('Practice page hooks:', {
      useTaskProgress: typeof useTaskProgress === 'function',
      useTaskContent: typeof useTaskContent === 'function'
    });
    console.log(`[Practice DIAG] Initial isMounted: ${isMounted}`);
    console.log("Practice component mounted");
  }, []);
  
  // Log render count to help debug render loops (already in useEffect)
  useEffect(() => {
    renderCountRef.current += 1;
    console.count('Practice render');
    console.log(`[Practice] Render count: ${renderCountRef.current}, isMounted: ${isMounted}`);

    // Return cleanup function
    return () => {
      console.log('[Practice] unmounted');
    };
  }, []); // Empty dependency array ensures this only runs once on mount

  // Delay setting isMounted to true to allow initial render cycle to complete
  useEffect(() => {
    console.log('[Practice] Component mounted, delaying hook activation');
    const timer = setTimeout(() => {
      setIsMounted(true);
      console.log('[Practice] Component fully activated, isMounted=true');
    }, 50);

    return () => {
      clearTimeout(timer);
      console.log('[Practice] Unmounting practice component');
    };
  }, []);

  // Extract week and day from the route
  const [match, params] = useRoute('/practice/:week/:day');
  const week = params?.week || '1';
  const day = params?.day || '1';
  
  // Use refs to track previous values for comparison
  const prevWeekRef = useRef(week);
  const prevDayRef = useRef(day);

  // Get query parameters
  const searchParams = new URLSearchParams(window.location.search);
  const originalTitle = searchParams.get('title') || 'Listening Practice';
  const skill = searchParams.get('skill') || 'Listening';
  const originalAccent = searchParams.get('accent') || 'British'; // Extract accent from URL or use default
  const progressId = searchParams.get('progressId'); // Extract task progress ID
  const weeklyPlanId = searchParams.get('weeklyPlanId'); // Extract weekly plan ID (distinct from progressId)
  const urlTaskId = searchParams.get('taskId'); // Extract taskId from URL params

  // Create a helper to format task titles consistently
  const formatTaskTitle = (title: string) => {
    // If title already contains a colon, assume it's properly formatted
    if (title.includes(':')) {
      return title;
    }
    
    // For older titles without formatting, create a formatted version
    // Extract scenario and conversation type from the title or create defaults
    if (title.toLowerCase().includes('introduction')) {
      return 'Office Dialogue: Introduction to IELTS Listening';
    } else if (title.toLowerCase().includes('listening practice')) {
      return 'Study Center: Listening Practice Session';
    } else {
      // Use the original title as conversationType with a default scenario
      return `Listening Practice: ${title}`;
    }
  };

  // Get the display title from taskContent or fallback to URL parameter
  const displayTitle = useMemo(() => {
    const title = originalTitle || 'Listening Practice';
    return formatTaskTitle(title);
  }, [originalTitle]);

  // Log routing details for debugging
  console.log('[TASK ROUTING] Practice page route extraction:', {
    url: window.location.href,
    routeParams: { week, day },
    queryParams: {
      title: originalTitle,
      skill,
      accent: originalAccent,
      progressId,
      weeklyPlanId,
      taskId: urlTaskId
    },
    taskIdUsed: progressId || urlTaskId || 'NONE',
    taskIdSource: progressId ? 'progressId' : urlTaskId ? 'taskId' : 'fallback'
  });

  // Update browser tab title with formatted task name
  useEffect(() => {
    document.title = `${displayTitle} - IELTS Practice`;
    
    return () => {
      document.title = 'IELTS Practice Platform';
    };
  }, [displayTitle]);



  // Responsive design hook
  const isMobile = useIsMobile();
  const { toast } = useToast();

  // Firebase auth context for token management
  const { getToken, currentUser, loading: authLoading } = useFirebaseAuthContext();
  const [hasQuotaError, setHasQuotaError] = useState(false);

  // Add state to control when to fetch content
  const [shouldFetchContent, setShouldFetchContent] = useState<boolean>(false);

  // Guard ref needs to be outside the effect to persist across renders
  const hasTriggeredFetchRef = useRef(false);

  // Guard for useTaskContent to prevent it from running until conditions are met
  // DISABLED FOR RENDER LOOP TESTING
  useEffect(() => {
    console.log('[Practice] Content guard effect DISABLED for render loop testing');

    // No-op for render loop testing
    return () => {
      console.log('[Practice] Content guard effect cleanup');
    };
  }, []); // Empty dependency array - only run once on mount

  // FIXED: Always call useTaskContent unconditionally at the top level
  // With memoized options to prevent render loops
  // Memoize task content options to prevent re-renders
  const taskContentId = useMemo(() => {
    const finalId = progressId || urlTaskId || '';
    console.log('[TASK ROUTING] Determining taskContentId:', {
      progressId,
      urlTaskId,
      finalId,
      source: progressId ? 'progressId' : urlTaskId ? 'urlTaskId' : 'empty',
      finalIdLength: finalId.length,
      isValidTaskId: finalId.length > 0 && finalId !== 'undefined'
    });
    return finalId;
  }, [progressId, urlTaskId]);
  
  // Add guard logging at render (use existing getToken from context above)
  console.log('[Practice][useTaskContent guards at render]', { 
    taskContentId, 
    authLoading, 
    isGetTokenValid: typeof getToken === 'function',
    hasUser: !!currentUser,
  });

  const taskQ = useTaskContent(taskContentId);
  const progQ = useTaskProgress(taskContentId);
  
  console.log("[Practice][query states]", {
    taskId: taskContentId,
    taskStatus: taskQ.status,
    taskHasData: !!taskQ.data,
    progStatus: progQ.status,
    progHasData: !!progQ.data
  });

  // Add lightweight polling for audioUrl generation (max 6 tries, 10s each)
  useEffect(() => {
    if (taskQ.status !== "success" || !taskQ.data || taskQ.data.audioUrl) return;
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > 6) return clearInterval(t);
      taskQ.refetch();
    }, 10000);
    return () => clearInterval(t);
  }, [taskQ.status, taskQ.data?.audioUrl]);

  // Track Firebase operations on component mount
  useEffect(() => {
    // Log the component mount for tracking
    practiceTracker.trackRead('practice_views', 1);

    // Add cleanup to log metrics on unmount
    return () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Practice] Component unmounting, logging metrics');
        // Import and use the metrics logging function
        import('@/lib/firestoreTracker').then(({ logFirestoreMetricsSummary }) => {
          logFirestoreMetricsSummary();
        });

        // Also log component render counts for debugging
        console.log("Practice component render count:", 
          // @ts-ignore - Console.countReset exists at runtime
          (console.countReset && typeof console.countReset === 'function') ? 
            "Resetting" : "No reset available");
      }
    };
  }, []);

  // Token refresh management
  useEffect(() => {
    // Skip if we're experiencing quota errors or no user
    if (hasQuotaError || !currentUser) return;

    // Get a fresh token once when the component mounts to ensure we're using
    // a valid token for all API calls
    const refreshToken = async () => {
      try {
        // Get the token without forcing refresh to use cached token if available
        const token = await getToken();
        if (token) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[Practice] Initial token validated successfully');
          }
        } else {
          console.warn('[Practice] Failed to get token');
        }
      } catch (error: any) {
        console.error('[Practice] Error refreshing token:', error);
        // Check if this is a quota error
        const isQuotaError = 
          (typeof error?.code === 'string' && error.code === 'auth/quota-exceeded') || 
          (typeof error?.message === 'string' && (
            error.message.includes('quota') ||
            error.message.includes('unavailable')
          ));

        if (isQuotaError) {
          setHasQuotaError(true);
        }
      }
    };

    refreshToken();
  }, [currentUser, getToken, hasQuotaError]);

  // Refs for tracking task start state
  const hasStartedTaskRef = useRef<boolean>(false);

  // Task progress integration with memoized options to prevent render loops
  // Using useMemo to stabilize the options object
  const taskProgressOptions = useMemo(() => ({
    weeklyPlanId: progressId || '',
    enabled: !!progressId && !hasFetchedRef.current,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retryOnMount: false,
    staleTime: Infinity,
    onSuccess: (data: any) => {
      console.log('[Practice] Task progress loaded once');
      hasFetchedRef.current = true;
    },
    onError: (error: any) => {
      console.error('[Practice] Error loading task progress:', error);
      hasFetchedRef.current = true;
    }
  }), [progressId]);
  
  const { 
    isLoading: isTaskProgressLoading,
    updateTaskStatus,
    startTask, // renamed from markTaskAsInProgress
    completeTask, // renamed from markTaskAsCompleted
    isUpdating: isTaskStatusUpdating,
    taskProgress
  } = useTaskProgress(taskProgressOptions);

  // ORIGINAL CODE WITH CALLBACKS - TEMPORARILY DISABLED TO ISOLATE RENDER LOOP
  /*
  } = useTaskProgress({
    weeklyPlanId: weeklyPlanId || (progressId ? progressId : ''), 
    onSuccess: (data) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Practice] Task progress updated successfully', data);
      }
    },
    onError: (error) => {
      console.error('[Practice] Error updating task progress:', error);

      // Check if it's a quota error
      const isQuotaError = 
        (typeof error?.code === 'string' && error.code === 'auth/quota-exceeded') || 
        (typeof error?.message === 'string' && (
          error.message.includes('quota') ||
          error.message.includes('unavailable')
        ));

      if (isQuotaError) {
        setHasQuotaError(true);
      }

      toast({
        title: 'Error',
        description: isQuotaError 
          ? 'API usage limit reached. Please try again in a few minutes.'
          : 'Failed to update your task progress.',
        variant: 'destructive'
      });
    }
  });
  */

  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [replaysRemaining, setReplaysRemaining] = useState(2); // For the replay limiter feature
  const audioRef = useRef<HTMLAudioElement | null>(null); // Reference to the audio element
  const prevVolumeRef = useRef<number>(0); // Reference to track previous volume value

  // Session timer state (for overall practice duration from user preferences)
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(30); // Default 30 minutes
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState(sessionDurationMinutes * 60); // Convert to seconds
  const [sessionTimerActive, setSessionTimerActive] = useState(true);
  const [sessionComplete, setSessionComplete] = useState(false);

  // Exercise timer state (for individual exercise)
  const [exerciseTimeRemaining, setExerciseTimeRemaining] = useState(120); // 2 minutes in seconds
  const [exerciseTimerActive, setExerciseTimerActive] = useState(false);
  const [exerciseTimerExpired, setExerciseTimerExpired] = useState(false);

  // Questions navigation state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Questions and answers state - now driven by dynamic taskContent
  const [questions, setQuestions] = useState<Question[]>([]);

  // Audio URL from task content only
  const audioUrl = useMemo(() => {
    return taskQ.data?.audioUrl || '';
  }, [taskQ.data?.audioUrl]);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [multiGapAnswers, setMultiGapAnswers] = useState<Record<string, Record<string, string>>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showCompletionSummary, setShowCompletionSummary] = useState(false);

  // Current question for single question navigation
  const currentQuestion = questions[currentQuestionIndex];

  // Helper for determining if user is on last question
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  // Handle answer changes for multiple choice and fill-in-the-gap questions
  const handleSelectAnswer = (questionId: string, answerId: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answerId
    }));
  };

  const handleTextAnswer = (questionId: string, text: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: text
    }));
  };

  // Handle answer changes for fill-in-multiple-gaps questions
  const handleMultiGapAnswer = (questionId: string, blankId: string, value: string) => {
    setMultiGapAnswers(prev => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] || {}),
        [blankId]: value
      }
    }));
  };

  // Question navigation
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

  // Check if current question is answered
  const isCurrentQuestionAnswered = () => {
    if (!currentQuestion) return false;

    if (isMultipleGapsQuestion(currentQuestion)) {
      if (!multiGapAnswers[currentQuestion.id]) return false;
      return currentQuestion.blanks.every(blank => 
        multiGapAnswers[currentQuestion.id][blank.id]
      );
    }

    return !!answers[currentQuestion.id];
  };

  // Check if all questions are answered
  const areAllQuestionsAnswered = () => {
    return questions.every(q => {
      if (isMultipleGapsQuestion(q)) {
        if (!multiGapAnswers[q.id]) return false;
        return q.blanks.every(blank => multiGapAnswers[q.id][blank.id]);
      }
      return !!answers[q.id];
    });
  };

  // Calculate the score for the current session
  const calculateScore = (): number => {
    let score = 0;

    questions.forEach(question => {
      if (isMultipleGapsQuestion(question)) {
        if (multiGapAnswers[question.id]) {
          const allBlanksCorrect = question.blanks.every(blank => 
            multiGapAnswers[question.id][blank.id] === blank.correctAnswer
          );
          if (allBlanksCorrect) score++;
        }
      } else {
        if (answers[question.id] === question.correctAnswer) {
          score++;
        }
      }
    });

    return score;
  };

  // Handle submission
  const handleSubmit = () => {
    if (!isSubmitted) {
      setIsSubmitted(true);
    }
    
    if (exerciseTimerActive) {
      setExerciseTimerActive(false);
    }

    // Calculate score
    const score = calculateScore();

    // Generate feedback
    const newFeedback = `You scored ${score} out of ${questions.length} questions correctly. ${score === questions.length ? 'Great job!' : 'Keep practicing to improve your listening skills.'}`;
    
    if (feedback !== newFeedback) {
      setFeedback(newFeedback);
    }

    // Mark task as completed
    if (progressId && !isTaskStatusUpdating && !hasQuotaError) {
      practiceTracker.trackWrite('task_progress', 1);

      if (process.env.NODE_ENV === 'development') {
        console.log('[Practice] Marking task as completed:', progressId);
      }

      completeTask({ taskId: progressId }).catch(error => {
        console.error('[Practice] Error marking task as completed:', error);
        if (error?.message?.includes('not found') || error?.message?.includes('404')) {
          toast({
            title: "Progress Tracking Error",
            description: "There was an issue saving your completion. Your score has been calculated but may not be reflected in your profile.",
            variant: "destructive"
          });

          console.warn('[Practice] Error completing task. Progress ID:', progressId, 'Weekly Plan ID:', weeklyPlanId);
          setProgressIdInvalid(true);
        }
      });
    }

    // Show completion summary
    if (!showCompletionSummary) {
      setShowCompletionSummary(true);
    }
  };

  // Handle reset for trying the same exercise again
  const handleReset = () => {
    setIsSubmitted(false);
    setAnswers({});
    setMultiGapAnswers({});
    setFeedback('');
    setCurrentTime(0);
    setIsPlaying(false);
    setExerciseTimeRemaining(120);
    setExerciseTimerActive(false);
    setExerciseTimerExpired(false);
    setCurrentQuestionIndex(0);
    setReplaysRemaining(content?.replayLimit || 2);
    setShowCompletionSummary(false);
  };



  // Format time for display (mm:ss)
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  // Exercise timer countdown with value comparison guards
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    // Start timer if active, time remaining, and not submitted
    if (exerciseTimerActive && exerciseTimeRemaining > 0 && !isSubmitted) {
      // Start the timer
      interval = setInterval(() => {
        // Use functional update to ensure we're working with latest state
        setExerciseTimeRemaining(prev => {
          // Don't update if we've reached 0 already (safety check)
          return prev > 0 ? prev - 1 : 0;
        });
      }, 1000);
    } 
    // Handle timer expiration - only update if status is changing
    else if (exerciseTimeRemaining === 0 && !exerciseTimerExpired) {
      // Only update if it's changing
      setExerciseTimerExpired(true);
      // Don't auto-submit when exercise timer expires
    }

    // Clean up the interval when component unmounts or dependencies change
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [exerciseTimerActive, exerciseTimeRemaining, exerciseTimerExpired, isSubmitted]);

  // Start exercise timer when audio plays - with value comparison guards
  useEffect(() => {
    // Check all conditions first, then only update if needed
    const shouldActivateTimer = isPlaying && !exerciseTimerActive && !isSubmitted;
    
    if (shouldActivateTimer) {
      // Double check to avoid redundant updates
      setExerciseTimerActive(true);
      
      // Log this action for debugging purposes
      console.log('[Practice] Starting exercise timer because audio started playing');
    }
  }, [isPlaying, exerciseTimerActive, isSubmitted]);

  // Session timer countdown
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (sessionTimerActive && sessionTimeRemaining > 0 && !sessionComplete) {
      interval = setInterval(() => {
        setSessionTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (sessionTimeRemaining === 0 && !sessionComplete) {
      // Only update if value is actually changing
      if (!sessionComplete) {
        setSessionComplete(true);
      }

      // Time's up for the entire session
      const newFeedback = `Time's up for today. Great work practicing! Come back tomorrow to continue your progress.`;
      
      // Only update feedback if it's different
      if (feedback !== newFeedback) {
        setFeedback(newFeedback);
      }
      
      // Only update if it's changing
      if (!showCompletionSummary) {
        setShowCompletionSummary(true);
      }
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [sessionTimerActive, sessionTimeRemaining, sessionComplete, feedback, showCompletionSummary]);

  // TODO: Connect to actual audio player when audio files are available
  // For now, simulate audio player progress
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isPlaying && currentTime < 120) {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          const newTime = prev + 1;
          if (newTime >= 120) {
            setIsPlaying(false);
            return 120;
          }
          return newTime;
        });
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, currentTime]);

  // Use task content as single source of truth
  useEffect(() => {
    if (content && taskQ.status === "success") {
      console.log('[Practice] Using dynamic content from API:', content);

      // Set the replay limit from the API if available
      if (content.replayLimit && typeof content.replayLimit === 'number' && !isNaN(content.replayLimit)) {
        setReplaysRemaining(content.replayLimit);
      }

      // Update duration if available
      if (typeof content.duration === 'number' && !isNaN(content.duration) && duration !== content.duration) {
        setDuration(content.duration);
      }
      
      // Map the API questions format to our component's expected format
      const newQuestions = Array.isArray(content.questions) && content.questions.length > 0
        ? content.questions.map((q: {id: string; question: string; options?: any[]; correctAnswer?: string; explanation?: string}) => ({
            id: q.id || `question-${Math.random().toString(36).substring(2, 9)}`,
            text: q.question || '',
            type: (Array.isArray(q.options) && q.options.length > 0 ? 'multiple-choice' : 'fill-in-the-gap') as 'multiple-choice' | 'fill-in-the-gap' | 'fill-in-multiple-gaps',
            options: Array.isArray(q.options) ? q.options : [],
            correctAnswer: q.correctAnswer || '',
            explanation: q.explanation || ''
          }))
        : [];

      // Efficient questions comparison using length and ID check first
      const currentQuestions = lastQuestionsRef.current;
      
      // First check if lengths are different (quick check)
      let questionsChanged = currentQuestions.length !== newQuestions.length;
      
      // If lengths are the same, do a more detailed comparison of question IDs
      if (!questionsChanged && currentQuestions.length > 0 && newQuestions.length > 0) {
        // Compare IDs (much faster than full JSON comparison)
        for (let i = 0; i < newQuestions.length; i++) {
          if (newQuestions[i].id !== currentQuestions[i].id) {
            questionsChanged = true;
            break;
          }
        }
      }
      
      // Only update state if questions have changed
      if (questionsChanged) {
        // Update the ref with the new questions array
        lastQuestionsRef.current = newQuestions;
        // Update the state
        setQuestions(newQuestions);
        console.log('[Practice] Questions updated due to detected changes');
      }

      console.log('[Practice] Updated with dynamic content');
    }
  }, [content, taskQ.status, duration]);

  // State to track if task progress ID is valid and error handling
  const [progressIdInvalid, setProgressIdInvalid] = useState(
    !progressId || progressId === 'unknown' || progressId.length < 5
  );

  // Monitor route parameters and handle changes with value comparison guards
  useEffect(() => {
    // Only log when parameters actually change or on first mount
    const hasWeekDayChanged = prevWeekRef.current !== week || prevDayRef.current !== day;
    
    if (hasWeekDayChanged) {
      console.log('[Practice] Route parameters changed:', {
        week,
        day,
        previousWeek: prevWeekRef.current,
        previousDay: prevDayRef.current,
        progressId,
        weeklyPlanId,
        progressIdInvalid,
        currentUrl: window.location.href
      });
      
      // Update refs with current values
      prevWeekRef.current = week;
      prevDayRef.current = day;
    }

    // Show error for invalid progress ID early - only when the status changes
    if (progressIdInvalid) {
      // Check if we've already shown this error
      const progressIdErrorKey = `progress-error-${progressId}`;
      if (!sessionStorage.getItem(progressIdErrorKey)) {
        console.warn('[Practice] Invalid progressId detected during initialization');
        toast({
          title: "Task Progress Error",
          description: "There was an issue locating your task progress. This might happen if the task was removed or updated. You can continue practicing, but your progress may not be saved.",
          variant: "destructive"
        });
        
        // Mark this error as shown
        sessionStorage.setItem(progressIdErrorKey, 'true');
      }
    }
  }, [progressIdInvalid, progressId, weeklyPlanId, week, day, toast]);

  // Initialize task progress when component mounts - mark as "in-progress" (once only)
  // This effect runs only once when the component mounts, controlled by a mount ref
  const componentMountedRef = useRef(false);
  // Add an additional ref to ensure task is NEVER started more than once, even across re-renders
  const startTaskInvokedRef = useRef<boolean>(false);

  useEffect(() => {
    console.count("startTaskEffect");

    // Double-check with the new ref to ensure it can NEVER run more than once
    if (startTaskInvokedRef.current) {
      console.log("[Practice] startTask already invoked, permanently skipping");
      return;
    }

    // Prevent this effect from running more than once
    if (componentMountedRef.current) {
      console.log("[Practice] Effect already ran once, skipping");
      return;
    }

    // Mark component as mounted
    componentMountedRef.current = true;
    // Add this line to permanently block future executions
    startTaskInvokedRef.current = true;

    // Skip if progressId is 'unknown' or already marked invalid
    if (progressId === 'unknown' || progressIdInvalid) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Practice] Skipping task progress update - invalid progressId:', progressId);
      }
      return;
    }

    // Ensure task ID is valid before proceeding
    if (!progressId) {
      console.log('[Practice] No progressId available, skipping task start');
      return;
    }

    // We don't need the loading/updating checks here since we only run once on mount
    if (!hasStartedTaskRef.current && !hasQuotaError) {
      // Set the flag to prevent future calls - SET THIS BEFORE TIMEOUT
      hasStartedTaskRef.current = true;

      // Track this operation with the component tracker
      practiceTracker.trackWrite('task_progress', 1);

      console.log('[Practice] Marking task as in-progress (ONE TIME ONLY):', progressId);

      // Use setTimeout to break any synchronous execution cycles
      setTimeout(() => {
        console.log('[Practice] Inside setTimeout for startTask', progressId);

        // Call startTask with the initial state only
        startTask({ 
          taskId: progressId,
          progressData: {
            startTime: new Date().toISOString(),
            initialQuestionIndex: currentQuestionIndex
          }
        }).catch(error => {
          console.error('[Practice] Error starting task:', error);
          // If we get a "not found" error or 404, mark the progressId as invalid and show a user-friendly toast
          if (error?.message?.includes('not found') || error?.message?.includes('404')) {
            setProgressIdInvalid(true);

            // Show a user-friendly error message
            toast({
              title: "Task Progress Error",
              description: "There was an issue locating your task progress. This might happen if the task was removed or updated. You can continue practicing, but your progress may not be saved.",
              variant: "destructive"
            });

            // Log detailed info for debugging
            console.warn('[Practice] Invalid progressId detected. Using ID:', progressId, 'Weekly Plan ID:', weeklyPlanId);
          }
        });
      }, 0);
    }
  // Only depend on progressId and hasQuotaError to prevent unnecessary re-renders
  // while still allowing the effect to respond to those critical state changes
  }, [progressId, progressIdInvalid, hasQuotaError]);

  // Initialize replay limit from API data
  useEffect(() => {
    if (
      content?.replayLimit && 
      typeof content.replayLimit === 'number' && 
      !isNaN(content.replayLimit) &&
      replaysRemaining !== content.replayLimit
    ) {
      // Set the replays remaining from the API data only if changed
      setReplaysRemaining(content.replayLimit);
    }
  }, [content, replaysRemaining]);

  // Create audio element if we have a URL and none exists yet
  useEffect(() => {
    // INVESTIGATION: Log audio URL for silent audio debugging
    if (audioUrl) {
      console.log('[AUDIO INVESTIGATION] Audio URL detected:', audioUrl);
      console.log('[AUDIO INVESTIGATION] URL length:', audioUrl.length);
      console.log('[AUDIO INVESTIGATION] URL starts with https:', audioUrl.startsWith('https://'));
      console.log('[AUDIO INVESTIGATION] Contains S3 pattern:', audioUrl.includes('.s3.'));
      console.log('[AUDIO INVESTIGATION] Direct test URL for browser:', audioUrl);
    } else {
      console.log('[AUDIO INVESTIGATION] No audio URL available');
    }
    
    // Only create audio element if one doesn't exist and we have a URL
    if (audioUrl && !audioRef.current) {
      const audio = new Audio(audioUrl);
      
      // Set volume (0-1 scale)
      audio.volume = volume / 100;
      
      // INVESTIGATION: Add audio event listeners for debugging
      audio.addEventListener('loadstart', () => {
        console.log('[AUDIO INVESTIGATION] Audio loading started');
      });
      
      audio.addEventListener('canplay', () => {
        console.log('[AUDIO INVESTIGATION] Audio can start playing');
        console.log('[AUDIO INVESTIGATION] Audio duration:', audio.duration);
      });
      
      audio.addEventListener('error', (e) => {
        console.error('[AUDIO INVESTIGATION] Audio error:', e);
        console.error('[AUDIO INVESTIGATION] Audio error details:', audio.error);
      });
      
      // Store the audio element reference
      audioRef.current = audio;
    } else if (audioRef.current && volume !== prevVolumeRef.current) {
      // Only update volume if it's changed
      audioRef.current.volume = volume / 100;
      prevVolumeRef.current = volume;
    }
  }, [audioUrl, volume]);

  // Handle audio element events - single useEffect with proper cleanup
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    
    // Define named handler functions with guards to prevent unnecessary state updates
    function onTimeUpdate() {
      if (audioEl && currentTime !== audioEl.currentTime) {
        setCurrentTime(audioEl.currentTime);
      }
    }
    
    function onEnded() {
      if (isPlaying) {
        setIsPlaying(false);
      }
    }
    
    function onLoadedMeta() {
      if (audioEl) {
        const dur = audioEl.duration;
        if (!isNaN(dur) && duration !== dur) {
          setDuration(dur);
          console.log('[Audio Player] Loaded audio with duration:', dur);
        }
      }
    }
    
    // Attach event listeners once
    audioEl.addEventListener('timeupdate', onTimeUpdate);
    audioEl.addEventListener('ended', onEnded);
    audioEl.addEventListener('loadedmetadata', onLoadedMeta);
    
    // In the cleanup function, remove those listeners
    return () => {
      if (audioEl) {
        audioEl.removeEventListener('timeupdate', onTimeUpdate);
        audioEl.removeEventListener('ended', onEnded);
        audioEl.removeEventListener('loadedmetadata', onLoadedMeta);
      }
    };
  }, [audioRef.current, currentTime, isPlaying, duration]);

  // Clean up audio element on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        const audio = audioRef.current;
        audio.pause();
        audio.src = '';
        audio.remove();
        audioRef.current = null;
        console.log('[Audio Player] Cleaned up audio element');
      }
    };
  }, []);

  // Handle audio replay with limited replays - optimized with value comparison guards
  const handlePlayPause = () => {
    // Cache reference to audio element to avoid repeated property access
    const audioEl = audioRef.current;
    
    // If we have a real audio element, use it
    if (audioEl) {
      if (isPlaying) {
        // Pause the audio
        audioEl.pause();
        
        // Only update state if it's actually changing
        if (isPlaying) {
          setIsPlaying(false);
          console.log('[Audio Player] Paused audio playback');
        }
      } else {
        // Play the audio
        // If audio is finished, restart it
        if (currentTime >= duration) {
          if (replaysRemaining > 0 && !isSubmitted) {
            // Reset audio position - use stored reference
            audioEl.currentTime = 0;
            
            // Only update time state if it's not already 0
            if (currentTime !== 0) {
              setCurrentTime(0);
            }

            // Decrement the replay count - use functional update to ensure we have latest state
            setReplaysRemaining(prev => prev - 1);
            console.log('[Audio Player] Starting replay, remaining:', replaysRemaining - 1);

            // Play the audio with enhanced error handling
            audioEl.play()
              .then(() => {
                // Only update if state is actually changing
                if (!isPlaying) {
                  setIsPlaying(true);
                }
              })
              .catch(error => {
                console.error('[Audio Player] Error playing audio:', error);
                
                // Only show toast for actual playback errors, not aborted operations
                if (error.name !== 'AbortError') {
                  toast({
                    title: "Audio playback error",
                    description: "There was an issue playing the audio. Please try again.",
                    variant: "destructive"
                  });
                }
              });
          } else {
            // No replays left or test submitted
            // Use session storage to prevent duplicate toasts
            const replayLimitKey = `replay-limit-shown-${taskContent?.id || 'unknown'}`;
            
            if (!sessionStorage.getItem(replayLimitKey)) {
              toast({
                title: "Replay limit reached",
                description: `You can only replay this audio ${taskContent?.replayLimit || 2} times.`,
                variant: "destructive"
              });
              
              // Mark that we've shown this message
              sessionStorage.setItem(replayLimitKey, 'true');
            }
          }
        } else {
          // Continue playing from current position - use cached reference
          audioEl.play()
            .then(() => {
              // Only update if state is actually changing
              if (!isPlaying) {
                setIsPlaying(true);
                console.log('[Audio Player] Resumed audio playback');
              }
            })
            .catch(error => {
              console.error('[Audio Player] Error playing audio:', error);
              
              // Only show toast for actual playback errors, not aborted operations
              if (error.name !== 'AbortError') {
                // Use session storage to prevent duplicate error toasts
                const audioErrorKey = `audio-error-${taskContent?.id || 'unknown'}`;
                
                if (!sessionStorage.getItem(audioErrorKey)) {
                  toast({
                    title: "Audio playback error",
                    description: "There was an issue playing the audio. Please try again.",
                    variant: "destructive"
                  });
                  
                  // Mark that we've shown this error
                  sessionStorage.setItem(audioErrorKey, 'true');
                }
              }
            });
        }
      }
    } else {
      // Fallback to the simulated player if no audio element
      // Track that we showed an error message about missing audio
      const audioMissingKey = `audio-missing-${taskContent?.id || 'unknown'}`;
      
      if (!sessionStorage.getItem(audioMissingKey)) {
        console.warn('[Audio Player] No audio element available, using simulated player');
        toast({
          title: "Audio Not Available",
          description: "The audio for this exercise could not be loaded. Using simulated playback instead.",
          variant: "default"
        });
        
        // Mark that we've shown this message
        sessionStorage.setItem(audioMissingKey, 'true');
      }
      
      if (currentTime >= duration) {
        if (replaysRemaining > 0 && !isSubmitted) {
          // Only update if changing from non-zero
          if (currentTime !== 0) {
            setCurrentTime(0);
          }
          
          // Only update if it's changing
          if (!isPlaying) {
            setIsPlaying(true);
          }
          
          // Use functional update for replays
          setReplaysRemaining(prev => prev - 1);
          console.log('[Audio Player] Simulated replay, remaining:', replaysRemaining - 1);
        }
      } else {
        // Toggle play/pause if still playing - only update if changing
        setIsPlaying(current => !current);
        console.log('[Audio Player] Toggled simulated playback to:', !isPlaying);
      }
    }
  };

  // Handle audio reset with replay limit - optimized with value comparison guards
  const handleResetAudio = () => {
    if (replaysRemaining > 0 && !isSubmitted) {
      // Cache reference to audio element
      const audioEl = audioRef.current;
      
      if (audioEl) {
        // Reset audio position
        audioEl.currentTime = 0;
        console.log('[Audio Player] Reset audio position to beginning');
      }
      
      // Only update time if it's not already 0
      if (currentTime !== 0) {
        setCurrentTime(0);
      }
      
      // Only update playing state if it's currently playing
      if (isPlaying) {
        setIsPlaying(false);
      }
      
      // Use functional update for replays
      setReplaysRemaining(prev => prev - 1);
      console.log('[Audio Player] Reset audio, remaining replays:', replaysRemaining - 1);
    } else {
      // No replays left or test submitted
      // Use session storage to prevent duplicate toasts
      const replayLimitKey = `replay-limit-reset-${content?.id || 'unknown'}`;
      
      if (!sessionStorage.getItem(replayLimitKey)) {
        toast({
          title: "Replay limit reached",
          description: `You can only replay this audio ${content?.replayLimit || 2} times.`,
          variant: "destructive"
        });
        
        // Mark that we've shown this message
        sessionStorage.setItem(replayLimitKey, 'true');
      }
    }
  };

  // Proper state handling for endless spinner fix
  const isLoading = taskQ.status === "loading" || progQ.status === "loading";
  
  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <WouterLink 
            href="/dashboard" 
            className="flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Dashboard
          </WouterLink>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Loading Practice Session</CardTitle>
            <CardDescription>Fetching task data…</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4"></div>
              <p className="text-sm text-gray-600">Loading your practice content...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (taskQ.status === "error") {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <WouterLink 
            href="/dashboard" 
            className="flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Dashboard
          </WouterLink>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Error Loading Content</CardTitle>
            <CardDescription>Failed to load task content.</CardDescription>
          </CardHeader>
          <CardContent className="text-center py-12">
            <p className="text-gray-600 mb-4">
              {(taskQ.error as any)?.message ?? "Failed to load task content."}
            </p>
            <Button 
              onClick={() => taskQ.refetch()}
              variant="outline"
              className="mr-4"
            >
              Try Again
            </Button>
            <Button 
              onClick={() => window.location.href = '/dashboard'}
              className="bg-black text-white hover:bg-gray-800"
            >
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const content = taskQ.data; // guaranteed non-null on success (see select)
  
  // Preparing state (script ready but audio not uploaded yet)
  if (taskQ.status === "success" && content && !content.audioUrl) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <WouterLink 
            href="/dashboard" 
            className="flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Dashboard
          </WouterLink>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>{content.title ?? originalTitle}</CardTitle>
            <CardDescription>Preparing audio content…</CardDescription>
          </CardHeader>
          <CardContent className="text-center py-12">
            <div className="animate-pulse rounded-full h-12 w-12 bg-gray-200 mx-auto mb-4"></div>
            <p className="text-gray-600 mb-4">
              Preparing audio… This can take up to ~20 seconds. This page will refresh automatically.
            </p>
            <Button 
              onClick={() => taskQ.refetch()}
              variant="outline"
            >
              Refresh Status
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Session completion summary view
  if (showCompletionSummary) {
    const score = calculateScore();
    const total = questions.length;
    const percentageScore = total > 0 ? Math.round((score / total) * 100) : 0;

    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <WouterLink 
            href="/dashboard" 
            className="flex items-center text-sm text-gray-600 hover:text-gray-900"
            onClick={() => {
              // Mark task as completed if not already done
              if (progressId && !isTaskStatusUpdating && !progressIdInvalid) {
                console.log('Marking task as completed before returning to dashboard:', progressId);
                completeTask({ taskId: progressId }).catch(error => {
                  console.error('[Practice] Error marking task as completed from summary:', error);
                  // If we get a "not found" error or 404, show a user-friendly toast
                  if (error?.message?.includes('not found') || error?.message?.includes('404')) {
                    // Show a user-friendly error message
                    toast({
                      title: "Progress Tracking Error",
                      description: "There was an issue saving your session completion. Your score has been calculated but may not be reflected in your profile.",
                      variant: "destructive"
                    });
                    setProgressIdInvalid(true);
                  }
                });
              }
            }}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Dashboard
          </WouterLink>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Session Complete</CardTitle>
            <CardDescription>
              {sessionComplete 
                ? "Time's up for today. Great work!" 
                : "You've completed all exercises for today."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-lg">
              <h3 className="text-xl font-bold mb-2">Your Score</h3>
              <div className="text-4xl font-bold mb-2">{score}/{total}</div>
              <div className="text-lg">{percentageScore}%</div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Practice Session Completed</h3>
              <div className="p-3 bg-gray-50 rounded-md">
                <div className="flex justify-between items-center">
                  <span>{displayTitle}</span>
                  <Badge className={score === total ? "bg-green-100 text-green-800" : "bg-gray-100"}>
                    {score}/{total}
                  </Badge>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Feedback</h3>
              <p>
                {percentageScore >= 80 
                  ? "Excellent work! You show a good understanding of listening comprehension."
                  : percentageScore >= 60
                    ? "Good progress. Continue practicing to improve your listening skills."
                    : "Keep practicing regularly to build your listening skills."
                }
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full bg-black text-white hover:bg-gray-800"
              onClick={() => window.location.href = '/dashboard'}
            >
              Return to Dashboard
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Display quota error alert if needed */}
      <QuotaErrorAlert visible={hasQuotaError} />

      <div className="mb-6">
        <WouterLink 
          href="/dashboard" 
          className="flex items-center text-sm text-gray-600 hover:text-gray-900"
          onClick={() => {
            // Since the user is exiting early, let's update the task status to in-progress
            if (progressId && !isTaskStatusUpdating && !progressIdInvalid && progressId !== 'unknown') {
              // Track this operation
              practiceTracker.trackWrite('task_progress', 1);

              if (process.env.NODE_ENV === 'development') {
                console.log('[Practice] Updating task progress before returning to dashboard:', progressId);
              }

              updateTaskStatus({
                taskId: progressId,
                status: 'in-progress',
                progressData: {
                  lastActiveTime: new Date().toISOString(),
                  currentQuestionIndex: currentQuestionIndex,
                  lastQuestionIndex: currentQuestionIndex,
                  answers: answers,
                  multiGapAnswers: multiGapAnswers
                }
              }).catch(error => {
                console.error('[Practice] Error updating task status:', error);
                // If we get a "not found" error or 404, mark the progressId as invalid and show a user-friendly toast
                if (error?.message?.includes('not found') || error?.message?.includes('404')) {
                  setProgressIdInvalid(true);

                  // Show a user-friendly error message
                  toast({
                    title: "Task Progress Error",
                    description: "There was an issue updating your task progress. Your practice session will not be saved.",
                    variant: "destructive"
                  });

                  // Log detailed info for debugging
                  console.warn('[Practice] Invalid progressId detected when returning to dashboard. Using ID:', progressId, 'Weekly Plan ID:', weeklyPlanId);
                }
              });
            }
          }}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Dashboard
        </WouterLink>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">{displayTitle}</h1>
          <div className="flex items-center gap-2">
            {!isMobile && (
              <>
                <Badge variant="outline" className="text-xs">Week {week}</Badge>
                <Badge variant="outline" className="text-xs">Day {day}</Badge>
              </>
            )}
            <Badge className="bg-black text-white text-xs">{skill}</Badge>
            {isMobile && (
              <Badge variant="outline" className="text-xs">{formatTime(sessionTimeRemaining)}</Badge>
            )}
          </div>
        </div>
        {!isMobile && (
          <div className="font-medium text-sm">
            Session time: {formatTime(sessionTimeRemaining)}
          </div>
        )}
      </div>

      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-5 w-5" />
              Audio Player
            </CardTitle>
            <Badge variant="outline" className="bg-gray-100">
              {taskContent?.accent || 'British'} Accent
            </Badge>
          </div>
          <CardDescription>
            Listen carefully to the audio and answer the questions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Script transcript collapsible section */}
            {taskContent?.scriptText && (
              <div className="text-xs text-gray-500 mb-2">
                <details className="text-sm mb-4">
                  <summary className="cursor-pointer font-medium hover:text-gray-700 transition-colors">
                    Show transcript
                  </summary>
                  <div className="mt-2 p-3 bg-gray-50 rounded text-sm leading-relaxed">
                    {typeof taskContent.scriptText === 'string' ? taskContent.scriptText : ''}
                  </div>
                </details>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="icon"
                onClick={handlePlayPause}
                disabled={(currentTime >= duration && replaysRemaining === 0) || isSubmitted}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button 
                variant="outline" 
                size="icon"
                onClick={handleResetAudio}
                disabled={replaysRemaining === 0 || isSubmitted}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <div className="flex-1 ml-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <Progress 
                  value={(currentTime / duration) * 100} 
                  className="cursor-pointer"
                  onClick={(e) => {
                    // Calculate position click and seek to that position
                    const progressBar = e.currentTarget;
                    const rect = progressBar.getBoundingClientRect();
                    const offsetX = e.clientX - rect.left;
                    const percentage = offsetX / rect.width;
                    const newTime = duration * percentage;

                    if (audioRef.current) {
                      audioRef.current.currentTime = newTime;
                    }
                    setCurrentTime(newTime);
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between mt-2">
              <div className="text-xs text-gray-500 flex items-center">
                <span>
                  {replaysRemaining > 0 ? 
                    `${replaysRemaining} replay${replaysRemaining !== 1 ? 's' : ''} remaining` : 
                    'No replays remaining'}
                </span>
                {taskContent?.accent && (
                  <span className="ml-3 inline-flex items-center">
                    <span className="w-2 h-2 rounded-full bg-gray-300 mr-1"></span>
                    {typeof taskContent.accent === 'string' ? taskContent.accent : 'British'} accent
                  </span>
                )}
              </div>
              {/* Exercise time display removed as per requirements */}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium">Question {currentQuestionIndex + 1} of {questions.length}</p>
          <Progress 
            className="w-24 h-2 ml-2"
            value={((currentQuestionIndex + 1) / questions.length) * 100} 
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousQuestion}
            disabled={currentQuestionIndex === 0}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToNextQuestion}
            disabled={currentQuestionIndex === questions.length - 1}
          >
            Next
          </Button>
        </div>
      </div>

      <Card className="mb-8">
        <CardContent className="pt-6">
          {currentQuestion && currentQuestion.type === 'multiple-choice' && (
            <MultipleChoiceQuestion 
              question={currentQuestion}
              selectedAnswer={answers[currentQuestion.id] || null}
              onSelectAnswer={(answerId) => handleSelectAnswer(currentQuestion.id, answerId)}
              isSubmitted={isSubmitted}
            />
          )}

          {currentQuestion && currentQuestion.type === 'fill-in-the-gap' && (
            <FillInTheGapQuestion 
              question={currentQuestion}
              answer={answers[currentQuestion.id] || ''}
              onAnswerChange={(text) => handleTextAnswer(currentQuestion.id, text)}
              isSubmitted={isSubmitted}
            />
          )}

          {currentQuestion && isMultipleGapsQuestion(currentQuestion) && (
            <FillInMultipleGapsQuestion 
              question={currentQuestion}
              answers={multiGapAnswers[currentQuestion.id] || {}}
              onAnswerChange={(blankId, value) => handleMultiGapAnswer(currentQuestion.id, blankId, value)}
              isSubmitted={isSubmitted}
            />
          )}

          {!currentQuestion && (
            <div className="text-center py-8">
              <p className="text-gray-600">No questions available for this practice session.</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end">
          {!isSubmitted ? (
            // Only show the Submit button on the last question for both mobile and desktop
            isLastQuestion && (
              <Button 
                className="bg-black text-white hover:bg-gray-800"
                onClick={handleSubmit}
                disabled={!areAllQuestionsAnswered()}
              >
                Submit Answers
              </Button>
            )
          ) : (
            <div className="flex gap-2">
              {/* "Try Again" button removed as per requirements */}
              <Button 
                className="bg-black text-white hover:bg-gray-800"
                onClick={handleSubmit}
              >
                Complete Practice Session
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>

      {isSubmitted && (
        <>
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Your Results</CardTitle>
              <CardDescription>
                Review your answers and see explanations for each question
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {questions.map((question, index) => {
                // Determine if the question was answered correctly
                const isCorrect = 
                  isMultipleGapsQuestion(question) ?
                    question.blanks.every(blank => 
                      (multiGapAnswers[question.id]?.[blank.id] || '') === blank.correctAnswer
                    ) :
                    (answers[question.id] || '') === question.correctAnswer;

                return (
                  <div key={question.id} className="pb-6 border-b border-gray-100 last:border-b-0 last:pb-0">
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-lg font-medium">Question {index + 1}</h3>
                      <Badge className={isCorrect ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                        {isCorrect ? "Correct" : "Incorrect"}
                      </Badge>
                    </div>

                    <p className="mb-3">{question.text}</p>

                    {isMultipleGapsQuestion(question) ? (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-2">Your answer:</p>
                        <ul className="list-disc list-inside pl-2 space-y-1 text-sm">
                          {question.blanks.map(blank => {
                            const userAnswer = multiGapAnswers[question.id]?.[blank.id] || '';
                            const option = blank.options.find(opt => opt.id === userAnswer);
                            const correctOption = blank.options.find(opt => opt.id === blank.correctAnswer);
                            const isBlankCorrect = userAnswer === blank.correctAnswer;

                            return (
                              <li key={blank.id} className={cn(
                                isBlankCorrect ? "text-green-700" : "text-red-700"
                              )}>
                                <span className="font-medium">{blank.id}: </span>
                                <span>
                                  {option?.text || "No answer"} 
                                  {!isBlankCorrect && correctOption && (
                                    <span className="text-green-700"> (Correct: {correctOption.text})</span>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-2">Your answer:</p>
                        <p className={cn(
                          "text-sm pl-2",
                          isCorrect ? "text-green-700" : "text-red-700"
                        )}>
                          {question.type === 'multiple-choice' ? (
                            question.options?.find(opt => opt.id === answers[question.id])?.text || "No answer"
                          ) : (
                            answers[question.id] || "No answer"
                          )}

                          {!isCorrect && (
                            <span className="text-green-700 ml-2">
                              (Correct: {
                                question.type === 'multiple-choice' 
                                  ? question.options?.find(opt => opt.id === question.correctAnswer)?.text 
                                  : question.correctAnswer
                              })
                            </span>
                          )}
                        </p>
                      </div>
                    )}

                    {question.explanation && (
                      <div className="mb-3">
                        <p className="text-sm font-medium mb-1">Explanation:</p>
                        <p className="text-sm pl-2">{question.explanation}</p>
                      </div>
                    )}

                    {question.hint && (
                      <div>
                        <p className="text-sm font-medium mb-1">Hint for next time:</p>
                        <p className="text-sm italic pl-2">{question.hint}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {feedback && (
            <Card>
              <CardHeader>
                <CardTitle>AI Feedback</CardTitle>
                <CardDescription>
                  Here's personalized feedback on your performance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p>{feedback}</p>
              </CardContent>
              <CardFooter>
                <Button 
                  onClick={handleReset}
                  className="mr-4"
                  variant="outline"
                >
                  Try Again
                </Button>
                <Button 
                  className="bg-black text-white hover:bg-gray-800"
                  onClick={() => setShowCompletionSummary(true)}
                >
                  Complete Practice Session
                </Button>
              </CardFooter>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default function PracticePage() {
  return (
    <ProtectedRoute requireOnboarding>
      <Practice />
    </ProtectedRoute>
  );
}