import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { OnboardingProvider, useOnboarding } from '@/contexts/OnboardingContext';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { Rocket, Pencil, Target, Calendar, BarChart, Map, Globe, Clock, Sparkles, Phone, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { toast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { postWithAuth, postFreshWithAuth } from '@/lib/apiClient';

// Helper function to extract first name from full name
const getFirstName = (fullName: string): string => {
  if (!fullName) return '';
  // Split by space and take the first part as the first name
  return fullName.split(' ')[0];
};

// Step 1: Welcome Screen
function WelcomeStep() {
  const { onboardingData } = useOnboarding();

  return (
    <OnboardingCard
      title="Welcome to IELTS AI"
      description="Let's personalize your IELTS preparation plan for your Canadian immigration journey."
      icon={<Rocket className="w-10 h-10 text-gray-900" />}
    >
      <div className="flex-1 flex flex-col justify-center items-center text-center">
        <div className="my-8 pb-6">
          <p className="mb-4 text-gray-600">
            Our AI-powered platform will create a customized study plan based on your goals and needs.
          </p>
          <p className="mb-4 text-gray-600">
            Let's set up your profile in a few quick steps.
          </p>
        </div>
      </div>
    </OnboardingCard>
  );
}

// Step 2: Full Name and Phone Number Input
function FullNameStep() {
  const { onboardingData, dispatch, goToNextStep, goToPreviousStep } = useOnboarding();

  const [isNameValid, setIsNameValid] = React.useState(!!onboardingData.fullName.trim());
  const [isPhoneValid, setIsPhoneValid] = React.useState(false);

  // Check if the phone number is valid when component mounts
  React.useEffect(() => {
    if (onboardingData.phoneNumber) {
      import('react-phone-number-input').then(({ isValidPhoneNumber }) => {
        try {
          setIsPhoneValid(isValidPhoneNumber(onboardingData.phoneNumber));
        } catch (err) {
          setIsPhoneValid(false);
        }
      });
    }
  }, [onboardingData.phoneNumber]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Sanitize and trim input
    const newName = e.target.value.trim();
    dispatch({ type: 'SET_FULL_NAME', payload: newName });
    setIsNameValid(!!newName);
  };

  const handlePhoneChange = (value: string | undefined) => {
    // Store the full E.164 format with country code
    dispatch({ type: 'SET_PHONE_NUMBER', payload: value || '' });

    if (value) {
      import('react-phone-number-input').then(({ isValidPhoneNumber }) => {
        try {
          setIsPhoneValid(isValidPhoneNumber(value));
        } catch (err) {
          setIsPhoneValid(false);
        }
      });
    } else {
      setIsPhoneValid(false);
    }
  };

  const isFormValid = isNameValid && isPhoneValid;

  const handleContinue = () => {
    if (isFormValid) {
      // Temporarily log the data for testing/debugging
      console.log('Step 2 - Personal Information Data:', {
        fullName: onboardingData.fullName,
        phoneNumber: onboardingData.phoneNumber,
        phoneFormatValid: isPhoneValid
      });

      goToNextStep();
    } else {
      let errorMessage = "Please provide ";
      if (!isNameValid && !isPhoneValid) {
        errorMessage += "your full name and a valid phone number.";
      } else if (!isNameValid) {
        errorMessage += "your full name.";
      } else if (!isPhoneValid) {
        errorMessage += "a valid phone number.";
      }

      toast({
        title: "Required Fields",
        description: errorMessage,
      });
    }
  };

  const handleBack = () => {
    goToPreviousStep();
  };

  return (
    <OnboardingLayout 
      showBackButton={true}
      nextButtonDisabled={!isFormValid}
      onNext={handleContinue}
      onBack={handleBack}
    >
      <OnboardingCard
        title="Personal Information"
        description="Let's get to know you better for a personalized experience."
        icon={<Pencil className="w-10 h-10 text-gray-900" />}
      >
        <div className="mt-6 space-y-5">
          <div>
            <Label htmlFor="full-name" className="block mb-2 font-medium">
              Full Name <span className="text-black">*</span>
            </Label>
            <Input
              id="full-name"
              placeholder="Enter your full name"
              value={onboardingData.fullName}
              onChange={handleNameChange}
              className="w-full p-3 text-base"
            />
          </div>

          <div className="mt-5">
            <Label htmlFor="phone-number" className="block mb-2 font-medium">
              Phone Number <span className="text-black">*</span>
            </Label>
            <div className="phone-input-container">
              <PhoneInput
                international
                countryCallingCodeEditable={false}
                defaultCountry="CA"
                value={onboardingData.phoneNumber}
                onChange={handlePhoneChange}
                className="w-full"
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              We'll use this to send you important updates about your IELTS preparation.
            </p>
          </div>
        </div>
      </OnboardingCard>
    </OnboardingLayout>
  );
}

// Step 3: Target Band Score
function BandScoreStep() {
  const { onboardingData, dispatch, goToNextStep } = useOnboarding();

  // Update band score when slider changes
  const handleSliderChange = (value: number[]) => {
    dispatch({ type: 'SET_TARGET_BAND_SCORE', payload: value[0] });
  };

  // Log data when continuing to verify correctness
  const handleContinue = () => {
    // Temporarily log the data for testing/debugging
    console.log('Step 3 - Target Band Score Data:', {
      targetBandScore: onboardingData.targetBandScore,
    });
    goToNextStep();
  };

  return (
    <OnboardingCard
      title="Target Band Score"
      description="What overall IELTS band score are you aiming for?"
      icon={<Target className="w-10 h-10 text-gray-900" />}
    >
      <div className="mt-8">
        <div className="mb-6">
          <div className="text-center mb-4">
            <span className="text-4xl font-semibold">{onboardingData.targetBandScore.toFixed(1)}</span>
          </div>
          <Slider
            value={[onboardingData.targetBandScore]}
            min={5}
            max={9}
            step={0.5}
            onValueChange={handleSliderChange}
            className="w-full"
          />
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>5.0</span>
            <span>6.0</span>
            <span>7.0</span>
            <span>8.0</span>
            <span>9.0</span>
          </div>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-md">
          <p className="text-sm text-gray-600">
            <strong>Canadian Immigration:</strong> Most programs require scores between 6.0-7.0
          </p>
        </div>
      </div>
    </OnboardingCard>
  );
}

// Step 4: Test Date Picker
function TestDateStep() {
  const { onboardingData, dispatch } = useOnboarding();
  const [date, setDate] = React.useState<Date | null>(onboardingData.testDate);
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false);
  const calendarRef = React.useRef<HTMLDivElement>(null);

  const handleDateChange = (date: Date | undefined) => {
    setDate(date || null);
    dispatch({ type: 'SET_TEST_DATE', payload: date || null });
    setIsCalendarOpen(false);
  };

  const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    if (inputValue) {
      try {
        // Try to parse the date using our custom function for DD/MM/YYYY format
        const parsedDate = parseDateFromInput(inputValue);
        // Check if it's a valid date
        if (parsedDate && !isNaN(parsedDate.getTime())) {
          setDate(parsedDate);
          dispatch({ type: 'SET_TEST_DATE', payload: parsedDate });
        }
      } catch (error) {
        // If date parsing fails, ignore
        console.error("Error parsing date:", error);
      }
    } else {
      setDate(null);
      dispatch({ type: 'SET_TEST_DATE', payload: null });
    }
  };

  const handleNotDecidedChange = (checked: boolean) => {
    dispatch({ type: 'SET_NOT_DECIDED', payload: checked });
    if (checked) {
      setDate(null);
      dispatch({ type: 'SET_TEST_DATE', payload: null });
    }
  };

  const formatDateForInput = (date: Date | null): string => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
  };

  // Parse a DD/MM/YYYY date to a Date object
  const parseDateFromInput = (dateString: string): Date | null => {
    if (!dateString) return null;

    // Check if it matches the DD/MM/YYYY pattern
    const parts = dateString.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // JavaScript months are 0-based
      const year = parseInt(parts[2], 10);

      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  };

  // Handle click outside to close the calendar
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    }

    // Add event listener when calendar is open
    if (isCalendarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    // Clean up
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCalendarOpen]);

  return (
    <OnboardingCard
      title="When is your IELTS test?"
      description="We'll customize your preparation timeline."
      icon={<Calendar className="w-10 h-10 text-gray-900" />}
    >
      <div className="mt-6">
        {/* Date Input Field First */}
        <div className="mb-6">
          <div className="relative">
            <Label htmlFor="test-date" className="block mb-2 font-medium">
              Select your IELTS test date:
            </Label>
            <div 
              className={`relative flex items-center border rounded-md overflow-hidden ${onboardingData.notDecided ? 'opacity-60 bg-gray-50' : 'border-gray-300'}`}
              onClick={() => !onboardingData.notDecided && setIsCalendarOpen(true)}
              role="button"
              tabIndex={onboardingData.notDecided ? -1 : 0}
            >
              {/* Calendar Icon on Left */}
              <div className="p-3 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-gray-500" />
              </div>

              {/* Text input on Right */}
              <input
                id="test-date"
                type="text"
                placeholder="DD/MM/YYYY"
                value={!onboardingData.notDecided ? formatDateForInput(date) : ""}
                onChange={handleDateInputChange}
                className="flex-1 p-3 text-base border-none focus:outline-none focus:ring-0 bg-transparent"
                disabled={onboardingData.notDecided}
              />
            </div>

            {isCalendarOpen && !onboardingData.notDecided && (
              <div 
                ref={calendarRef}
                className="absolute z-50 mt-1 bg-white border rounded-md shadow-lg"
              >
                <CalendarComponent
                  mode="single"
                  selected={date || undefined}
                  onSelect={handleDateChange}
                  disabled={(date) => date < new Date()}
                  className="rounded-md border"
                />
              </div>
            )}
          </div>

          {date && !onboardingData.notDecided && (
            <div className="mt-4 p-4 bg-gray-50 rounded-md">
              <p className="text-sm text-gray-600">
                <strong>Selected date:</strong> {date.toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </p>
            </div>
          )}
        </div>

        {/* Checkbox After */}
        <div className="mt-6 flex items-center">
          <Checkbox 
            id="not-decided" 
            checked={onboardingData.notDecided}
            onCheckedChange={handleNotDecidedChange}
          />
          <Label htmlFor="not-decided" className="ml-2">
            I haven't decided on a test date yet
          </Label>
        </div>

        {onboardingData.notDecided && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md">
            <p className="text-sm text-gray-600">
              No problem! We'll create a general preparation plan that you can adjust later.
            </p>
          </div>
        )}
      </div>
    </OnboardingCard>
  );
}

// Step 5: Skills Self-Rating
function SkillRatingStep() {
  const { onboardingData, dispatch } = useOnboarding();

  const handleSkillChange = (skill: keyof typeof onboardingData.skillRatings, value: number) => {
    dispatch({
      type: 'SET_SKILL_RATING',
      payload: { skill, value }
    });
  };

  const skills = [
    { name: 'listening', label: 'Listening', icon: '🎧' },
    { name: 'reading', label: 'Reading', icon: '📚' },
    { name: 'writing', label: 'Writing', icon: '✍️' },
    { name: 'speaking', label: 'Speaking', icon: '🗣️' }
  ];

  return (
    <OnboardingCard
      title="Rate Your IELTS Skills"
      description="How would you rate your current abilities in each skill?"
      icon={<BarChart className="w-10 h-10 text-gray-900" />}
    >
      <div className="mt-6 space-y-5">
        {skills.map((skill) => (
          <div key={skill.name} className="mb-4">
            <div className="flex items-center mb-2">
              <span className="mr-2">{skill.icon}</span>
              <Label className="font-medium">{skill.label}</Label>
            </div>
            <div className="flex items-center">
              <Slider 
                value={[onboardingData.skillRatings[skill.name as keyof typeof onboardingData.skillRatings]]}
                min={0}
                max={9}
                step={1}
                onValueChange={(value) => handleSkillChange(
                  skill.name as keyof typeof onboardingData.skillRatings, 
                  value[0]
                )}
                className="flex-1 mr-3"
              />
              <span className="w-8 text-center font-medium">
                {onboardingData.skillRatings[skill.name as keyof typeof onboardingData.skillRatings]}
              </span>
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-500">
              <span>Beginner</span>
              <span>Advanced</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded-md">
        <p className="text-sm text-gray-600">
          <strong>Tip:</strong> Rate yourself honestly to help us customize your study plan. 
          A rating of 0 indicates beginner level, while 9 indicates advanced proficiency.
        </p>
      </div>
    </OnboardingCard>
  );
}

// Step 6: Immigration Goal
function ImmigrationGoalStep() {
  const { onboardingData, dispatch } = useOnboarding();

  // Handle selection and deselection
  const handleSelect = (value: typeof onboardingData.immigrationGoal) => {
    // If the same value is clicked again, allow deselection
    if (onboardingData.immigrationGoal === value) {
      dispatch({ type: 'SET_IMMIGRATION_GOAL', payload: null });
    } else {
      dispatch({ type: 'SET_IMMIGRATION_GOAL', payload: value });
    }
  };

  const options = [
    { value: 'pr', label: 'Permanent Residence', description: 'Express Entry, Provincial Nominee, etc.' },
    { value: 'study', label: 'Study Permit', description: 'College or university education in Canada' },
    { value: 'work', label: 'Work Permit', description: 'Temporary work in Canada' },
    { value: 'family', label: 'Family Sponsorship', description: 'Joining family members in Canada' }
  ];

  return (
    <OnboardingCard
      title="Your Immigration Goal"
      description="What's your primary reason for taking the IELTS?"
      icon={<Map className="w-10 h-10 text-gray-900" />}
    >
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        {options.map((option) => (
          <div
            key={option.value}
            className={`
              border rounded-lg p-5 cursor-pointer transition-all duration-200
              ${onboardingData.immigrationGoal === option.value 
                ? 'border-black bg-gray-50 shadow-sm transform scale-[1.02]' 
                : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
              }
            `}
            onClick={() => handleSelect(option.value as typeof onboardingData.immigrationGoal)}
            role="button"
            tabIndex={0}
            aria-pressed={onboardingData.immigrationGoal === option.value}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSelect(option.value as typeof onboardingData.immigrationGoal);
              }
            }}
          >
            <div className="font-medium mb-2 text-lg">{option.label}</div>
            <div className="text-sm text-gray-600">{option.description}</div>
          </div>
        ))}
      </div>

      {/* Guidance text */}
      <div className="mt-6 p-4 bg-gray-50 rounded-md">
        <p className="text-sm text-gray-600">
          <strong>Note:</strong> Your IELTS score requirements may vary based on your immigration pathway. 
          We'll tailor your preparation accordingly.
        </p>
      </div>
    </OnboardingCard>
  );
}

// Note: Accent Preference step was removed and will be implemented later as a dynamic setting in the Listening module

// Step 7: Study Preferences (formerly Step 8)
function StudyPreferencesStep() {
  const { onboardingData, dispatch } = useOnboarding();

  const handleCommitmentChange = (value: string) => {
    dispatch({ 
      type: 'SET_STUDY_PREFERENCE', 
      payload: { 
        preference: 'dailyCommitment', 
        value: value as typeof onboardingData.studyPreferences.dailyCommitment 
      } 
    });
  };

  const handleScheduleChange = (value: string) => {
    dispatch({ 
      type: 'SET_STUDY_PREFERENCE', 
      payload: { 
        preference: 'schedule', 
        value: value as typeof onboardingData.studyPreferences.schedule 
      } 
    });
  };

  const handleStyleChange = (value: string) => {
    dispatch({ 
      type: 'SET_STUDY_PREFERENCE', 
      payload: { 
        preference: 'style', 
        value: value as typeof onboardingData.studyPreferences.style 
      } 
    });
  };

  return (
    <OnboardingCard
      title="Study Preferences"
      description="Let's customize your learning experience."
      icon={<Clock className="w-10 h-10 text-gray-900" />}
    >
      <div className="mt-6 space-y-8">
        {/* Daily Commitment */}
        <div>
          <Label className="text-base font-medium mb-3 block">Daily time commitment: <span className="text-sm text-gray-500 ml-1">(required)</span></Label>
          <RadioGroup
            value={onboardingData.studyPreferences.dailyCommitment || ''}
            onValueChange={handleCommitmentChange}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="30mins" id="30mins" />
              <Label htmlFor="30mins">30 minutes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="1hour" id="1hour" />
              <Label htmlFor="1hour">1 hour</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="2hours+" id="2hours+" />
              <Label htmlFor="2hours+">2+ hours</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Schedule Preference */}
        <div>
          <Label className="text-base font-medium mb-3 block">Preferred study schedule: <span className="text-sm text-gray-500 ml-1">(required)</span></Label>
          <RadioGroup
            value={onboardingData.studyPreferences.schedule || ''}
            onValueChange={handleScheduleChange}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="weekday" id="weekday" />
              <Label htmlFor="weekday">Weekdays</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="weekend" id="weekend" />
              <Label htmlFor="weekend">Weekends</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="both" id="both" />
              <Label htmlFor="both">Both</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Learning Style */}
        <div>
          <Label className="text-base font-medium mb-3 block">Learning style: <span className="text-sm text-gray-500 ml-1">(required)</span></Label>
          <RadioGroup
            value={onboardingData.studyPreferences.style || ''}
            onValueChange={handleStyleChange}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="ai-guided" id="ai-guided" />
              <Label htmlFor="ai-guided">AI-guided (recommended)</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="self-paced" id="self-paced" />
              <Label htmlFor="self-paced">Self-paced</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="mixed" id="mixed" />
              <Label htmlFor="mixed">Mixed</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Guidance text */}
        <div className="mt-6 p-4 bg-gray-50 rounded-md">
          <p className="text-sm text-gray-600">
            <strong>Note:</strong> All three preferences are required to create your personalized study plan. This helps us tailor your IELTS preparation experience specifically for your Canadian immigration journey.
          </p>
        </div>
      </div>
    </OnboardingCard>
  );
}

// Step 8: Summary and Confirmation
function SummaryStep() {
  const { onboardingData, resetOnboarding } = useOnboarding();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Get Firebase token for authenticated API requests
  const { getToken } = useFirebaseAuthContext();
  const queryClient = useQueryClient();

  // Prevent accidental navigation away
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const message = "Your personalized IELTS plan is being prepared. Are you sure you want to leave?";
      e.preventDefault();
      e.returnValue = message;
      return message;
    };

    // Only add the listener when we're on this step
    if (onboardingData.currentStep === onboardingData.totalSteps) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [onboardingData.currentStep, onboardingData.totalSteps]);

  // Format date for display
  const formatDate = (date: Date | null) => {
    if (!date) return "Not specified";
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  // Get readable label for immigration goal
  const getImmigrationGoalLabel = () => {
    switch (onboardingData.immigrationGoal) {
      case 'pr': return 'Permanent Residence';
      case 'study': return 'Study Permit';
      case 'work': return 'Work Permit';
      case 'family': return 'Family Sponsorship';
      default: return 'Not specified';
    }
  };

  // Get readable label for study schedule
  const getScheduleLabel = () => {
    switch (onboardingData.studyPreferences.schedule) {
      case 'weekday': return 'Weekdays';
      case 'weekend': return 'Weekends';
      case 'both': return 'Both weekdays and weekends';
      default: return 'Not specified';
    }
  };

  // Get readable label for learning style
  const getLearningStyleLabel = () => {
    switch (onboardingData.studyPreferences.style) {
      case 'ai-guided': return 'AI-guided';
      case 'self-paced': return 'Self-paced';
      case 'mixed': return 'Mixed approach';
      default: return 'Not specified';
    }
  };

  // Handle form submission and AI plan generation
  const handleGeneratePlan = async () => {
    try {
      setIsSubmitting(true);

      // Validate required fields before submission
      if (!onboardingData.fullName || onboardingData.fullName.trim().length < 2) {
        throw new Error("Please provide your full name");
      }

      if (onboardingData.targetBandScore < 5 || onboardingData.targetBandScore > 9) {
        throw new Error("Target band score must be between 5 and 9");
      }

      if (!onboardingData.immigrationGoal) {
        throw new Error("Please select your immigration goal");
      }

      if (!onboardingData.studyPreferences.dailyCommitment || 
          !onboardingData.studyPreferences.schedule || 
          !onboardingData.studyPreferences.style) {
        throw new Error("Please complete all study preference selections");
      }

      // Sanitize data for safe transmission
      const sanitizedData = {
        fullName: onboardingData.fullName.trim(),
        phoneNumber: onboardingData.phoneNumber || "", // Ensure not null/undefined
        targetBandScore: onboardingData.targetBandScore,
        // Handle test date - CRITICAL FIX: Need to send Date object, not string
        testDate: onboardingData.notDecided ? null : 
                  (onboardingData.testDate) ? 
                    (onboardingData.testDate instanceof Date ? 
                      onboardingData.testDate : new Date(onboardingData.testDate)) : null,
        notDecided: onboardingData.notDecided,
        skillRatings: {
          listening: onboardingData.skillRatings.listening,
          reading: onboardingData.skillRatings.reading,
          writing: onboardingData.skillRatings.writing,
          speaking: onboardingData.skillRatings.speaking
        },
        immigrationGoal: onboardingData.immigrationGoal,
        studyPreferences: {
          dailyCommitment: onboardingData.studyPreferences.dailyCommitment,
          schedule: onboardingData.studyPreferences.schedule,
          style: onboardingData.studyPreferences.style
        }
      };

      console.log('Generating AI plan with user data:', JSON.stringify(sanitizedData, null, 2));

      // Step 1: Generate the IELTS study plan using Firebase authenticated API request
      interface PlanResponse {
        planId?: string;
        success: boolean;
        message: string;
      }
      
      // Use postFreshWithAuth with Firebase token to ensure fresh authentication
      const planData = await postFreshWithAuth<PlanResponse>(
        '/api/plan/generate', 
        sanitizedData,
        getToken // Pass the getToken function from Firebase context
      );
      
      console.log('Plan generated successfully:', planData);

      // Save plan ID to local storage for future reference
      if (planData.planId) {
        localStorage.setItem('ielts_study_plan_id', planData.planId);
      }

      // Step 2: Mark onboarding as completed in the database using Firebase auth
      try {
        // Use postFreshWithAuth to get a fresh token before making the request
        const onboardingResponse = await postFreshWithAuth(
          '/api/firebase/auth/complete-onboarding',
          {}, // No body needed for this request
          getToken // Pass the getToken function from Firebase context
        );
        
        console.log('Onboarding marked as completed in database:', onboardingResponse);
        
        // Invalidate query caches to force a refetch of updated data
        queryClient.invalidateQueries({ queryKey: ['/api/auth/onboarding-status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/firebase/auth/onboarding-status'] });
        queryClient.invalidateQueries({ queryKey: [`/api/weekly-plan/`] });
        queryClient.invalidateQueries({ queryKey: [`/api/firebase/weekly-plan/`] });
      } catch (onboardingError) {
        console.error('Error marking onboarding as completed:', onboardingError);
        // Continue the flow even if this fails - we don't want to block the user
      }

      // Navigation would happen after successful API response
      toast({
        title: "Success!",
        description: "Your personalized IELTS study plan has been created.",
        variant: "default",
      });

      // Redirect to dashboard after success message
      setTimeout(() => {
        setLocation('/dashboard'); 
      }, 2000);

    } catch (error: any) {
      // Enhanced error logging
      console.error('Error generating study plan:', error);
      if (error.response) {
        console.error('Response error details:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
      }
      
      // Show user-friendly error message
      toast({
        title: "Error",
        description: error.message || "There was a problem creating your study plan. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const firstName = getFirstName(onboardingData.fullName);
  const personalizedTitle = firstName ? `${firstName}'s IELTS Plan` : "Your IELTS Preparation Plan";
  const personalizedDescription = firstName 
    ? `Let's review your preferences, ${firstName}.` 
    : "Review your preferences before we create your personalized plan.";

  return (
    <OnboardingCard
      title={personalizedTitle}
      description={personalizedDescription}
      icon={<Sparkles className="w-10 h-10 text-gray-900" />}
    >
      <div className="mt-6 space-y-4">
        <Card className="p-4 border-gray-200">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-gray-500 text-sm">Name:</div>
              <div className="col-span-2 font-medium">{onboardingData.fullName || "Not provided"}</div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-gray-500 text-sm">Phone Number:</div>
              <div className="col-span-2 font-medium">{onboardingData.phoneNumber || "Not provided"}</div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-gray-500 text-sm">Target Score:</div>
              <div className="col-span-2 font-medium">{onboardingData.targetBandScore.toFixed(1)}</div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-gray-500 text-sm">Test Date:</div>
              <div className="col-span-2 font-medium">
                {onboardingData.notDecided ? "Not decided yet" : formatDate(onboardingData.testDate)}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-gray-500 text-sm">Immigration Goal:</div>
              <div className="col-span-2 font-medium">{getImmigrationGoalLabel()}</div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-gray-500 text-sm">Daily Study Time:</div>
              <div className="col-span-2 font-medium">
                {onboardingData.studyPreferences.dailyCommitment === "30mins" && "30 minutes daily"}
                {onboardingData.studyPreferences.dailyCommitment === "1hour" && "1 hour daily"}
                {onboardingData.studyPreferences.dailyCommitment === "2hours+" && "2+ hours daily"}
                {!onboardingData.studyPreferences.dailyCommitment && "Not specified"}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-gray-500 text-sm">Study Schedule:</div>
              <div className="col-span-2 font-medium">{getScheduleLabel()}</div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-gray-500 text-sm">Learning Style:</div>
              <div className="col-span-2 font-medium">{getLearningStyleLabel()}</div>
            </div>
          </div>
        </Card>

        <div className="mt-6 p-4 bg-gray-50 rounded-md">
          <p className="text-sm text-gray-600">
            <strong>Next Step:</strong> {firstName 
              ? `${firstName}, we'll use this information to create your personalized IELTS study plan focused on Canadian immigration requirements.` 
              : `We'll use this information to create your personalized IELTS study plan focused on Canadian immigration requirements.`
            }
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <Button 
            size="lg" 
            onClick={handleGeneratePlan}
            disabled={isSubmitting}
            className="w-full md:w-auto px-8"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Building Your Plan...
              </>
            ) : (
              "Build My Plan"
            )}
          </Button>
        </div>
      </div>
    </OnboardingCard>
  );
}

// Step Components Array
const STEP_COMPONENTS = [
  WelcomeStep,
  FullNameStep,
  BandScoreStep,
  TestDateStep,
  SkillRatingStep,
  ImmigrationGoalStep,
  StudyPreferencesStep,
  SummaryStep
];

// Main Onboarding Container Component
function OnboardingContainer() {
  const { onboardingData, goToNextStep, goToPreviousStep } = useOnboarding();
  const CurrentStepComponent = STEP_COMPONENTS[onboardingData.currentStep - 1];

  // Check if we're on the last step to customize button text
  const isLastStep = onboardingData.currentStep === onboardingData.totalSteps;
  const buttonText = isLastStep ? "Build My Plan" : "Continue";

  // Special cases for steps with custom handlers
  if (onboardingData.currentStep === 2) {
    return <CurrentStepComponent />;
  }

  // Custom handler for BandScoreStep (Step 3)
  if (onboardingData.currentStep === 3) {
    return (
      <OnboardingLayout 
        showBackButton={true}
        nextButtonText={buttonText}
        onNext={() => {
          // Log data for verification
          console.log('Step 3 - Target Band Score Data:', {
            targetBandScore: onboardingData.targetBandScore,
          });
          goToNextStep();
        }}
        onBack={goToPreviousStep}
      >
        <CurrentStepComponent />
      </OnboardingLayout>
    );
  }

  // Custom handler for TestDateStep (Step 4)
  if (onboardingData.currentStep === 4) {
    return (
      <OnboardingLayout 
        showBackButton={true}
        nextButtonText={buttonText}
        // Only enable Continue if either a date is selected or "not decided" is checked
        nextButtonDisabled={!onboardingData.testDate && !onboardingData.notDecided}
        onNext={() => {
          // Log data for verification
          console.log('Step 4 - Test Date Data:', {
            testDate: onboardingData.testDate ? new Date(onboardingData.testDate).toLocaleDateString() : null,
            notDecided: onboardingData.notDecided
          });
          goToNextStep();
        }}
        onBack={goToPreviousStep}
      >
        <CurrentStepComponent />
      </OnboardingLayout>
    );
  }

  // Custom handler for SkillRatingStep (Step 5)
  if (onboardingData.currentStep === 5) {
    return (
      <OnboardingLayout 
        showBackButton={true}
        nextButtonText={buttonText}
        // No validation required for this step - allow proceeding with any values
        onNext={() => {
          // Log data for verification
          console.log('Step 5 - Skill Ratings Data:', {
            skillRatings: onboardingData.skillRatings
          });
          goToNextStep();
        }}
        onBack={goToPreviousStep}
      >
        <CurrentStepComponent />
      </OnboardingLayout>
    );
  }

  // Custom handler for ImmigrationGoalStep (Step 6)
  if (onboardingData.currentStep === 6) {
    return (
      <OnboardingLayout 
        showBackButton={true}
        nextButtonText={buttonText}
        // Require selection before continuing
        nextButtonDisabled={!onboardingData.immigrationGoal}
        onNext={() => {
          // Log data for verification
          console.log('Step 6 - Immigration Goal Data:', {
            immigrationGoal: onboardingData.immigrationGoal
          });
          goToNextStep();
        }}
        onBack={goToPreviousStep}
      >
        <CurrentStepComponent />
      </OnboardingLayout>
    );
  }

  // Custom handler for StudyPreferencesStep (Step 7)
  if (onboardingData.currentStep === 7) {
    // Check if all three study preferences are set
    const allPreferencesSet = 
      !!onboardingData.studyPreferences.dailyCommitment && 
      !!onboardingData.studyPreferences.schedule && 
      !!onboardingData.studyPreferences.style;

    return (
      <OnboardingLayout 
        showBackButton={true}
        nextButtonText={buttonText}
        // Enable Continue only if all three preferences are set
        nextButtonDisabled={!allPreferencesSet}
        onNext={() => {
          // Log data for verification
          console.log('Step 7 - Study Preferences Data:', {
            studyPreferences: onboardingData.studyPreferences,
            dailyCommitment: onboardingData.studyPreferences.dailyCommitment,
            schedule: onboardingData.studyPreferences.schedule,
            style: onboardingData.studyPreferences.style,
            allSet: allPreferencesSet
          });
          goToNextStep();
        }}
        onBack={goToPreviousStep}
      >
        <CurrentStepComponent />
      </OnboardingLayout>
    );
  }

  // Custom handler for SummaryStep (Step 8)
  if (onboardingData.currentStep === 8) {
    return (
      <OnboardingLayout 
        showBackButton={true}
        showNextButton={false} // Hide the default next button as we have our own button in the component
        onBack={goToPreviousStep}
      >
        <CurrentStepComponent />
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout 
      showBackButton={onboardingData.currentStep > 1}
      nextButtonText={buttonText}
      onNext={goToNextStep}
      onBack={goToPreviousStep}
    >
      <CurrentStepComponent />
    </OnboardingLayout>
  );
}

// Main Onboarding Page Component
export default function Onboarding() {
  return (
    <OnboardingProvider>
      <OnboardingContainer />
    </OnboardingProvider>
  );
}