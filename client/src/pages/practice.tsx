import React, { useState, useEffect, useRef } from 'react';
import { useRoute, Link as WouterLink, useLocation } from 'wouter';
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
import { queryClient } from '@/lib/queryClient';

// Debug toggle
const DEBUG = Boolean((window as any).__DEBUG__);

// Question types from API
interface QuestionOption {
  id: string;
  text: string;
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

// Loading card component
const LoadingCard = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div className="flex flex-col items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
    <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-600">{subtitle}</p>
  </div>
);

// Error card component
const ErrorCard = ({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) => (
  <div className="text-center py-12">
    <h3 className="text-lg font-semibold text-red-600 mb-2">{title}</h3>
    <p className="text-gray-600 mb-4">{message}</p>
    <Button onClick={onRetry} variant="outline">
      Try Again
    </Button>
  </div>
);

// Empty card component
const EmptyCard = ({ 
  title, 
  subtitle, 
  primaryAction, 
  secondaryAction 
}: { 
  title: string; 
  subtitle: string; 
  primaryAction: { label: string; onClick: () => void };
  secondaryAction: { label: string; to: string };
}) => (
  <div className="text-center py-12">
    <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-600 mb-6">{subtitle}</p>
    <div className="space-x-4">
      <Button onClick={primaryAction.onClick} variant="outline">
        {primaryAction.label}
      </Button>
      <WouterLink href={secondaryAction.to}>
        <Button variant="ghost">
          {secondaryAction.label}
        </Button>
      </WouterLink>
    </div>
  </div>
);

export default function Practice() {
  const [, params] = useRoute('/practice/:taskId');
  const [location] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const taskId = params?.taskId;
  const DEBUG = true;
  
  // Get task content and progress using our hooks with full query state
  const {
    data: content,
    status: contentStatus,
    isFetching: contentFetching,
    fetchStatus: contentFetchStatus,
    error: contentError,
  } = useTaskContent(taskId);

  const {
    taskProgress: progress,
    isLoading: progressLoading,
    error: progressError,
    startTask,
  } = useTaskProgress({ progressId: taskId, enabled: Boolean(taskId) });
  
  // Simulate status for consistency
  const progressStatus = progressLoading ? 'loading' : progressError ? 'error' : 'success';
  const progressFetching = progressLoading;
  const progressFetchStatus = progressLoading ? 'fetching' : 'idle';

  // Log precise query states (one line per render)
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[PRACTICE][query]', {
      taskId,
      contentStatus,
      contentFetching,
      contentFetchStatus,
      hasContent: Boolean(content && content.id),
      progressStatus,
      progressFetching,
      progressFetchStatus,
      hasProgress: Boolean(progress),
    });
  }

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

  const handleSubmit = () => {
    setIsSubmitted(true);
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

  // REPLACE any existing loader/error gating with this exact block:
  if (contentStatus === 'pending' || progressStatus === 'loading') {
    return (
      <PageShell>
        <LoadingCard title="Loading practice session..." subtitle="Fetching task content" />
      </PageShell>
    );
  }

  if (contentStatus === 'error') {
    return (
      <PageShell>
        <ErrorCard
          title="Error loading content"
          message={contentError instanceof Error ? contentError.message : 'Unknown error'}
          onRetry={() => queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-content/${taskId}`] })}
        />
      </PageShell>
    );
  }

  /**
   * IMPORTANT: Do not fall back to spinner when data is falsy.
   * If the query finished but content is missing, show an explicit empty state.
   */
  if (contentStatus === 'success' && !content?.id) {
    return (
      <PageShell>
        <EmptyCard
          title="No content found for this task"
          subtitle="This task may still be generating. Try again shortly or return to the dashboard."
          primaryAction={{
            label: 'Try again',
            onClick: () => queryClient.invalidateQueries({ queryKey: [`/api/firebase/task-content/${taskId}`] }),
          }}
          secondaryAction={{ label: 'Back to Dashboard', to: '/' }}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <QuotaErrorAlert visible={false} />
      
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-600 mt-2">IELTS Listening Practice</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Audio Player */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Volume2 className="h-5 w-5 mr-2" />
                Audio Player
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <audio 
                ref={audioRef} 
                preload="auto" 
                controls={false}
                src={undefined}
              />
              
              <div className="flex items-center space-x-4">
                <Button 
                  onClick={isPlaying ? handlePause : handlePlay}
                  disabled={!audioSrc}
                  size="lg"
                  className="flex-shrink-0"
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
                
                <div className="flex-1">
                  <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
                    <span>{Math.floor(currentTime / 60)}:{(Math.floor(currentTime % 60)).toString().padStart(2, '0')}</span>
                    <span>/</span>
                    <span>{Math.floor(duration / 60)}:{(Math.floor(duration % 60)).toString().padStart(2, '0')}</span>
                  </div>
                  
                  <input
                    type="range"
                    min="0"
                    max={duration || 100}
                    value={currentTime}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    className="w-full"
                    disabled={!audioSrc}
                  />
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <Volume2 className="h-4 w-4 text-gray-600" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm text-gray-600 w-8">{volume}%</span>
              </div>
            </CardContent>
          </Card>

          {/* Transcript */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <AlignLeft className="h-5 w-5 mr-2" />
                Transcript
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-50 p-4 rounded-lg max-h-64 overflow-y-auto">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {transcript || 'Transcript will appear here once available.'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Questions */}
        {questions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Question {currentQuestionIndex + 1} of {questions.length}
              </CardTitle>
              <CardDescription>
                {!isSubmitted && "Answer the question based on what you heard"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {currentQuestion && (
                <>
                  {currentQuestion.type === 'multiple-choice' && (
                    <MultipleChoiceQuestion
                      question={currentQuestion}
                      selectedAnswer={answers[currentQuestion.id] || null}
                      onSelectAnswer={handleSelectAnswer}
                      isSubmitted={isSubmitted}
                    />
                  )}
                  
                  {currentQuestion.type === 'fill-in-the-gap' && (
                    <FillInTheGapQuestion
                      question={currentQuestion}
                      answer={answers[currentQuestion.id] || ''}
                      onAnswerChange={handleTextAnswer}
                      isSubmitted={isSubmitted}
                    />
                  )}
                </>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button 
                onClick={goToPreviousQuestion}
                disabled={currentQuestionIndex === 0}
                variant="outline"
              >
                Previous
              </Button>
              
              <div className="flex space-x-2">
                {!isSubmitted && isLastQuestion && areAllQuestionsAnswered() && (
                  <Button onClick={handleSubmit}>
                    Submit Answers
                  </Button>
                )}
                
                {!isLastQuestion && (
                  <Button 
                    onClick={goToNextQuestion}
                    disabled={!isCurrentQuestionAnswered()}
                  >
                    Next
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>
        )}

        {/* Results */}
        {isSubmitted && (
          <Card>
            <CardHeader>
              <CardTitle>Practice Complete!</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <div className="text-4xl font-bold text-green-600 mb-2">
                  {calculateScore()}/{questions.length}
                </div>
                <p className="text-gray-600 mb-4">
                  You got {calculateScore()} out of {questions.length} questions correct
                </p>
                <div className="flex justify-center space-x-4">
                  <Button onClick={() => window.location.reload()} variant="outline">
                    Try Again
                  </Button>
                  <WouterLink href="/">
                    <Button>Back to Dashboard</Button>
                  </WouterLink>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}