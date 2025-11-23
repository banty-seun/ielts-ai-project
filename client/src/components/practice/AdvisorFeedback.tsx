import React from 'react';
import { AdvisorFeedback as AdvisorFeedbackType } from '../../../../shared/schema';
import { Sparkles, TrendingUp, Lightbulb, Target } from 'lucide-react';

interface AdvisorFeedbackProps {
  feedback: AdvisorFeedbackType;
  className?: string;
}

/**
 * Displays AI advisor feedback in a friendly, structured format.
 *
 * Shows:
 * - Personalized praise
 * - Progress summary
 * - Actionable suggestion for next steps
 */
export function AdvisorFeedback({ feedback, className = '' }: AdvisorFeedbackProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Praise Section */}
      {feedback.praise && (
        <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex-shrink-0 mt-0.5">
            <Sparkles className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h4 className="font-semibold text-green-900 mb-1">Great work!</h4>
            <p className="text-green-800 text-sm">{feedback.praise}</p>
          </div>
        </div>
      )}

      {/* Progress Summary */}
      {feedback.progressSummary && (
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex-shrink-0 mt-0.5">
            <TrendingUp className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h4 className="font-semibold text-blue-900 mb-1">Your progress</h4>
            <p className="text-blue-800 text-sm">{feedback.progressSummary}</p>
          </div>
        </div>
      )}

      {/* Suggestion */}
      {feedback.suggestion && (
        <div className="flex items-start gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <div className="flex-shrink-0 mt-0.5">
            <Lightbulb className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h4 className="font-semibold text-purple-900 mb-1">Suggestion</h4>
            <p className="text-purple-800 text-sm">{feedback.suggestion}</p>
          </div>
        </div>
      )}

      {/* Next Task Preview (if provided) */}
      {feedback.nextTaskPreview && (
        <div className="flex items-start gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
          <div className="flex-shrink-0 mt-0.5">
            <Target className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h4 className="font-semibold text-indigo-900 mb-1">Up next</h4>
            <p className="text-indigo-800 text-sm">{feedback.nextTaskPreview}</p>
          </div>
        </div>
      )}
    </div>
  );
}
