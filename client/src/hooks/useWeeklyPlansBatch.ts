import { useQuery } from '@tanstack/react-query';
import { getQueryFn } from '../lib/queryClient';
import { useOnboardingStatus } from './useOnboardingStatus';
import { createComponentTracker } from '../lib/firestoreTracker';
import { WeeklyPlan } from './useWeeklyPlan';

// Create a tracker for this hook to monitor Firestore operations
const weeklyPlansBatchTracker = createComponentTracker('useWeeklyPlansBatch');

/**
 * Hook to fetch all weekly plans for a specific week in a single batch
 * This optimizes Firebase operations by retrieving all skills (Listening, Reading, Writing, Speaking) at once
 * 
 * @param weekNumber The week number to fetch plans for
 * @returns Object containing the weekly plans data and loading/error states
 */
export function useWeeklyPlansBatch(weekNumber: number) {
  // First, check onboarding status
  const onboardingStatusQuery = useOnboardingStatus();
  
  // Track this batch query using the Firebase tracker
  const weeklyPlansBatchQuery = useQuery({
    queryKey: [`/api/firebase/weekly-plans/week/${weekNumber}`],
    queryFn: async (ctx) => {
      // Track this as a single read operation that retrieves multiple plans
      weeklyPlansBatchTracker.trackRead('weekly_study_plans', 1);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[useWeeklyPlansBatch] Fetching all plans for week ${weekNumber} in a single batch`);
      }
      
      // Use the existing query function
      return getQueryFn({ on401: "returnNull" })(ctx);
    },
    retry: false,
    // Increase stale time significantly since all skills are loaded together
    staleTime: 15 * 60 * 1000, // 15 minutes (increased from 10 for normal weekly plan queries)
    // Only fetch if onboarding is complete and week number is valid
    enabled: !onboardingStatusQuery.isLoading && 
             onboardingStatusQuery.onboardingCompleted && 
             typeof weekNumber === 'number' && 
             weekNumber > 0,
    select: (data: any) => {
      if (!data || !data.success || !Array.isArray(data.plans)) {
        if (process.env.NODE_ENV === 'development') {
          console.log('Weekly plans batch data is null or invalid:', data);
        }
        return {
          plans: [],
          weekNumber: weekNumber
        };
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`Weekly plans batch data received for week ${weekNumber}:`, 
          data.plans.length > 0 ? `${data.plans.length} plans found` : 'No plans found');
      }
      
      return {
        plans: data.plans as WeeklyPlan[],
        weekNumber: data.weekNumber || weekNumber
      };
    }
  });
  
  /**
   * Get a specific plan by skill from the cached batch results
   * This avoids additional API calls by using the data already fetched
   * 
   * @param skillFocus The skill to retrieve (e.g., 'Listening', 'Reading', etc.)
   * @returns The weekly plan for the specified skill, or undefined if not found
   */
  const getPlanBySkill = (skillFocus: string): WeeklyPlan | undefined => {
    if (!weeklyPlansBatchQuery.data?.plans) return undefined;
    
    return weeklyPlansBatchQuery.data.plans.find(
      plan => plan.skillFocus.toLowerCase() === skillFocus.toLowerCase()
    );
  };
  
  // Return the query data along with the helper function
  return {
    ...weeklyPlansBatchQuery,
    plans: weeklyPlansBatchQuery.data?.plans || [],
    weekNumber: weeklyPlansBatchQuery.data?.weekNumber || weekNumber,
    getPlanBySkill,
    // Include loading state based on both the onboarding and batch queries
    isLoading: onboardingStatusQuery.isLoading || weeklyPlansBatchQuery.isLoading,
    // Check if no plans were found after loading
    noPlansFound: !weeklyPlansBatchQuery.isLoading && 
                 weeklyPlansBatchQuery.data?.plans &&
                 weeklyPlansBatchQuery.data.plans.length === 0
  };
}