import { useQuery, useQueries } from '@tanstack/react-query';
import { getQueryFn } from '../lib/queryClient';
import { useOnboardingStatus } from './useOnboardingStatus';
import { createComponentTracker } from '../lib/firestoreTracker';

export interface WeeklyPlanTask {
  title: string;
  day: string;
  duration: string;
  status: string;
  skill: string;
  accent?: string;
  description?: string;
  contextType?: string;
}

export interface WeeklyPlan {
  id: string;
  userId: string;
  weekNumber: number;
  skillFocus: string;
  weekFocus: string;
  planData: {
    weekFocus: string;
    plan: WeeklyPlanTask[];
  };
  createdAt: string;
  updatedAt: string;
}

export type WeeklyPlanErrorType = 
  | 'unauthorized' 
  | 'onboarding_incomplete' 
  | 'not_found' 
  | 'server_error'
  | 'unknown';

export interface WeeklyPlanResult {
  data?: WeeklyPlan | null;
  error: boolean;
  errorType?: WeeklyPlanErrorType;
  errorMessage?: string;
  isLoading: boolean;
  refetch: () => void;
  currentWeek?: number;
}

// Create a tracker for this hook
const weeklyPlanTracker = createComponentTracker('useWeeklyPlan');

export function useWeeklyPlan(weekNumber: number, skillFocus: string): WeeklyPlanResult {
  // First, check onboarding status
  const onboardingStatusQuery = useOnboardingStatus();
  
  // Log the onboarding status for debugging
  console.log("Onboarding status in useWeeklyPlan:", {
    isLoading: onboardingStatusQuery.isLoading,
    onboardingCompleted: onboardingStatusQuery.onboardingCompleted,
    error: onboardingStatusQuery.error
  });
  
  // Query the weekly plans using new persisted data endpoint
  const weeklyPlanQuery = useQuery({
    queryKey: [`/api/plan/weekly/${weekNumber}`],
    queryFn: async (ctx) => {
      // Track the database read that will occur
      weeklyPlanTracker.trackRead('weekly_study_plans', 1);
      
      // Use the existing query function
      return getQueryFn({ on401: "returnNull" })(ctx);
    },
    retry: false,
    // Increase stale time to reduce backend calls (10 minutes)
    staleTime: 10 * 60 * 1000, // 10 minutes 
    // Only fetch if onboarding is complete (this avoids unnecessary API calls)
    enabled: !onboardingStatusQuery.isLoading && onboardingStatusQuery.onboardingCompleted,
    select: (data: any) => {
      if (!data || !data.success || !data.skills) {
        console.log("Weekly plan data is null or invalid:", data);
        return null;
      }
      
      // Extract the specific skill focus from the grouped skills data
      const skillPlan = data.skills[skillFocus];
      if (!skillPlan) {
        console.log(`No plan found for skill: ${skillFocus} in week ${weekNumber}`);
        return null;
      }
      
      console.log(`Weekly plan data received for ${skillFocus} - Week ${weekNumber}:`, skillPlan.id);
      return skillPlan as WeeklyPlan;
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
    console.log("useWeeklyPlan error: Onboarding incomplete");
  } 
  // Then check for API query errors
  else if (weeklyPlanQuery.error) {
    const error = weeklyPlanQuery.error as any;
    hasError = true;
    console.log("useWeeklyPlan API error:", error);
    
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
          errorMessage = 'Study plan not found';
          break;
        case 500:
          errorType = 'server_error';
          errorMessage = 'Server error occurred generating plan';
          break;
        default:
          errorType = 'unknown';
          errorMessage = 'Unknown error occurred';
      }
    } else {
      errorType = 'unknown';
      errorMessage = 'Failed to fetch study plan';
    }
  }
  
  // Get current week from API response, but don't modify state with it
  const responseData = weeklyPlanQuery.data as any;
  const currentWeekFromApi = responseData?.currentWeek;
  
  // Log for debugging purposes
  if (currentWeekFromApi) {
    console.log("API returned current week:", currentWeekFromApi, "Requested week:", weekNumber);
  }
  
  return {
    data: weeklyPlanQuery.data,
    error: hasError,
    errorType,
    errorMessage,
    isLoading: onboardingStatusQuery.isLoading || weeklyPlanQuery.isLoading,
    refetch: weeklyPlanQuery.refetch,
    // Just return the week number that was requested to avoid state updates
    currentWeek: weekNumber
  };
}