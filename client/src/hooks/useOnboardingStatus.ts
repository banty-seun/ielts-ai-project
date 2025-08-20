import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuthContext } from "@/contexts/FirebaseAuthContext";
import { useEffect, useRef } from "react";
import { createComponentTracker } from "@/lib/firestoreTracker";

interface OnboardingStatusResponse {
  onboardingCompleted: boolean;
  source?: string; // 'session' or 'database'
  userId?: string; // Database user ID 
  firebaseUid?: string; // Firebase UID
  preferences?: {
    sessionMinutes: number;
    dailyCommitment?: string;
    schedule?: string;
    style?: string;
  };
}

// Create a tracker for this hook
const onboardingTracker = createComponentTracker('useOnboardingStatus');

/**
 * Hook to check if a user has completed the onboarding process
 * Returns loading state and onboarding completion status
 * 
 * This hook is dependent on the Firebase auth state and will:
 * 1. Wait for Firebase auth to load before making the request
 * 2. Only make the request if a user is authenticated
 * 3. Include the latest Firebase token in the request
 * 4. Return false for onboardingCompleted when not authenticated
 */
export function useOnboardingStatus() {
  const { currentUser, loading: authLoading, getToken } = useFirebaseAuthContext();
  
  const { 
    data, 
    isLoading: queryLoading, 
    error,
    isFetching,
    dataUpdatedAt,
    refetch
  } = useQuery<OnboardingStatusResponse>({
    queryKey: ["/api/firebase/auth/onboarding-status"],
    queryFn: async ({ queryKey }) => {
      // Get a fresh token every time we check onboarding status
      if (!currentUser) {
        console.log("[Onboarding Status] No authenticated user, skipping request");
        return { onboardingCompleted: false };
      }
      
      try {
        // Track read operation on users collection
        onboardingTracker.trackRead('users', 1);
        
        // Get a fresh token directly from Firebase Auth
        const token = await getToken();
        
        if (!token) {
          console.error("[Onboarding Status] Failed to get token from Firebase");
          return { onboardingCompleted: false };
        }
        
        // Make request with the fresh token
        console.log("[Onboarding Status] Making authenticated request");
        const response = await fetch(queryKey[0] as string, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          credentials: 'include'
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            console.error("[Onboarding Status] Unauthorized request");
            return { onboardingCompleted: false };
          }
          throw new Error(`HTTP error ${response.status}`);
        }
        
        const data = await response.json();
        console.log("[Onboarding Status] Response data:", {
          onboardingCompleted: data.onboardingCompleted,
          userId: data.userId || 'not provided',
          firebaseUid: data.firebaseUid || 'not provided',
          source: data.source || 'unknown'
        });
        
        return data;
      } catch (err) {
        console.error("[Onboarding Status] Error fetching status:", err);
        // In case of error, return a safe default value
        return { onboardingCompleted: false };
      }
    },
    // Only run this query when auth has loaded and user is authenticated
    enabled: !authLoading && !!currentUser,
    retry: false,
    // Increase stale time to reduce backend calls
    staleTime: 5 * 60 * 1000, // 5 minutes (up from 1 minute)
    refetchOnWindowFocus: false
  });

  // Keep track of last refresh time across renders
  const lastRefreshTime = useRef(0);
  const MIN_REFRESH_INTERVAL = 300000; // 5 minutes (increased from 2 minutes)
  
  // Only refetch when the user UID changes, not on every render
  useEffect(() => {
    // Skip if no user or already fetching
    if (!currentUser || isFetching) return;
    
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime.current;
    
    // Only refetch if enough time has passed since last refresh
    if (timeSinceLastRefresh > MIN_REFRESH_INTERVAL) {
      console.log("[Onboarding Status] User changed or refresh interval passed, refetching status");
      lastRefreshTime.current = now;
      
      // Track that we're about to refresh data
      onboardingTracker.trackRead('users', 1);
      
      refetch();
    } else {
      console.log(`[Onboarding Status] Skipping refetch, last refresh was ${Math.round(timeSinceLastRefresh/1000)}s ago`);
    }
  }, [currentUser?.uid, refetch, isFetching]);

  // Calculate if we're still loading - either auth is loading or query is loading
  const isLoading = authLoading || (!!currentUser && queryLoading);

  // Log the final result for debugging
  console.log("[Onboarding Status] Returning:", {
    completed: data?.onboardingCompleted || false,
    isLoading,
    isFetching,
    authLoading,
    queryLoading,
    hasUser: !!currentUser,
    dataUpdatedAt: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : 'unknown'
  });

  return {
    onboardingCompleted: data?.onboardingCompleted || false,
    preferences: data?.preferences,
    isLoading,
    error,
  };
}