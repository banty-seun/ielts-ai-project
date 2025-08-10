import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { useOnboardingStatus } from './useOnboardingStatus';

export function useFirebaseAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  // Checks if user is verified and redirects if not (now a memoized function)
  const checkEmailVerification = useCallback((redirectToVerifyPage = true) => {
    if (user && !user.emailVerified && redirectToVerifyPage) {
      // We'll use this in a useEffect in the component instead
      // to avoid render loops
      return false;
    } else if (user && user.emailVerified && redirectToVerifyPage) {
      // If verified and redirect is enabled, return true but don't redirect directly
      // (use redirectToVerification for that)
      return true;
    }
    
    return user ? user.emailVerified : false;
  }, [user]);

  // Separate function to redirect that should be called from a useEffect
  const redirectToVerification = useCallback(async () => {
    if (user && !user.emailVerified) {
      toast({
        title: "Email verification required",
        description: "You must verify your email before continuing.",
        variant: "destructive",
      });
      
      // Redirect to verify email page with status parameter
      setLocation('/verify-email?status=unverified');
    } else if (user && user.emailVerified) {
      // For login flows (not email verification links), always redirect to dashboard
      // The verification handler page handles redirects for actual email verification clicks
      setLocation('/dashboard');
    }
  }, [user, toast, setLocation]);

  return {
    user,
    loading,
    isAuthenticated: !!user,
    isEmailVerified: user ? user.emailVerified : false,
    checkEmailVerification,
    redirectToVerification,
  };
}