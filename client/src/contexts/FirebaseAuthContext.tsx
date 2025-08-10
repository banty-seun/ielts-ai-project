import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { 
  User, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail,
  getIdToken,
  sendEmailVerification as firebaseSendEmailVerification
} from 'firebase/auth';
import { auth, actionCodeSettings } from '@/lib/firebase';
import { tokenManager } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

// Define the auth context type
interface FirebaseAuthContextType {
  currentUser: User | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<User>;
  logIn: (email: string, password: string) => Promise<User>;
  logOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  getToken: () => Promise<string | null>;
  sendEmailVerification: (user: User) => Promise<void>;
  isEmailVerified: boolean;
}

// Create the context with a default value
export const FirebaseAuthContext = createContext<FirebaseAuthContextType>({
  currentUser: null,
  loading: true,
  signUp: async () => { throw new Error('Not implemented'); },
  logIn: async () => { throw new Error('Not implemented'); },
  logOut: async () => { throw new Error('Not implemented'); },
  resetPassword: async () => { throw new Error('Not implemented'); },
  getToken: async () => null,
  sendEmailVerification: async () => { throw new Error('Not implemented'); },
  isEmailVerified: false
});

// Custom hook to use the auth context
export const useFirebaseAuthContext = () => useContext(FirebaseAuthContext);

// Provider component
interface FirebaseAuthProviderProps {
  children: ReactNode;
}

export const FirebaseAuthProvider: React.FC<FirebaseAuthProviderProps> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const { toast } = useToast();

  // Handle Firebase auth state changes
  useEffect(() => {
    // Track last token update to prevent spamming Firebase
    let lastTokenUpdate = 0;
    const TOKEN_UPDATE_COOLDOWN = 300000; // 5 minutes
    
    const unsubscribe = onAuthStateChanged(auth, async user => {
      console.log('[Firebase Auth] Auth state changed:', user ? `UID: ${user.uid}` : 'No user');
      setCurrentUser(user);
      setLoading(false);
      
      // Update token manager with the current user's token
      if (user) {
        try {
          const now = Date.now();
          const timeSinceLastUpdate = now - lastTokenUpdate;
          const shouldForceRefresh = timeSinceLastUpdate > TOKEN_UPDATE_COOLDOWN;
          
          // Don't refresh token on auth state change if we're seeing quota errors
          if (quotaState.hasQuotaError && now - quotaState.lastErrorTime < 300000) {
            console.log('[Firebase Auth] Skipping token refresh after auth state change due to recent quota errors');
            return;
          }
          
          if (shouldForceRefresh) {
            console.log('[Firebase Auth] Getting fresh token after auth state change');
            // Get fresh token and store it in token manager
            try {
              const token = await getIdToken(user, true);
              tokenManager.setToken(token);
              lastTokenUpdate = now;
              console.log('[Firebase Auth] Updated token in token manager');
            } catch (refreshError: any) {
              // Check for quota exceeded errors
              const isQuotaError = refreshError?.code === 'auth/quota-exceeded' || 
                                 refreshError?.code === 'auth/the-service-is-currently-unavailable.' ||
                                 refreshError?.message?.includes('quota') ||
                                 refreshError?.message?.includes('unavailable');
              
              if (isQuotaError) {
                // Update quota error state
                quotaState.hasQuotaError = true;
                quotaState.errorCount++;
                quotaState.lastErrorTime = now;
                
                console.warn(`[Firebase Auth] Quota exceeded during auth state change (count: ${quotaState.errorCount}).`, refreshError);
                
                // Show user-friendly notification if we haven't done so recently
                if (!quotaState.errorNotified) {
                  quotaState.errorNotified = true;
                  toast({
                    title: 'Firebase API Limit Reached',
                    description: 'The application has reached Firebase usage limits. Some features may be temporarily unavailable. Please try again in a few minutes.',
                    variant: 'destructive',
                    duration: 10000 // Show for 10 seconds
                  });
                }
              } else {
                console.error('[Firebase Auth] Error getting token:', refreshError);
              }
              // Don't clear existing token in either case
            }
          } else {
            console.log('[Firebase Auth] Skipping token refresh on auth state change - too soon:', 
              `${Math.round(timeSinceLastUpdate/1000)}s since last refresh`);
          }
        } catch (error) {
          console.error('[Firebase Auth] Error in auth state change handler:', error);
          // Don't clear token on general errors
        }
      } else {
        // Clear token on logout/no user
        tokenManager.setToken(null);
        console.log('[Firebase Auth] Cleared token in token manager');
        
        // Reset quota error state on logout
        quotaState.hasQuotaError = false;
        quotaState.errorCount = 0;
        quotaState.errorNotified = false;
      }
    });

    // Cleanup subscription
    return () => unsubscribe();
  }, [toast]); // Add toast dependency

  // Sign up function
  const signUp = async (email: string, password: string): Promise<User> => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Send email verification
      await firebaseSendEmailVerification(userCredential.user, actionCodeSettings);
      return userCredential.user;
    } catch (error: any) {
      console.error('[Firebase Auth] Sign up error:', error.message);
      toast({
        title: 'Sign up failed',
        description: getFirebaseErrorMessage(error),
        variant: 'destructive'
      });
      throw error;
    }
  };

  // Log in function
  const logIn = async (email: string, password: string): Promise<User> => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Get fresh token immediately after login
      const token = await getIdToken(userCredential.user, true);
      tokenManager.setToken(token);
      console.log('[Firebase Auth] Token set after login');
      
      return userCredential.user;
    } catch (error: any) {
      console.error('[Firebase Auth] Login error:', error.message);
      toast({
        title: 'Login failed',
        description: getFirebaseErrorMessage(error),
        variant: 'destructive'
      });
      throw error;
    }
  };

  // Log out function
  const logOut = async (): Promise<void> => {
    try {
      // Clear token before signing out
      tokenManager.setToken(null);
      console.log('[Firebase Auth] Token cleared on logout');
      
      await signOut(auth);
      toast({
        title: 'Logged out',
        description: 'You have been successfully logged out',
      });
    } catch (error: any) {
      console.error('[Firebase Auth] Logout error:', error.message);
      toast({
        title: 'Logout failed',
        description: 'There was a problem logging you out',
        variant: 'destructive'
      });
      throw error;
    }
  };

  // Reset password function
  const resetPassword = async (email: string): Promise<void> => {
    try {
      await sendPasswordResetEmail(auth, email);
      toast({
        title: 'Password reset email sent',
        description: 'Check your email for password reset instructions',
      });
    } catch (error: any) {
      console.error('[Firebase Auth] Password reset error:', error.message);
      toast({
        title: 'Password reset failed',
        description: getFirebaseErrorMessage(error),
        variant: 'destructive'
      });
      throw error;
    }
  };

  // Track quota exceeded errors
  const quotaState = {
    hasQuotaError: false,
    errorCount: 0,
    lastErrorTime: 0,
    errorNotified: false
  };

  // Debug mode flag (only in development)
  const DEBUG = process.env.NODE_ENV === 'development';
  
  /**
   * Smart token refresh logic:
   * 1. Only forces refresh in specific situations:
   *    - After authentication events (login/signup/email verification)
   *    - When token is about to expire (< 5 min remaining)
   *    - When token is stale (> 45 min old) AND no quota errors recently
   * 2. Uses the enhanced TokenManager for caching with expiry tracking
   * 3. Avoids unnecessary refresh calls to prevent quota issues
   */
  const getToken = async (forceRefresh?: boolean): Promise<string | null> => {
    if (!currentUser) {
      DEBUG && console.log('[Firebase Auth] getToken: No current user');
      return null;
    }
    
    try {
      const now = Date.now();
      
      // If we have recent quota errors, avoid forced refreshes unless explicitly requested
      const hasRecentQuotaErrors = quotaState.hasQuotaError && 
                                  (now - quotaState.lastErrorTime < 300000); // 5 min cooldown
      
      // Check token status from the enhanced token manager 
      const tokenStatus = tokenManager.getTokenStatus();
      
      // Determine if we should force refresh
      let shouldForceRefresh = !!forceRefresh; // Explicit request always honored
      
      if (!shouldForceRefresh && !hasRecentQuotaErrors) {
        // Auto refresh if token is expiring soon or stale
        shouldForceRefresh = tokenStatus.isExpiringSoon || tokenStatus.isStale;
      }
      
      // Log detailed token status in dev mode
      if (DEBUG) {
        console.log('[Firebase Auth] Getting token for user:', currentUser.uid, {
          forceRefresh: shouldForceRefresh,
          tokenStatus: tokenStatus.hasToken ? {
            age: `${tokenStatus.ageMinutes} min`,
            expiresIn: `${tokenStatus.expiresInMinutes} min`,
            isStale: tokenStatus.isStale,
            isExpiringSoon: tokenStatus.isExpiringSoon
          } : 'No token',
          quotaState: hasRecentQuotaErrors ? 
            `Quota errors: ${quotaState.errorCount}, last: ${Math.round((now - quotaState.lastErrorTime)/1000)}s ago` : 
            'No recent quota errors'
        });
      }
      
      // Get token with or without force refresh based on our smart logic
      const token = await getIdToken(currentUser, shouldForceRefresh);
      
      if (token) {
        // Only log token info in dev mode to avoid sensitive data in production logs
        if (DEBUG) {
          console.log('[Firebase Auth] Token retrieved successfully:', {
            length: token.length,
            tokenStart: `${token.substring(0, 10)}...`,
            tokenEnd: `...${token.substring(token.length - 10)}`
          });
        }
        
        // Update token manager (which handles expiry tracking and sessionStorage persistence)
        tokenManager.setToken(token);
        
        // Reset quota error state on successful token refresh
        if (shouldForceRefresh && quotaState.hasQuotaError) {
          quotaState.hasQuotaError = false;
          quotaState.errorCount = 0;
          quotaState.errorNotified = false;
          DEBUG && console.log('[Firebase Auth] Reset quota error state after successful refresh');
        }
      }
      
      return token;
    } catch (error: any) {
      // Handle quota exceeded and other errors
      const isQuotaExceeded = error?.code === 'auth/quota-exceeded' || 
                             error?.code === 'auth/the-service-is-currently-unavailable.' ||
                             error?.message?.includes('quota') ||
                             error?.message?.includes('unavailable');
      
      if (isQuotaExceeded) {
        // Update quota error state with exponential backoff
        const now = Date.now();
        quotaState.hasQuotaError = true;
        quotaState.errorCount++;
        quotaState.lastErrorTime = now;
        
        console.warn(`[Firebase Auth] Quota exceeded during token refresh (count: ${quotaState.errorCount}).`, error);
        
        // Show user-friendly notification if we haven't done so recently
        if (!quotaState.errorNotified) {
          quotaState.errorNotified = true;
          toast({
            title: 'Firebase API Limit Reached',
            description: 'The application has reached Firebase usage limits. Some features may be temporarily unavailable. Please try again in a few minutes.',
            variant: 'destructive',
            duration: 10000 // Show for 10 seconds
          });
        }
        
        // Return cached token from token manager if available (even if expired)
        const cachedToken = tokenManager.getToken();
        if (cachedToken) {
          DEBUG && console.log('[Firebase Auth] Using cached token due to quota error');
          return cachedToken;
        }
      } else {
        console.error('[Firebase Auth] Error getting token:', error);
      }
      
      // For non-quota errors, try getting cached token
      return tokenManager.getToken();
    }
  };

  // Send email verification
  const sendEmailVerification = async (user: User): Promise<void> => {
    try {
      await firebaseSendEmailVerification(user, actionCodeSettings);
      toast({
        title: 'Verification email sent',
        description: 'Please check your email to verify your account',
      });
    } catch (error: any) {
      console.error('[Firebase Auth] Email verification error:', error.message);
      toast({
        title: 'Failed to send verification email',
        description: getFirebaseErrorMessage(error),
        variant: 'destructive'
      });
      throw error;
    }
  };

  // Context value
  const value: FirebaseAuthContextType = {
    currentUser,
    loading,
    signUp,
    logIn,
    logOut,
    resetPassword,
    getToken,
    sendEmailVerification,
    isEmailVerified: currentUser?.emailVerified || false
  };

  return (
    <FirebaseAuthContext.Provider value={value}>
      {children}
    </FirebaseAuthContext.Provider>
  );
};

// Helper function to get user-friendly Firebase error messages
function getFirebaseErrorMessage(error: any): string {
  const errorCode = error.code;
  
  switch (errorCode) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please try logging in.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password is too weak. Please use a stronger password.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password. Please try again.';
    case 'auth/too-many-requests':
      return 'Too many failed login attempts. Please try again later.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    default:
      return error.message || 'An error occurred. Please try again.';
  }
}