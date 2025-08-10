import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { auth, sendEmailVerification, actionCodeSettings } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

export default function VerifyEmail() {
  const [location, setLocation] = useLocation();
  const [email, setEmail] = useState<string | null>(null);
  const [resendDisabled, setResendDisabled] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [resendMessage, setResendMessage] = useState("");
  const { toast } = useToast();
  
  // Check if user arrived from login with unverified email
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    
    if (status === 'unverified') {
      // Show toast notification for unverified users - no banner needed
      toast({
        title: "Email verification required",
        description: "You must verify your email before continuing. Please check your inbox including spam folder.",
        variant: "destructive",
        duration: 6000,
      });
    }
  }, [toast]);

  useEffect(() => {
    // Get current user email
    const userEmail = auth.currentUser?.email;
    setEmail(userEmail || "your email");
    
    // If no user is found, redirect to signup
    if (!auth.currentUser) {
      setLocation("/auth");
    }
  }, [setLocation]);

  // Handle countdown for resending verification with smoother animation
  useEffect(() => {
    if (countdown > 0) {
      // Use setInterval for a more accurate countdown
      const timer = setInterval(() => {
        setCountdown((prev) => {
          const newCount = prev - 1;
          // When countdown reaches 0, enable the button and clear the interval
          if (newCount <= 0) {
            setResendDisabled(false);
            clearInterval(timer);
            return 0;
          }
          return newCount;
        });
      }, 1000);
      
      // Cleanup interval on unmount
      return () => clearInterval(timer);
    }
  }, [countdown]);

  // Handle resend verification email
  const handleResendVerification = async () => {
    // Check if user is logged in
    if (!auth.currentUser) {
      console.warn("⚠️ Cannot resend email — user not logged in");
      
      toast({
        title: "Authentication Error",
        description: "You need to be logged in to verify your email. Please log in again.",
        variant: "destructive",
        duration: 5000,
      });
      
      return;
    }
    
    // Diagnostic logging
    console.log("📍 Attempting to resend verification email");
    console.log("Current user:", auth.currentUser.email);
    console.log("Email verified status:", auth.currentUser.emailVerified);
    console.log("Domain being used:", window.location.hostname);
    console.log("Action code URL:", `https://${window.location.hostname}/verify-handler`);
    
    // Immediately disable button and start countdown to prevent multiple clicks
    setResendDisabled(true);
    setCountdown(60); // Start 60 second countdown
    
    try {
      // Send verification email
      await sendEmailVerification(auth.currentUser, actionCodeSettings);
      console.log("✅ Verification email sent successfully");
      
      // Show success message
      setResendMessage("Verification email sent! Please check your inbox.");
      
      // Show success toast
      toast({
        title: "Email sent",
        description: "Verification email sent. Please check your inbox and spam folder.",
        variant: "default",
        duration: 4000,
      });
    } catch (error: any) {
      console.error("❌ Error sending verification email:", error);
      console.error("Error code:", error.code);
      console.error("Error message:", error.message);
      
      // Show specific error messages based on Firebase error codes
      let errorMessage = "Failed to send verification email. Please try again.";
      let helpText = "";
      
      switch (error.code) {
        case 'auth/too-many-requests':
          errorMessage = "Too many attempts. Please wait a moment before trying again.";
          break;
        case 'auth/network-request-failed':
          errorMessage = "Network error. Please check your internet connection.";
          break;
        case 'auth/unauthorized-continue-uri':
          errorMessage = "Configuration error with email verification.";
          helpText = "Please contact support with error code: AUTH-URI-001";
          // Log detailed information for debugging
          console.error("Unauthorized continue URI. The domain needs to be added to the Firebase Console's authorized domains.");
          break;
        case 'auth/requires-recent-login':
          errorMessage = "For security reasons, please log in again before requesting a verification email.";
          break;
        default:
          errorMessage = "Failed to send verification email. Please try again.";
      }
      
      // Set user-facing message
      setResendMessage(errorMessage + (helpText ? ` ${helpText}` : ""));
      
      // Show error toast
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
        duration: 5000,
      });
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
      <div className="max-w-[600px] w-full bg-white rounded-lg border border-gray-200 shadow-sm p-6 md:p-12">
        <div className="flex flex-col items-center text-center">
          {/* Email Verification Icon */}
          <div className="mb-6 text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8.941.435a2 2 0 0 0-1.882 0l-6 3.2A2 2 0 0 0 0 5.4v.314l6.709 3.932L8 8.928l1.291.718L16 5.714V5.4a2 2 0 0 0-1.059-1.765l-6-3.2ZM16 6.873l-5.693 3.337L16 13.372v-6.5Zm-.059 7.611L8 10.072.059 14.484A2 2 0 0 0 2 16h12a2 2 0 0 0 1.941-1.516ZM0 13.373l5.693-3.163L0 6.873v6.5Z"/>
            </svg>
          </div>
          
          <h2 className="text-2xl font-medium mb-4">Check your email</h2>
          
          <p className="text-gray-600 mb-6">
            We've sent a verification link to <span className="font-semibold">{email}</span>. 
            Please check your inbox and click on the link to verify your email address.
          </p>
          
          <p className="text-gray-600 mb-8">
            If you don't see the email, check your spam folder.
          </p>
          
          {/* Resend Verification Button */}
          <div className="flex flex-col items-center gap-2 w-full">
            <Button
              onClick={handleResendVerification}
              variant="outline"
              disabled={resendDisabled}
              className={`
                w-full sm:max-w-[280px] py-5 relative transition-all duration-200
                border ${resendDisabled ? 'border-gray-200 bg-gray-50' : 'border-gray-300 hover:bg-gray-50'} 
                text-sm font-medium
                focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-none
                aria-disabled:cursor-not-allowed aria-disabled:opacity-70
              `}
              aria-label={resendDisabled ? `Resend verification email in ${countdown} seconds` : "Resend verification email"}
              title={resendDisabled ? `Wait ${countdown} seconds before resending` : "Send a new verification email"}
            >
              {resendDisabled ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-gray-500 animate-spin"></span>
                  <span>Resend in {countdown}s</span>
                </span>
              ) : (
                <span className="flex items-center justify-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="mr-1">
                    <path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm3 6a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm3 6a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm3 6a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm3 6a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm0-2.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/>
                    <path d="M8.515 3.515A.5.5 0 0 1 9 4v3.5a.5.5 0 0 1-.5.5H5a.5.5 0 0 1 0-1h3V4a.5.5 0 0 1 .515-.485z"/>
                  </svg>
                  Resend verification email
                </span>
              )}
            </Button>
            
            {/* Status message with proper color coding */}
            {resendMessage && (
              <p 
                className={`text-sm mt-1 ${resendMessage.includes("Failed") || resendMessage.includes("error") || resendMessage.includes("Too many") ? "text-[#ff4d4f]" : "text-green-600"}`}
                aria-live="polite"
                role="status"
              >
                {resendMessage}
              </p>
            )}
          </div>
          
          {/* Return to Login */}
          <div className="mt-8">
            <a href="/login" className="text-blue-600 hover:underline">
              Return to login
            </a>
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <div className="footer w-full max-w-[500px] mt-4 flex justify-center">
        <div className="text-center py-2 text-xs text-gray-500">
          <div className="flex justify-center items-center gap-4 mb-2">
            <span>© {new Date().getFullYear()} IELTS AI Limited</span>
            <a href="/privacy" className="hover:text-gray-900">Privacy</a>
            <a href="/support" className="hover:text-gray-900">Support</a>
          </div>
        </div>
      </div>
    </div>
  );
}