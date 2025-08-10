import { ReactNode, useEffect } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { tokenManager } from '@/lib/queryClient';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOnboarding?: boolean;
}

export function ProtectedRoute({ children, requireOnboarding = false }: ProtectedRouteProps) {
  const { currentUser, loading: authLoading, isEmailVerified, getToken } = useFirebaseAuthContext();
  const { onboardingCompleted, isLoading: onboardingLoading } = useOnboardingStatus();
  const [location, setLocation] = useLocation();
  
  // Determine if we're on the onboarding page
  const isOnboardingPage = location === '/onboarding';

  // Update token in token manager when user changes (optimized to reduce refreshes)
  useEffect(() => {
    // Prevent multiple token refreshes in the same component update cycle
    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    
    const updateToken = async () => {
      if (!isMounted) return;
      
      if (currentUser) {
        try {
          // Check if token manager already has a valid token
          const tokenStatus = tokenManager.getTokenStatus();
          const debug = process.env.NODE_ENV === 'development';
          
          // Only refresh if token is missing, expiring soon, or stale
          const needsRefresh = !tokenStatus.hasToken || 
                               tokenStatus.isExpiringSoon || 
                               tokenStatus.isStale;
          
          if (debug) {
            console.log('[ProtectedRoute] Token status check:', { 
              hasToken: tokenStatus.hasToken,
              isExpiringSoon: tokenStatus.isExpiringSoon,
              isStale: tokenStatus.isStale,
              needsRefresh
            });
          }
          
          if (needsRefresh) {
            // Use the enhanced getToken (which handles caching)
            // Don't force refresh - let getToken() decide based on token status
            await getToken();
            
            if (!isMounted) return; // Bail if component unmounted during token fetch
            
            debug && console.log('[ProtectedRoute] Token updated in protected route');
          } else {
            debug && console.log('[ProtectedRoute] Using existing valid token');
          }
        } catch (error) {
          console.error('[ProtectedRoute] Error getting token:', error);
          // Don't clear token on error - keep existing token
        }
      } else {
        tokenManager.clearToken();
        console.log('[ProtectedRoute] Token cleared due to user logout');
      }
    };
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    // Add a small delay to prevent rapid token refreshes
    // Only run if we have a current user (don't bother on logout)
    if (currentUser) {
      timeoutId = setTimeout(updateToken, 200);
    }
    
    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [currentUser, getToken]);
  
  // Check verification and redirect if email not verified
  useEffect(() => {
    if (currentUser && !isEmailVerified) {
      setLocation('/verify-email');
    }
  }, [currentUser, isEmailVerified, setLocation]);
  
  // Enforce consistent redirects based on onboarding status
  useEffect(() => {
    if (!authLoading && !onboardingLoading && currentUser) {
      if (!onboardingCompleted) {
        console.log('[ProtectedRoute] Redirecting to onboarding');
        setLocation('/onboarding');
      } else if (isOnboardingPage) {
        console.log('[ProtectedRoute] Redirecting to dashboard');
        setLocation('/dashboard');
      }
    }
  }, [authLoading, onboardingLoading, currentUser, onboardingCompleted, isOnboardingPage, setLocation]);
  
  // Log loading state for debugging
  console.log('[Route Protection] Loading state:', { 
    authLoading, 
    onboardingLoading,
    isEmailVerified,
    onboardingCompleted,
    hasUser: !!currentUser,
    location
  });
  
  // IMMEDIATE REDIRECTS - these happen even before loading states are checked
  
  // If not authenticated, redirect to login immediately
  if (!authLoading && !currentUser) {
    console.log('[Route Protection] Not authenticated, redirecting to login');
    return <Redirect to="/login" />;
  }
  
  // IMMEDIATE REDIRECT: First-time users who haven't completed onboarding should be redirected
  if (!authLoading && !onboardingLoading && currentUser && isEmailVerified && onboardingCompleted === false && location !== '/onboarding') {
    console.log('[Route Protection] First login detected: Redirecting to onboarding');
    return <Redirect to="/onboarding" />;
  }
  
  // If onboarding is completed and trying to access onboarding page, redirect to dashboard immediately
  if (!authLoading && !onboardingLoading && isOnboardingPage && onboardingCompleted) {
    console.log('[Route Protection] Redirecting from onboarding to dashboard (already completed)');
    return <Redirect to="/dashboard" />;
  }
  
  // Show loading state while checking auth or onboarding status
  if (authLoading || (!!currentUser && onboardingLoading)) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-gray-300 rounded-full border-t-black"></div>
        <p className="mt-4 text-gray-600">Loading...</p>
      </div>
    );
  }
  
  // If not email verified, show loading while the useEffect handles redirection
  if (!isEmailVerified) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-gray-300 rounded-full border-t-black"></div>
        <p className="mt-4 text-gray-600">Checking email verification...</p>
      </div>
    );
  }
  
  // Handle other protected pages:
  // If a page requires completed onboarding and user hasn't completed it,
  // redirect them to the onboarding page
  if (requireOnboarding && !onboardingCompleted) {
    console.log('[Route Protection] Redirecting to onboarding (required but not completed)');
    return <Redirect to="/onboarding" />;
  }
  
  // Log the current route protection state
  console.log('[Route Protection] Rendering protected content:', {
    path: location,
    requireOnboarding,
    onboardingCompleted,
    isOnboardingPage
  });
  
  // User is authenticated, verified, and meets onboarding requirements, render the children
  return <>{children}</>;
}