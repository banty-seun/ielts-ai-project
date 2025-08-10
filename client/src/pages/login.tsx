import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGoogleLogin } from "@react-oauth/google";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuthContext } from "@/contexts/FirebaseAuthContext";
import { getFreshWithAuth } from "@/lib/apiClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [, setLocation] = useLocation();
  const { getToken } = useFirebaseAuthContext();
  
  // Maintain consistent container height
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  
  // Email validation regex
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  
  // Animation ref for password field
  const passwordFieldRef = useRef<HTMLDivElement>(null);
  
  // Validate email
  const validateEmail = () => {
    if (!emailRegex.test(email)) {
      setEmailError("Please enter a valid email address.");
      return false;
    }
    setEmailError("");
    return true;
  };
  
  // Maintain fixed position and prevent jumping
  useEffect(() => {
    // Capture container height and position after initial render
    if (containerHeight === null) {
      // Small delay to ensure the DOM is fully rendered
      const timer = setTimeout(() => {
        const formContainer = document.querySelector('.auth-card');
        if (formContainer) {
          // Set minimum height to maintain consistent vertical spacing
          setContainerHeight(formContainer.clientHeight);
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [containerHeight]);
  
  // Toggle password visibility
  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };
  
  // Handle typing in email field
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (e.target.value.length > 0 && !isTyping) {
      setIsTyping(true);
    } else if (e.target.value.length === 0) {
      setIsTyping(false);
    }
    
    if (emailError) validateEmail();
  };
  
  // Handle Google Sign-In
  const [googleSignInError, setGoogleSignInError] = useState("");
  
  const handleGoogleResponse = async (tokenResponse: any) => {
    try {
      // Show loading state or disable buttons while processing
      setGoogleSignInError("Processing your login...");
      
      // Get user info from Google
      const userInfoResponse = await fetch(
        `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${tokenResponse.access_token}`,
        {
          headers: {
            Authorization: `Bearer ${tokenResponse.access_token}`,
          },
        }
      );
      
      if (!userInfoResponse.ok) {
        throw new Error("Failed to get user information from Google");
      }
      
      const userInfo = await userInfoResponse.json();
      
      // Verify required data
      if (!userInfo.email) {
        throw new Error("Email address is required from Google account");
      }
      
      // Extract user data
      const userData = {
        email: userInfo.email,
        firstName: userInfo.given_name || '',
        lastName: userInfo.family_name || '',
        profileImageUrl: userInfo.picture || null,
        username: userInfo.email.split('@')[0], // Use email username as default username
        googleId: userInfo.id
      };
      
      // Send to your backend for login/signup
      const response = await fetch('/api/firebase/auth/google', {
        method: 'POST',
        body: JSON.stringify(userData),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        // Clear any error message
        setGoogleSignInError("");
        
        // Get response data
        const responseData = await response.json();
        
        // Successful sign-in/sign-up - check onboarding status
        try {
          // Check onboarding status
          const onboardingStatus = await getFreshWithAuth<{ onboardingCompleted: boolean }>('/api/firebase/auth/onboarding-status', getToken);
          
          console.log("Onboarding status response (Google login):", onboardingStatus);
          
          if (onboardingStatus && onboardingStatus.onboardingCompleted) {
            // User already completed onboarding, send them directly to dashboard
            setLocation('/dashboard');
          } else {
            // New user who hasn't completed onboarding
            setLocation('/onboarding');
          }
        } catch (error) {
          console.error("Error checking onboarding status:", error);
          // Default to dashboard if there's any error - user can always access onboarding from there
          setLocation('/dashboard');
        }
      } else {
        // Handle error response
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to authenticate with Google');
      }
    } catch (error) {
      console.error("Google authentication error:", error);
      setGoogleSignInError(error instanceof Error ? error.message : 'An error occurred during Google authentication');
    }
  };
  
  // Initialize Google login with @react-oauth/google
  const googleLogin = useGoogleLogin({
    onSuccess: handleGoogleResponse,
    onError: () => {
      setGoogleSignInError('Google login failed. Please try again.');
    },
    flow: 'implicit', // Uses Google's implicit flow for client-side auth
  });
  
  // Handler for the Google button click
  const handleSignInWithGoogle = (e: React.MouseEvent) => {
    e.preventDefault();
    setGoogleSignInError('');
    googleLogin(); // Trigger Google OAuth flow
  };
  
  // Get toast hook
  const { toast } = useToast();
  
  // Firebase email/password login handler
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateEmail() && password) {
      setIsLoggingIn(true);
      setLoginError("");
      
      try {
        // Sign in with Firebase
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Check if email is verified
        if (!user.emailVerified) {
          // Show toast notification
          toast({
            title: "Email verification required",
            description: "Please verify your email before continuing.",
            variant: "destructive",
          });
          
          // Redirect to verify email page with status parameter
          setLocation('/verify-email?status=unverified');
        } else {
          // Email is verified, check onboarding status
          try {
            // Check onboarding status
            const onboardingStatus = await getFreshWithAuth<{ onboardingCompleted: boolean }>('/api/firebase/auth/onboarding-status', getToken);
            
            console.log("Onboarding status response (Email login):", onboardingStatus);
            
            if (onboardingStatus && onboardingStatus.onboardingCompleted) {
              // User already completed onboarding, send them directly to dashboard
              setLocation('/dashboard');
            } else {
              // New user who hasn't completed onboarding
              setLocation('/onboarding');
            }
          } catch (error) {
            console.error("Error checking onboarding status:", error);
            // Default to dashboard if there's any error - user can always access onboarding from there
            setLocation('/dashboard');
          }
        }
      } catch (error: any) {
        console.error("Login error:", error);
        
        // Handle specific Firebase auth errors
        if (error.code === 'auth/user-not-found') {
          setLoginError("No account found with this email. Please check your email or sign up.");
        } else if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
          setLoginError("Incorrect email or password. Please try again.");
        } else if (error.code === 'auth/too-many-requests') {
          setLoginError("Too many failed login attempts. Please try again later.");
        } else if (error.code === 'auth/user-disabled') {
          setLoginError("Your account has been disabled. Please contact support.");
        } else if (error.code === 'auth/network-request-failed') {
          setLoginError("Network error. Please check your internet connection and try again.");
        } else {
          console.error("Specific error code:", error.code);
          setLoginError("An error occurred during login. Please try again.");
        }
      } finally {
        setIsLoggingIn(false);
      }
    }
  };
  
  const currentYear = new Date().getFullYear();
  
  return (
    <div className="page-wrapper bg-white text-gray-900 flex flex-col justify-center items-center min-h-screen p-6 box-border relative">
      {/* Logo - Fixed positioned at top center with link to landing page */}
      <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-10">
        <a href="/" className="no-underline hover:opacity-80 transition-opacity">
          <h1 className="text-2xl font-bold">IELTS AI</h1>
        </a>
      </div>
      
      {/* Top spacer to maintain consistent positioning */}
      <div className="h-20"></div>
      
      {/* Main Auth Card */}
      <div 
        className="auth-card max-w-[500px] w-full bg-white rounded-lg border border-gray-200 shadow-sm p-6 md:p-12"
        style={containerHeight ? { minHeight: `${containerHeight}px` } : {}}>
        
        <div className="flex flex-col items-center">
          {/* Sign In Heading */}
          <h2 className="text-2xl font-medium text-center mb-8 text-[#1C1D1F]">Sign in</h2>
          
          <div className="w-full">
            {/* Authentication Form */}
            <form onSubmit={handleLogin} className="flex flex-col gap-5">
              {/* Google Sign In - Only shown if not typing */}
              {!isTyping && (
                <>
                  <Button 
                    variant="outline" 
                    className="w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-700 hover:bg-gray-50 bg-white py-5 shadow-sm"
                    onClick={handleSignInWithGoogle}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 mr-2" aria-hidden="true">
                      <path
                        d="M12.0003 4.75C13.7703 4.75 15.3553 5.36002 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86002 8.87028 4.75 12.0003 4.75Z"
                        fill="#EA4335"
                      />
                      <path
                        d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z"
                        fill="#4285F4"
                      />
                      <path
                        d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.2654 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z"
                        fill="#34A853"
                      />
                    </svg>
                    Sign in with Google
                  </Button>
                  
                  {/* Divider */}
                  <div className="flex items-center my-3">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <div className="px-3 text-sm text-gray-500">OR</div>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>
                </>
              )}
              
              {/* Form Fields Container with consistent spacing */}
              <div className="flex flex-col gap-4 w-full">
                {/* Email Input */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#9ca3af" viewBox="0 0 16 16">
                      <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z"/>
                    </svg>
                  </div>
                  <Input
                    type="email"
                    className={`w-full pl-10 pr-4 py-5 h-[48px] bg-gray-50 border ${emailError ? 'border-[#ff4d4f]' : 'border-gray-200'} rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:border-black focus:ring-0`}
                    placeholder="Enter your email address"
                    value={email}
                    onChange={handleEmailChange}
                    required
                  />
                  {emailError && (
                    <p className="text-[#ff4d4f] text-xs mt-1">{emailError}</p>
                  )}
                </div>
                
                {/* Password Input - Only shown when typing */}
                <div 
                  ref={passwordFieldRef}
                  className={`transition-all duration-300 ease-in-out overflow-hidden ${isTyping ? 'max-h-[100px] opacity-100' : 'max-h-0 opacity-0'}`}
                >
                  <div className="relative">
                    <div className="flex items-center relative h-[48px]">
                      {/* Lock icon - left aligned */}
                      <div className="absolute left-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#9ca3af" viewBox="0 0 16 16">
                          <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
                        </svg>
                      </div>
                      
                      <Input
                        type={showPassword ? "text" : "password"}
                        className="w-full h-full pl-10 pr-10 bg-gray-50 border border-gray-200 rounded text-gray-900 placeholder-gray-500 focus:outline-none focus:border-black focus:ring-0"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required={isTyping}
                      />
                      
                      {/* Eye icon - absolutely positioned */}
                      <div 
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer"
                        onClick={togglePasswordVisibility}
                      >
                        {showPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#9ca3af" viewBox="0 0 16 16">
                            <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                            <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                            <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#9ca3af" viewBox="0 0 16 16">
                            <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
                            <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Continue button */}
              <Button
                type="submit"
                className="w-full bg-black text-white py-5 rounded hover:bg-gray-800 transition-all"
                disabled={!email || (isTyping && !password) || isLoggingIn}
              >
                {isLoggingIn ? (
                  <div className="flex items-center justify-center">
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-b-transparent border-white"></div>
                    <span>Signing in...</span>
                  </div>
                ) : "Continue"}
              </Button>
              
              {/* Error messages - moved under continue button */}
              {(googleSignInError || loginError) && (
                <p className="mt-4 text-[#ff4d4f] text-sm text-center">
                  {googleSignInError || loginError}
                </p>
              )}
              
              {/* Sign up link */}
              <div className="text-center mt-2">
                <p className="text-sm text-gray-600">
                  Don't have an account? <a href="/auth" className="text-blue-600 hover:underline">Sign up</a>
                </p>
              </div>
            </form>
            
            {/* Footer with Terms and Conditions */}
            <div className="mt-12 text-center">
              <p className="text-[10px] text-gray-500 leading-relaxed">
                By signing in to IELTS AI, you agree to our <a href="#" className="underline text-gray-600 hover:text-black">Terms</a> and <a href="#" className="underline text-gray-600 hover:text-black">Privacy Policy</a>.
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <div className="footer w-full max-w-[500px] mt-4 flex justify-center">
        <div className="text-center py-2 text-xs text-gray-500">
          <div className="flex justify-center items-center gap-4 mb-2">
            <span>© {currentYear} IELTS AI Limited</span>
            <a href="/privacy" className="hover:text-gray-900">Privacy</a>
            <a href="/support" className="hover:text-gray-900">Support</a>
          </div>
        </div>
      </div>
    </div>
  );
}