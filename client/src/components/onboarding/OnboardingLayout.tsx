import React, { ReactNode } from 'react';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight } from 'lucide-react';

interface OnboardingLayoutProps {
  children: ReactNode;
  showBackButton?: boolean;
  showNextButton?: boolean;
  nextButtonText?: string;
  nextButtonDisabled?: boolean;
  onNext?: () => void;
  onBack?: () => void;
}

export function OnboardingLayout({
  children,
  showBackButton = true,
  showNextButton = true,
  nextButtonText = 'Continue',
  nextButtonDisabled = false,
  onNext,
  onBack,
}: OnboardingLayoutProps) {
  const { onboardingData, goToNextStep, goToPreviousStep } = useOnboarding();
  const { currentStep, totalSteps } = onboardingData;

  const handleNext = () => {
    if (onNext) {
      onNext();
    } else {
      goToNextStep();
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      goToPreviousStep();
    }
  };

  // Calculate progress percentage
  const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Progress bar and step indicator */}
      <div className="fixed top-0 left-0 right-0 z-10 bg-white border-b border-gray-100 pt-4 px-4">
        <div className="max-w-md mx-auto w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">
              Step {currentStep} of {totalSteps}
            </span>
            <span className="text-xs font-medium text-gray-500">
              {Math.round(progressPercentage)}% Complete
            </span>
          </div>
          <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-black transition-all duration-300 ease-in-out"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 pt-16 pb-24 flex flex-col overflow-y-auto">
        <div className="max-w-md mx-auto w-full px-4 py-6 flex flex-col flex-1">
          {children}
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100">
        <div className="max-w-md mx-auto w-full flex justify-between items-center">
          {showBackButton && currentStep > 1 ? (
            <Button
              variant="ghost"
              onClick={handleBack}
              className="flex items-center text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          ) : (
            <div></div>
          )}

          {showNextButton && (
            <Button
              onClick={handleNext}
              disabled={nextButtonDisabled}
              className="font-medium bg-black hover:bg-gray-800 text-white flex items-center"
            >
              {nextButtonText}
              {currentStep < totalSteps && (
                <ArrowRight className="w-4 h-4 ml-1" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}