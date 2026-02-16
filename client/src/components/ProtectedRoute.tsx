import { ReactNode, useEffect, useRef, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOnboarding?: boolean;
}

export function ProtectedRoute({ children, requireOnboarding = false }: ProtectedRouteProps) {
  const {
    currentUser,
    loading: authLoading,
    authReady,
    isEmailVerified,
    getToken,
  } = useFirebaseAuthContext();
  const { onboardingCompleted, isLoading: onboardingLoading } = useOnboardingStatus();
  const [location, setLocation] = useLocation();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshAttempted, setRefreshAttempted] = useState(false);
  const refreshOnceRef = useRef(false);

  const isOnboardingPage = location === '/onboarding';

  useEffect(() => {
    if (!authReady) return;
    if (currentUser) return;
    if (refreshOnceRef.current) return;

    refreshOnceRef.current = true;
    setRefreshing(true);
    (async () => {
      try {
        const forced = await getToken(true);
      } catch (error) {
      } finally {
        setRefreshing(false);
        setRefreshAttempted(true);
      }
    })();
  }, [authReady, currentUser, getToken]);

  useEffect(() => {
    if (currentUser && !isEmailVerified) {
      setLocation('/verify-email');
    }
  }, [currentUser, isEmailVerified, setLocation]);

  useEffect(() => {
    // Only redirect once onboarding status is known
    if (!authReady || authLoading || onboardingLoading || !currentUser) {
      return;
    }
    if (onboardingCompleted === false) {
      setLocation('/onboarding');
    } else if (onboardingCompleted === true && isOnboardingPage) {
      setLocation('/dashboard');
    }
  }, [authReady, authLoading, onboardingLoading, currentUser, onboardingCompleted, isOnboardingPage, setLocation]);

  const waitingForAuth =
    !authReady ||
    authLoading ||
    (refreshing && !refreshAttempted);

  if (waitingForAuth) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-gray-300 rounded-full border-t-black"></div>
        <p className="mt-4 text-gray-600">Preparing your session...</p>
      </div>
    );
  }

  if (!currentUser && refreshAttempted && !refreshing) {
    return <Redirect to="/login" />;
  }

  if (!authLoading && !onboardingLoading && currentUser && isEmailVerified && onboardingCompleted === false && location !== '/onboarding') {
    return <Redirect to="/onboarding" />;
  }

  if (!authLoading && !onboardingLoading && isOnboardingPage && onboardingCompleted) {
    return <Redirect to="/dashboard" />;
  }

  if (!isEmailVerified) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-gray-300 rounded-full border-t-black"></div>
        <p className="mt-4 text-gray-600">Checking email verification...</p>
      </div>
    );
  }

  if (requireOnboarding && onboardingCompleted === false) {
    return <Redirect to="/onboarding" />;
  }

  return <>{children}</>;
}
