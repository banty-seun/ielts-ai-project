import React, { useState, useEffect } from 'react';
import { useListeningSession } from '@/hooks/useListeningSession';
import { SessionState, Question, AdvisorFeedback as AdvisorFeedbackType } from '../../../../shared/schema';
import { AdvisorFeedback } from './AdvisorFeedback';
import { SessionSummary } from './SessionSummary';
import { Play, Pause, Clock, Volume2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface ListeningPracticeSessionProps {
  taskId: string;
  initialSessionState: SessionState;
  onSessionComplete?: () => void;
  onExit?: () => void;
}

interface AudioPackage {
  audioUrl: string;
  questions: Question[];
  scriptText?: string;
  accent?: string;
  duration?: number;
  replayLimit?: number;
}

/**
 * Complete listening practice session component
 *
 * Manages:
 * - Session timing with pause/resume
 * - Audio playback with replay limits
 * - Question answering
 * - AI advisor feedback after each audio
 * - Auto-advance to next audio
 * - Session completion summary
 */
export function ListeningPracticeSession({
  taskId,
  initialSessionState,
  onSessionComplete,
  onExit,
}: ListeningPracticeSessionProps) {
  const [currentAudio, setCurrentAudio] = useState<AudioPackage | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [replaysRemaining, setReplaysRemaining] = useState(3);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [feedback, setFeedback] = useState<AdvisorFeedbackType | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingNextAudio, setIsLoadingNextAudio] = useState(false);

  const {
    sessionState,
    isRunning,
    isPaused,
    isComplete,
    elapsed,
    remaining,
    progress,
    pause,
    resume,
    submitAudio,
    canAutoAdvance,
    requestNextAudio,
    error: sessionError,
  } = useListeningSession({
    taskId,
    initialState: initialSessionState,
    onComplete: () => {
      console.log('[Session] Completed naturally');
      if (onSessionComplete) {
        onSessionComplete();
      }
    },
    onExpire: () => {
      console.log('[Session] Time expired');
    },
  });

  // Load initial audio
  useEffect(() => {
    if (sessionState.prefetchedAudios && sessionState.prefetchedAudios.length > 0) {
      const audio = sessionState.prefetchedAudios[sessionState.currentAudioIndex];
      setCurrentAudio(audio);
      setReplaysRemaining(audio.replayLimit || 3);
    }
  }, [sessionState.prefetchedAudios, sessionState.currentAudioIndex]);

  // Format time display
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle answer selection
  const handleAnswerChange = (questionId: string, answerId: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answerId,
    }));
  };

  // Handle audio replay
  const handleReplay = () => {
    if (replaysRemaining > 0) {
      setReplaysRemaining(prev => prev - 1);
      // TODO: Replay audio
      setIsAudioPlaying(true);
    }
  };

  // Handle submit audio
  const handleSubmitAudio = async () => {
    if (!currentAudio || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Prepare answers for submission
      const submissionAnswers = currentAudio.questions.map(q => ({
        questionId: q.id,
        question: q.question,
        correctAnswer: q.correctAnswer || '',
        selectedAnswer: answers[q.id] || null,
      }));

      // Submit and get feedback
      const result = await submitAudio(submissionAnswers, sessionState.currentAudioIndex);

      if (result.feedback) {
        setFeedback(result.feedback);
        setShowFeedback(true);
      }

      if (result.nextAudio) {
        // Auto-advance to next audio
        setCurrentAudio(result.nextAudio);
        setAnswers({});
        setReplaysRemaining(result.nextAudio.replayLimit || 3);
        setShowFeedback(false);
      } else {
        // No more audios - check if we can request a top-up
        if (canAutoAdvance && remaining > 5 * 60 * 1000) {
          setIsLoadingNextAudio(true);
          const nextResult = await requestNextAudio();
          setIsLoadingNextAudio(false);

          if (nextResult.ok && nextResult.audio) {
            setCurrentAudio(nextResult.audio);
            setAnswers({});
            setReplaysRemaining(nextResult.audio.replayLimit || 3);
            setShowFeedback(false);
          }
        }
      }
    } catch (err) {
      console.error('[Session] Submit error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show session summary if complete
  if (isComplete && sessionState.sessionResult) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <SessionSummary
          result={sessionState.sessionResult}
          onClose={() => {
            if (onSessionComplete) {
              onSessionComplete();
            }
          }}
        />
      </div>
    );
  }

  if (!currentAudio) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-indigo-600" />
          <p className="text-gray-600">Loading audio...</p>
        </div>
      </div>
    );
  }

  // Calculate how many questions are answered
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = currentAudio.questions.length;
  const allAnswered = answeredCount === totalQuestions;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header with session timer and controls */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-600" />
              <div>
                <div className="text-sm text-gray-500">Time Remaining</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatTime(remaining)}
                </div>
              </div>
            </div>

            <div className="h-12 w-px bg-gray-300" />

            <div>
              <div className="text-sm text-gray-500">Audio Progress</div>
              <div className="text-lg font-semibold text-gray-900">
                {sessionState.currentAudioIndex + 1} / {sessionState.prefetchedAudios?.length || 1}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isRunning ? (
              <Button
                onClick={pause}
                variant="outline"
                className="gap-2"
              >
                <Pause className="w-4 h-4" />
                Pause Session
              </Button>
            ) : isPaused ? (
              <Button
                onClick={resume}
                className="gap-2"
              >
                <Play className="w-4 h-4" />
                Resume Session
              </Button>
            ) : null}

            {onExit && (
              <Button
                onClick={onExit}
                variant="ghost"
              >
                Exit
              </Button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <Progress value={progress * 100} className="h-2" />
        </div>
      </div>

      {/* Show error if any */}
      {sessionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 text-sm">{sessionError}</p>
        </div>
      )}

      {/* Main content: Audio and Questions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Audio player section */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Audio {sessionState.currentAudioIndex + 1}
            </h3>
            {currentAudio.accent && (
              <span className="text-sm text-gray-600">
                {currentAudio.accent} Accent
              </span>
            )}
          </div>

          {/* Audio player */}
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-6">
            <div className="flex items-center justify-center mb-4">
              <Volume2 className="w-16 h-16 text-indigo-600" />
            </div>

            <audio
              controls
              className="w-full"
              src={currentAudio.audioUrl}
              onPlay={() => setIsAudioPlaying(true)}
              onPause={() => setIsAudioPlaying(false)}
              onEnded={() => setIsAudioPlaying(false)}
            >
              Your browser does not support the audio element.
            </audio>

            <div className="mt-4 text-center">
              <div className="text-sm text-gray-600 mb-2">
                Replays remaining: <span className="font-semibold">{replaysRemaining}</span>
              </div>
              <Button
                onClick={handleReplay}
                disabled={replaysRemaining === 0}
                variant="outline"
                size="sm"
              >
                Replay Audio
              </Button>
            </div>
          </div>

          {/* Feedback section */}
          {showFeedback && feedback && feedback.success && (
            <div className="mt-4">
              <AdvisorFeedback feedback={feedback} />
            </div>
          )}

          {/* Loading next audio */}
          {isLoadingNextAudio && (
            <div className="flex items-center justify-center gap-2 text-indigo-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Generating next audio...</span>
            </div>
          )}
        </div>

        {/* Questions section */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Questions</h3>
            <span className="text-sm text-gray-600">
              {answeredCount} / {totalQuestions} answered
            </span>
          </div>

          <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2">
            {currentAudio.questions.map((question, idx) => (
              <div
                key={question.id}
                className="border border-gray-200 rounded-lg p-4 space-y-3"
              >
                <div className="font-medium text-gray-900">
                  {idx + 1}. {question.question}
                </div>

                {question.options && (
                  <div className="space-y-2">
                    {question.options.map(option => (
                      <label
                        key={option.id}
                        className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={option.id}
                          checked={answers[question.id] === option.id}
                          onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                          className="w-4 h-4 text-indigo-600"
                        />
                        <span className="text-gray-700">{option.text}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Submit button */}
          <div className="pt-4 border-t border-gray-200">
            <Button
              onClick={handleSubmitAudio}
              disabled={!allAnswered || isSubmitting}
              className="w-full"
              size="lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Submitting...
                </>
              ) : (
                'Submit Answers'
              )}
            </Button>

            {!allAnswered && (
              <p className="text-sm text-gray-500 mt-2 text-center">
                Please answer all questions before submitting
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
