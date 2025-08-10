import { useQuery } from '@tanstack/react-query';
import { getQueryFn } from '../lib/queryClient';
import { useOnboardingStatus } from './useOnboardingStatus';
import { createComponentTracker } from '../lib/firestoreTracker';
import { WeeklyPlan, WeeklyPlanErrorType } from './useWeeklyPlan';

export interface WeeklyPlansData {
  week: number;
  skills: {
    [skillFocus: string]: WeeklyPlan;
  };
}

export interface WeeklyPlansResult {
  data?: WeeklyPlansData | null;
  error: boolean;
  errorType?: WeeklyPlanErrorType;
  errorMessage?: string;
  isLoading: boolean;
  refetch: () => void;
}

// Create a tracker for this hook
const weeklyPlansTracker = createComponentTracker('useWeeklyPlans');

export function useWeeklyPlans(weekNumber: number): WeeklyPlansResult {
  // First, check onboarding status
  const onboardingStatusQuery = useOnboardingStatus();
  
  // Query all weekly plans for the specified week
  const weeklyPlansQuery = useQuery({
    queryKey: [`/api/plan/weekly/${weekNumber}`],
    queryFn: async (ctx) => {
      // Track the database read that will occur
      weeklyPlansTracker.trackRead('weekly_study_plans', 4); // Potentially 4 skills
      
      // Use the existing query function
      return getQueryFn({ on401: "returnNull" })(ctx);
    },
    retry: false,
    // Increase stale time to reduce backend calls (10 minutes)
    staleTime: 10 * 60 * 1000, // 10 minutes 
    // Only fetch if onboarding is complete
    enabled: !onboardingStatusQuery.isLoading && onboardingStatusQuery.onboardingCompleted,
    select: (data: any) => {
      if (!data || !data.success) {
        console.log("Weekly plans data is null or invalid:", data);
        return null;
      }
      
      console.log(`Weekly plans data received for week ${weekNumber}:`, Object.keys(data.skills || {}));
      return {
        week: data.week,
        skills: data.skills || {}
      } as WeeklyPlansData;
    },
  });
  
  // Determine if there's an error and what type it is
  let errorType: WeeklyPlanErrorType | undefined;
  let errorMessage: string | undefined;
  let hasError = false;
  
  // Check for onboarding incomplete error first
  if (!onboardingStatusQuery.isLoading && !onboardingStatusQuery.onboardingCompleted) {
    errorType = 'onboarding_incomplete';
    errorMessage = 'Please complete onboarding to generate your study plan';
    hasError = true;
  } 
  // Then check for API query errors
  else if (weeklyPlansQuery.error) {
    const error = weeklyPlansQuery.error as any;
    hasError = true;
    
    if (error.response) {
      switch (error.response.status) {
        case 401:
          errorType = 'unauthorized';
          errorMessage = 'Please login to view your study plan';
          break;
        case 400:
          if (error.response.data?.message?.includes('onboarding')) {
            errorType = 'onboarding_incomplete';
            errorMessage = 'Please complete onboarding to generate your study plan';
          } else {
            errorType = 'unknown';
            errorMessage = error.response.data?.message || 'Invalid request';
          }
          break;
        case 404:
          errorType = 'not_found';
          errorMessage = `No study plans found for week ${weekNumber}`;
          break;
        case 500:
          errorType = 'server_error';
          errorMessage = 'Server error occurred fetching plans';
          break;
        default:
          errorType = 'unknown';
          errorMessage = 'Unknown error occurred';
      }
    } else {
      errorType = 'unknown';
      errorMessage = 'Failed to fetch study plans';
    }
  }
  
  return {
    data: weeklyPlansQuery.data,
    error: hasError,
    errorType,
    errorMessage,
    isLoading: onboardingStatusQuery.isLoading || weeklyPlansQuery.isLoading,
    refetch: weeklyPlansQuery.refetch
  };
}