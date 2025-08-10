import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";
import { useFirebaseAuthContext } from "@/contexts/FirebaseAuthContext";
import { getFreshWithAuth } from "@/lib/apiClient";

export default function VerifySuccess() {
  const [, setLocation] = useLocation();
  const [isVerified, setIsVerified] = useState(true); // Default to true for better UX
  const [error, setError] = useState("");
  const currentYear = new Date().getFullYear();
  const { getToken } = useFirebaseAuthContext();
  
  useEffect(() => {
    const checkVerification = async () => {
      try {
        // Force refresh the user's token
        if (auth.currentUser) {
          await auth.currentUser.reload();
          setIsVerified(auth.currentUser.emailVerified);
        } else {
          // No user is logged in, check if we have a verification completed parameter in the URL
          const urlParams = new URLSearchParams(window.location.search);
          const mode = urlParams.get('mode');
          const oobCode = urlParams.get('oobCode');
          
          if (mode === 'verifyEmail' && oobCode) {
            // Email verification was completed successfully
            setIsVerified(true);
          } else {
            setError("No verification information found.");
          }
        }
      } catch (error) {
        console.error("Error checking verification status:", error);
        setError("Failed to verify email. Please try again.");
      }
    };
    
    checkVerification();
  }, []);
  
  const handleContinueClick = async () => {
    try {
      // Check if onboarding is already completed using Firebase auth
      const data = await getFreshWithAuth<{ onboardingCompleted: boolean }>('/api/firebase/auth/onboarding-status', getToken);
      
      console.log("Onboarding status response:", data);
      
      if (data && data.onboardingCompleted) {
        // User has already completed onboarding, send them to dashboard
        setLocation('/dashboard');
      } else {
        // New user who hasn't completed onboarding
        setLocation('/onboarding');
      }
    } catch (error) {
      console.error("Error checking onboarding status:", error);
      // Default to onboarding if there's any error
      setLocation('/onboarding');
    }
  };
  
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

      {/* Main Card */}
      <div className="max-w-[500px] w-full bg-white rounded-lg border border-gray-200 shadow-sm p-6 md:p-12">
        <div className="flex flex-col items-center text-center">
          {isVerified ? (
            <>
              {/* Success Icon */}
              <div className="mb-8 text-green-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
                </svg>
              </div>
              
              <h2 className="text-3xl font-medium mb-6 text-gray-900">Email Verified!</h2>
              
              <p className="text-gray-600 mb-10 text-[16px] leading-relaxed">
                Your email has been successfully verified. Let's set up your personalized IELTS preparation plan for your Canadian immigration journey.
              </p>
              
              {/* Continue to Onboarding Button */}
              <Button
                onClick={handleContinueClick}
                className="w-full py-5 bg-black text-white hover:bg-gray-800 rounded text-[16px]"
              >
                Continue to Setup
              </Button>
            </>
          ) : (
            <>
              {/* Error Icon */}
              <div className="mb-8 text-[#ff4d4f]">
                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                  <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/>
                </svg>
              </div>
              
              <h2 className="text-3xl font-medium mb-6 text-gray-900">Verification Failed</h2>
              
              <p className="text-gray-600 mb-6 text-[16px] leading-relaxed">
                {error || "We couldn't verify your email address. The verification link may have expired or is invalid."}
              </p>
              
              <p className="text-gray-600 mb-10 text-[16px] leading-relaxed">
                Please return to the login page and request a new verification email.
              </p>
              
              {/* Return to Login */}
              <Button
                onClick={() => setLocation("/login")}
                className="w-full py-5 bg-black text-white hover:bg-gray-800 rounded text-[16px]"
              >
                Return to Sign In
              </Button>
            </>
          )}
        </div>
      </div>
      
      {/* Footer */}
      <div className="footer w-full max-w-[500px] mt-8 flex justify-center">
        <div className="text-center py-2 text-xs text-gray-500">
          <div className="flex flex-wrap justify-center items-center gap-4 mb-2">
            <span>© {currentYear} IELTS AI Limited</span>
            <a href="/privacy" className="hover:text-gray-900">Privacy Policy</a>
            <a href="/support" className="hover:text-gray-900">Support</a>
          </div>
        </div>
      </div>
    </div>
  );
}