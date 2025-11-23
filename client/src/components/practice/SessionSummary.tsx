import React from 'react';
import { SessionResult } from '../../../../shared/schema';
import { Trophy, Clock, Target, TrendingUp, CheckCircle2 } from 'lucide-react';

interface SessionSummaryProps {
  result: SessionResult;
  className?: string;
  onClose?: () => void;
}

/**
 * Displays a comprehensive summary of a completed listening session.
 *
 * Shows:
 * - Overall score and performance
 * - Time spent
 * - Per-audio breakdown
 * - AI advisor highlights
 */
export function SessionSummary({ result, className = '', onClose }: SessionSummaryProps) {
  const scorePercent = Math.round(result.scoreOverall * 100);
  const timeSpentMin = Math.floor(result.usedMs / 60000);
  const timeSpentSec = Math.floor((result.usedMs % 60000) / 1000);

  // Calculate total questions
  const totalQuestions = result.audios.reduce((sum, audio) => sum + audio.total, 0);
  const totalCorrect = result.audios.reduce((sum, audio) => sum + audio.correct, 0);

  // Determine performance level for color coding
  const getPerformanceColor = (percent: number) => {
    if (percent >= 80) return 'text-green-600';
    if (percent >= 60) return 'text-blue-600';
    if (percent >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const performanceColor = getPerformanceColor(scorePercent);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with overall score */}
      <div className="text-center p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-200">
        <div className="flex justify-center mb-4">
          <div className={`p-4 rounded-full bg-white shadow-md`}>
            <Trophy className={`w-12 h-12 ${performanceColor}`} />
          </div>
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">
          Session Complete!
        </h2>
        <div className="text-5xl font-bold mb-2">
          <span className={performanceColor}>{scorePercent}%</span>
        </div>
        <p className="text-gray-700">
          {totalCorrect} out of {totalQuestions} questions correct
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <Clock className="w-6 h-6 text-blue-600 flex-shrink-0" />
          <div>
            <div className="text-sm text-blue-700 font-medium">Time Spent</div>
            <div className="text-lg font-bold text-blue-900">
              {timeSpentMin}m {timeSpentSec}s
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <Target className="w-6 h-6 text-purple-600 flex-shrink-0" />
          <div>
            <div className="text-sm text-purple-700 font-medium">Audios Completed</div>
            <div className="text-lg font-bold text-purple-900">
              {result.audios.length}
            </div>
          </div>
        </div>
      </div>

      {/* Per-audio breakdown */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Performance Breakdown
        </h3>
        <div className="space-y-2">
          {result.audios.map((audio, idx) => {
            const audioPercent = audio.total > 0 ? Math.round((audio.correct / audio.total) * 100) : 0;
            const audioColor = getPerformanceColor(audioPercent);

            return (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    <CheckCircle2 className={`w-5 h-5 ${audioColor}`} />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">
                      Audio {idx + 1}
                    </div>
                    <div className="text-sm text-gray-600">
                      {audio.correct}/{audio.total} correct
                    </div>
                  </div>
                </div>
                <div className={`text-2xl font-bold ${audioColor}`}>
                  {audioPercent}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Advisor highlights */}
      {result.advisorHighlights && result.advisorHighlights.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Key Takeaways
          </h3>
          <div className="space-y-2">
            {result.advisorHighlights.map((highlight, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg"
              >
                <div className="flex-shrink-0 mt-0.5">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
                <p className="text-sm text-green-800">{highlight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-colors"
        >
          Continue
        </button>
      )}
    </div>
  );
}
