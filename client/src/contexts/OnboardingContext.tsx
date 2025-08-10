import React, { createContext, useContext, useReducer, ReactNode } from 'react';

// Define the onboarding data structure
export interface OnboardingData {
  // Step 2: Full Name and Phone Number
  fullName: string;
  phoneNumber: string;
  
  // Step 3: Target Band Score
  targetBandScore: number;
  
  // Step 4: Test Date
  testDate: Date | null;
  notDecided: boolean;
  
  // Step 5: Skill Self-Rating
  skillRatings: {
    listening: number;
    reading: number;
    writing: number;
    speaking: number;
  };
  
  // Step 6: Immigration Goal
  immigrationGoal: 'pr' | 'study' | 'work' | 'family' | null;
  
  // Step 7: Study Preferences (formerly Step 8)
  studyPreferences: {
    dailyCommitment: '30mins' | '1hour' | '2hours+' | null;
    schedule: 'weekday' | 'weekend' | 'both' | null;
    style: 'ai-guided' | 'self-paced' | 'mixed' | null;
  };
  
  // Current step tracking
  currentStep: number;
  totalSteps: number;
}

// Define the initial state
const initialOnboardingData: OnboardingData = {
  fullName: '',
  phoneNumber: '',
  targetBandScore: 7.0,
  testDate: null,
  notDecided: false,
  skillRatings: {
    listening: 0,
    reading: 0,
    writing: 0,
    speaking: 0
  },
  immigrationGoal: null,
  studyPreferences: {
    dailyCommitment: null,
    schedule: null,
    style: null
  },
  currentStep: 1,
  totalSteps: 8 // Updated from 9 to 8 steps
};

// Define action types
type ActionType = 
  | { type: 'SET_FULL_NAME'; payload: string }
  | { type: 'SET_PHONE_NUMBER'; payload: string }
  | { type: 'SET_TARGET_BAND_SCORE'; payload: number }
  | { type: 'SET_TEST_DATE'; payload: Date | null }
  | { type: 'SET_NOT_DECIDED'; payload: boolean }
  | { type: 'SET_SKILL_RATING'; payload: { skill: keyof OnboardingData['skillRatings']; value: number } }
  | { type: 'SET_IMMIGRATION_GOAL'; payload: OnboardingData['immigrationGoal'] }
  | { type: 'SET_STUDY_PREFERENCE'; payload: { preference: keyof OnboardingData['studyPreferences']; value: any } }
  | { type: 'GO_TO_NEXT_STEP' }
  | { type: 'GO_TO_PREVIOUS_STEP' }
  | { type: 'GO_TO_STEP'; payload: number }
  | { type: 'RESET_ONBOARDING' };

// Create the reducer
function onboardingReducer(state: OnboardingData, action: ActionType): OnboardingData {
  switch (action.type) {
    case 'SET_FULL_NAME':
      return { ...state, fullName: action.payload };
      
    case 'SET_PHONE_NUMBER':
      return { ...state, phoneNumber: action.payload };
    
    case 'SET_TARGET_BAND_SCORE':
      return { ...state, targetBandScore: action.payload };
    
    case 'SET_TEST_DATE':
      return { ...state, testDate: action.payload };
    
    case 'SET_NOT_DECIDED':
      return { ...state, notDecided: action.payload, testDate: action.payload ? null : state.testDate };
    
    case 'SET_SKILL_RATING':
      return { 
        ...state, 
        skillRatings: {
          ...state.skillRatings,
          [action.payload.skill]: action.payload.value
        }
      };
    
    case 'SET_IMMIGRATION_GOAL':
      return { ...state, immigrationGoal: action.payload };
    
    case 'SET_STUDY_PREFERENCE':
      return { 
        ...state, 
        studyPreferences: {
          ...state.studyPreferences,
          [action.payload.preference]: action.payload.value
        }
      };
    
    case 'GO_TO_NEXT_STEP':
      return { 
        ...state, 
        currentStep: Math.min(state.currentStep + 1, state.totalSteps) 
      };
    
    case 'GO_TO_PREVIOUS_STEP':
      return { 
        ...state, 
        currentStep: Math.max(state.currentStep - 1, 1) 
      };
    
    case 'GO_TO_STEP':
      return { 
        ...state, 
        currentStep: Math.max(1, Math.min(action.payload, state.totalSteps)) 
      };
    
    case 'RESET_ONBOARDING':
      return initialOnboardingData;
    
    default:
      return state;
  }
}

// Create the context
interface OnboardingContextType {
  onboardingData: OnboardingData;
  dispatch: React.Dispatch<ActionType>;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  goToStep: (step: number) => void;
  resetOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

// Create the provider component
interface OnboardingProviderProps {
  children: ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const [onboardingData, dispatch] = useReducer(onboardingReducer, initialOnboardingData);

  // Helper functions
  const goToNextStep = () => dispatch({ type: 'GO_TO_NEXT_STEP' });
  const goToPreviousStep = () => dispatch({ type: 'GO_TO_PREVIOUS_STEP' });
  const goToStep = (step: number) => dispatch({ type: 'GO_TO_STEP', payload: step });
  const resetOnboarding = () => dispatch({ type: 'RESET_ONBOARDING' });

  const value = {
    onboardingData,
    dispatch,
    goToNextStep,
    goToPreviousStep,
    goToStep,
    resetOnboarding
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

// Create the custom hook for using the context
export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}