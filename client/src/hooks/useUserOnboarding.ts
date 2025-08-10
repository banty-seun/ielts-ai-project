import { useQuery } from '@tanstack/react-query';
import { getQueryFn } from '../lib/queryClient';
import { useOnboardingStatus } from './useOnboardingStatus';
import { createComponentTracker } from '../lib/firestoreTracker';

export interface UserOnboardingData {
  fullName: string;
  phoneNumber?: string;
  targetBandScore: number;
  testDate?: Date | null;
  notDecided: boolean;
  skillRatings: {
    listening: number;
    reading: number;
    writing: number;
    speaking: number;
  };
  immigrationGoal: string;
  studyPreferences: {
    style?: string;
    schedule?: string;
    dailyCommitment?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UserOnboardingResult {
  data?: UserOnboardingData | null;
  error: boolean;
  errorMessage?: string;
  isLoading: boolean;
  refetch: () => void;
}

// Create a tracker for this hook
const userOnboardingTracker = createComponentTracker('useUserOnboarding');

export function useUserOnboarding(): UserOnboardingResult {
  // First, check onboarding status
  const onboardingStatusQuery = useOnboardingStatus();
  
  // Query the user onboarding data
  const userOnboardingQuery = useQuery({
    queryKey: ['/api/user/onboarding'],
    queryFn: async (ctx) => {
      // Track the database read that will occur
      userOnboardingTracker.trackRead('study_plans', 1);
      
      // Use the existing query function
      return getQueryFn({ on401: "returnNull" })(ctx);
    },
    retry: false,
    // Cache for 5 minutes since this data doesn't change often
    staleTime: 5 * 60 * 1000,
    // Only fetch if onboarding is complete
    enabled: !onboardingStatusQuery.isLoading && onboardingStatusQuery.onboardingCompleted,
    select: (data: any) => {
      if (!data || !data.success || !data.data) {
        console.log("User onboarding data is null or invalid:", data);
        return null;
      }
      
      console.log("User onboarding data received:", data.data);
      return data.data as UserOnboardingData;
    },
  });
  
  // Determine error state
  let hasError = false;
  let errorMessage: string | undefined;
  
  // Check for onboarding incomplete error first
  if (!onboardingStatusQuery.isLoading && !onboardingStatusQuery.onboardingCompleted) {
    hasError = true;
    errorMessage = 'Please complete onboarding first';
  } 
  // Then check for API query errors
  else if (userOnboardingQuery.error) {
    const error = userOnboardingQuery.error as any;
    hasError = true;
    
    if (error.response?.status === 404) {
      errorMessage = 'No onboarding data found';
    } else if (error.response?.status === 401) {
      errorMessage = 'Please login to view your data';
    } else {
      errorMessage = 'Failed to fetch onboarding data';
    }
  }
  
  return {
    data: userOnboardingQuery.data,
    error: hasError,
    errorMessage,
    isLoading: onboardingStatusQuery.isLoading || userOnboardingQuery.isLoading,
    refetch: userOnboardingQuery.refetch
  };
}