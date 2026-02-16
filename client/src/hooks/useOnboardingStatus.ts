import { useQuery } from '@tanstack/react-query';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';

interface OnboardingStatusResponse {
  onboardingCompleted: boolean;
  preferences?: {
    sessionMinutes: number;
    dailyCommitment?: string;
    schedule?: string;
    style?: string;
    listeningDurations?: {
      weekday?: number;
      weekend?: number;
    };
  };
}

/**
 * Stable singleton hook for onboarding status queries to avoid refetch loops.
 */
export function useOnboardingStatus() {
  const { currentUser, loading: authLoading, getToken } = useFirebaseAuthContext();

  const query = useQuery<OnboardingStatusResponse>({
    queryKey: ['onboardingStatus'],
    queryFn: async () => {
      const token = await getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/firebase/auth/onboarding-status', {
        credentials: 'include',
        headers,
      });
      if (!res.ok) {
        throw new Error('onboarding-status failed');
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: 1,
    enabled: !authLoading && !!currentUser,
  });

  return {
    onboardingCompleted: query.data?.onboardingCompleted,
    preferences: query.data?.preferences,
    isLoading: authLoading || query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
