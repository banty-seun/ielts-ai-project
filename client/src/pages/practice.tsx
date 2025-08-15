import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { useTaskProgress } from '@/hooks/useTaskProgress';
import { useTaskContent } from '@/hooks/useTaskContent';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { QuotaErrorAlert } from '@/components/QuotaErrorAlert';

// Debug flag
const DEBUG = Boolean((window as any).__DEBUG__);

// Type definitions for questions
interface QuestionOption {
  id: string;
  text: string;
}

interface BlankOption {
  id: string;
  text: string;
}

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
  correctAnswer?: string;
  blanks?: Blank[];
  explanation?: string;
  hint?: string;
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

      {isSubmitted && (
        <div className="mt-3">
          <p className={cn(
            "text-sm font-medium",
            selectedAnswer === question.correctAnswer ? "text-green-600" : "text-red-600"
          )}>
            {selectedAnswer === question.correctAnswer 
              ? "Correct!" 
              : `Incorrect. The correct answer is: ${question.options?.find(o => o.id === question.correctAnswer)?.text}`}
          </p>
          {question.explanation && (
            <p className="text-sm mt-2">{question.explanation}</p>
          )}
        </div>
      )}
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
  onAnswerChange: (value: string) => void;
  isSubmitted: boolean;
}) => {
  return (
    <div className="my-6">
      <p className="font-medium mb-3">{question.text}</p>
      <div className="space-y-2">
        <Textarea
          value={answer}
          onChange={(e) => !isSubmitted && onAnswerChange(e.target.value)}
          placeholder="Type your answer here..."
          disabled={isSubmitted}
          className={cn(
            "min-h-[80px]",
            isSubmitted && answer === question.correctAnswer
              ? "border-green-500 focus-visible:ring-green-500"
              : isSubmitted && answer !== question.correctAnswer
                ? "border-red-500 focus-visible:ring-red-500"
                : ""
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

// Type guard and component for multiple gaps questions
interface MultipleGapsQuestion extends Omit<Question, 'type' | 'blanks'> {
  type: 'fill-in-multiple-gaps';
  blanks: Blank[];
}

function isMultipleGapsQuestion(question: Question): question is MultipleGapsQuestion {
  return question.type === 'fill-in-multiple-gaps' && !!question.blanks;
}

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

      {isSubmitted && question.explanation && (
        <div className="mt-4">
          <p className="text-sm font-medium mb-1">Explanation:</p>
          <p className="text-sm">{question.explanation}</p>
        </div>
      )}
    </div>
  );
};

// Main Practice component
const Practice = () => {
  // Route and query parameters
  const [match, params] = useRoute('/practice/:week/:day');
  const searchParams = new URLSearchParams(window.location.search);
  const routeQueryTitle = searchParams.get('title');
  const progressId = searchParams.get('progressId');
  const urlTaskId = searchParams.get('taskId');
  const taskId = progressId || urlTaskId || '';

  // Hook calls (always unconditional)
  const { data: contentData, status: contentStatus, error: contentError } = useTaskContent(taskId);
  const { data: progressData, status: progressStatus, error: progressError, startTask } = useTaskProgress({ progressId: progressId || '' });

  // Single source of truth content bindings
  const title = 
    (contentData?.scenario && contentData?.conversationType)
      ? `${contentData.scenario}: ${contentData.conversationType}`
      : (contentData?.title ?? routeQueryTitle ?? 'Listening Practice');
  
  const transcript = contentData?.scriptText ?? '';
  const audioSrc = contentData?.audioUrl ?? '';
  const questions = Array.isArray(contentData?.questions) ? contentData.questions : [];

  // Firebase auth and utilities
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { currentUser } = useFirebaseAuthContext();

  // Audio player setup
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // One-time task start per taskId
  const startedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId || startedRef.current === taskId) return;
    startedRef.current = taskId;
    if (DEBUG) console.log('[Audio] Starting task:', taskId);
    startTask({ taskId });
  }, [taskId, startTask]);

  // Audio element setup (once)
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onCanPlay = () => {
      setDuration(el.duration || 0);
      if (DEBUG) console.log('[Audio] canplay, duration:', el.duration);
    };
    const onError = (e: Event) => {
      const err = (e.target as HTMLAudioElement)?.error;
      if (DEBUG) console.warn('[Audio][error]', { code: err?.code, message: err?.message });
    };
    const onEnded = () => {
      setIsPlaying(false);
      if (DEBUG) console.log('[Audio] ended');
    };
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime || 0);
    };

    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('error', onError);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);

    // Remove crossOrigin to avoid unnecessary CORS checks
    if (el.hasAttribute('crossorigin')) {
      el.removeAttribute('crossorigin');
    }

    return () => {
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('error', onError);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, []);

  // Set audio source when URL changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    if (!audioSrc) {
      el.removeAttribute('src');
      el.load();
      return;
    }

    if (el.src !== audioSrc) {
      if (DEBUG) console.log('[Audio] setting src:', audioSrc);
      el.src = audioSrc;
      el.load();
    }
  }, [audioSrc]);

  // Play handler
  const handlePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el || !audioSrc) return;

    if (DEBUG) console.log('[Audio] attempting play', {
      src: el.currentSrc || el.src,
      networkState: el.networkState,
      readyState: el.readyState
    });

    try {
      if (isPlaying) {
        el.pause();
        setIsPlaying(false);
      } else {
        await el.play();
        setIsPlaying(true);
      }
    } catch (err: any) {
      if (DEBUG) console.warn('[Audio] play() failed, retrying shortly', err);
      setTimeout(() => el.play().catch(() => {}), 500);
    }
  }, [audioSrc, isPlaying]);

  // Question navigation state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [multiGapAnswers, setMultiGapAnswers] = useState<Record<string, Record<string, string>>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  // Answer handlers
  const handleSelectAnswer = (questionId: string, answerId: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answerId }));
  };

  const handleTextAnswer = (questionId: string, text: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: text }));
  };

  const handleMultiGapAnswer = (questionId: string, blankId: string, value: string) => {
    setMultiGapAnswers(prev => ({
      ...prev,
      [questionId]: { ...(prev[questionId] || {}), [blankId]: value }
    }));
  };

  // Navigation
  const goToNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setIsSubmitted(false);
    }
  };

  const goToPreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
      setIsSubmitted(false);
    }
  };

  // Check if current question is answered
  const isCurrentQuestionAnswered = () => {
    if (!currentQuestion) return false;
    if (isMultipleGapsQuestion(currentQuestion)) {
      if (!multiGapAnswers[currentQuestion.id]) return false;
      return currentQuestion.blanks.every(blank => multiGapAnswers[currentQuestion.id][blank.id]);
    }
    return !!answers[currentQuestion.id];
  };

  // Update page title
  useEffect(() => {
    document.title = `${title} - IELTS Practice`;
    return () => { document.title = 'IELTS Practice Platform'; };
  }, [title]);

  // Render loading states
  if (contentStatus === 'loading' || progressStatus === 'loading') {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-white">
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4"></div>
              <p className="text-sm text-gray-600">Loading practice session...</p>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // Render error states
  if (contentStatus === 'error' || progressStatus === 'error') {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-white">
          <div className="container mx-auto px-4 py-8">
            <Card className="max-w-md mx-auto">
              <CardContent className="p-6 text-center">
                <h2 className="text-lg font-semibold mb-2">Unable to Load Session</h2>
                <p className="text-sm text-gray-600 mb-4">
                  There was a problem loading your practice session. Please try again.
                </p>
                <Button onClick={() => window.location.reload()}>
                  Try Again
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // Render empty state
  if (!contentData?.id) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-white">
          <div className="container mx-auto px-4 py-8">
            <Card className="max-w-md mx-auto">
              <CardContent className="p-6 text-center">
                <h2 className="text-lg font-semibold mb-2">No Content Available</h2>
                <p className="text-sm text-gray-600 mb-4">
                  This session is being prepared. Please try again shortly.
                </p>
                <Button onClick={() => window.location.reload()}>
                  Refresh
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-white">
        {/* Header */}
        <div className="border-b border-gray-200">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <WouterLink href="/dashboard">
                  <Button variant="ghost" size="sm">
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back to Dashboard
                  </Button>
                </WouterLink>
                <div>
                  <h1 className="text-xl font-semibold">{title}</h1>
                  <p className="text-sm text-gray-600">Listening Practice</p>
                </div>
              </div>
              <Badge variant="outline">
                Question {currentQuestionIndex + 1} of {questions.length}
              </Badge>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Audio Player */}
            <div className="lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Volume2 className="h-5 w-5 mr-2" />
                    Audio Player
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <audio ref={audioRef} preload="auto" controls className="w-full" />
                  
                  <div className="flex items-center justify-between">
                    <Button 
                      onClick={handlePlay} 
                      disabled={!audioSrc}
                      size="sm"
                      className="flex items-center"
                    >
                      {isPlaying ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </Button>
                    
                    <div className="text-xs text-gray-500">
                      {Math.floor(currentTime / 60)}:{(currentTime % 60).toFixed(0).padStart(2, '0')} / {Math.floor(duration / 60)}:{(duration % 60).toFixed(0).padStart(2, '0')}
                    </div>
                  </div>

                  {duration > 0 && (
                    <Progress value={(currentTime / duration) * 100} className="w-full" />
                  )}
                </CardContent>
              </Card>

              {/* Transcript */}
              {transcript && (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <AlignLeft className="h-5 w-5 mr-2" />
                      Transcript
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-gray-700 leading-relaxed max-h-60 overflow-y-auto">
                      {transcript}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Questions */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Question {currentQuestionIndex + 1}</CardTitle>
                    <div className="flex items-center space-x-2">
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
                        disabled={isLastQuestion}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {currentQuestion && (
                    <>
                      {currentQuestion.type === 'multiple-choice' && (
                        <MultipleChoiceQuestion
                          question={currentQuestion}
                          selectedAnswer={answers[currentQuestion.id] || null}
                          onSelectAnswer={(answerId) => handleSelectAnswer(currentQuestion.id, answerId)}
                          isSubmitted={isSubmitted}
                        />
                      )}
                      
                      {currentQuestion.type === 'fill-in-the-gap' && (
                        <FillInTheGapQuestion
                          question={currentQuestion}
                          answer={answers[currentQuestion.id] || ''}
                          onAnswerChange={(text) => handleTextAnswer(currentQuestion.id, text)}
                          isSubmitted={isSubmitted}
                        />
                      )}
                      
                      {isMultipleGapsQuestion(currentQuestion) && (
                        <FillInMultipleGapsQuestion
                          question={currentQuestion}
                          answers={multiGapAnswers[currentQuestion.id] || {}}
                          onAnswerChange={(blankId, value) => handleMultiGapAnswer(currentQuestion.id, blankId, value)}
                          isSubmitted={isSubmitted}
                        />
                      )}
                    </>
                  )}
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button 
                    variant="outline" 
                    onClick={() => setIsSubmitted(!isSubmitted)}
                    disabled={!isCurrentQuestionAnswered()}
                  >
                    {isSubmitted ? 'Hide Answer' : 'Check Answer'}
                  </Button>
                  
                  {isLastQuestion ? (
                    <Button onClick={() => toast({ title: 'Session Complete', description: 'Great job!' })}>
                      Complete Session
                    </Button>
                  ) : (
                    <Button 
                      onClick={goToNextQuestion}
                      disabled={!isCurrentQuestionAnswered()}
                    >
                      Next Question
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
};

export default Practice;