import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { auth } from "@/lib/firebase";
import { applyActionCode } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuthContext } from "@/contexts/FirebaseAuthContext";
import { getFreshWithAuth } from "@/lib/apiClient";
import { tokenManager } from "@/lib/queryClient";

export default function VerifyHandler() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { getToken } = useFirebaseAuthContext();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        // Extract verification parameters from URL
        const urlParams = new URLSearchParams(window.location.search);
        const mode = urlParams.get('mode');
        const oobCode = urlParams.get('oobCode');
        const continueUrl = urlParams.get('continueUrl');

        if (mode === 'verifyEmail' && oobCode) {
          // Step 1: Apply the action code with improved error handling
          try {
            await applyActionCode(auth, oobCode);
          } catch (error) {
            if (error.code === "auth/invalid-action-code") {
              console.warn("[Email Verification] Code already used or invalid.");
              await auth.currentUser?.reload(); // attempt to recover
            } else {
              throw error;
            }
          }
          setStatus("success");

          // Step 2: Reload or re-authenticate
          let currentUser = auth.currentUser;

          if (!currentUser) {
            // User is likely not signed in, attempt to re-authenticate
            console.warn("[Email Verification] No currentUser found. Prompting login.");
            setMessage("Your email has been verified! Please log in to continue.");
            
            // Show success toast
            toast({
              title: "Email Verified",
              description: "Your email has been verified! Please log in to continue.",
              variant: "default",
            });
            
            // Redirect to login with verified flag
            setTimeout(() => {
              setLocation("/login?verified=true");
            }, 2000);
            return;
          }

          // Step 3: Refresh token after reload
          await currentUser.reload();
          const token = await currentUser.getIdToken(true);
          tokenManager.setToken(token);

          console.log('[Email Verification] User reloaded and token refreshed:', {
            emailVerified: currentUser.emailVerified,
            tokenPresent: !!token,
          });
          
          // Update message
          setMessage("Your email has been verified!");
          
          // Show success toast
          toast({
            title: "Email Verified",
            description: "Your email has been successfully verified.",
            variant: "default",
          });

          // Step 4: Check onboarding status
          setTimeout(async () => {
            try {
              // Check if onboarding is already completed using Firebase auth
              const data = await getFreshWithAuth<{ onboardingCompleted: boolean }>('/api/firebase/auth/onboarding-status', getToken);
              
              console.log("[Email Verification] Onboarding status response:", data);
              
              if (data && data.onboardingCompleted) {
                // User has already completed onboarding, send them to dashboard
                console.log('[Email Verification] Onboarding completed, redirecting to dashboard');
                setLocation('/dashboard');
              } else {
                // New user who hasn't completed onboarding
                console.log('[Email Verification] Onboarding not completed, redirecting to onboarding flow');
                setLocation('/onboarding');
              }
            } catch (error) {
              console.error("[Email Verification] Error checking onboarding status:", error);
              // Default to onboarding if there's any error
              setLocation('/onboarding');
            }
          }, 1500);
        } else {
          // Invalid parameters
          throw new Error("Invalid verification parameters");
        }
      } catch (error) {
        console.error("[Email Verification Error]", error);
        
        // Update status and message
        setStatus("error");
        setMessage("Email verification failed. The link may be invalid or expired.");
        
        // Show error toast
        toast({
          title: "Verification Failed",
          description: "The verification link is invalid or has expired.",
          variant: "destructive",
        });
        
        // Redirect to login after short delay
        setTimeout(() => {
          setLocation("/login");
        }, 3000);
      }
    };

    verifyEmail();
  }, [setLocation, toast, getToken]);

  return (
    <div className="page-wrapper bg-white text-gray-900 flex flex-col justify-center items-center min-h-screen p-6 box-border relative">
      {/* Logo - Fixed positioned at top center with link to landing page */}
      <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-10">
        <a href="/" className="no-underline hover:opacity-80 transition-opacity">
          <h1 className="text-2xl font-bold">IELTS AI</h1>
        </a>
      </div>
      
      {/* Main Card */}
      <div className="max-w-[500px] w-full bg-white rounded-lg border border-gray-200 shadow-sm p-8 md:p-12">
        <div className="flex flex-col items-center text-center">
          {/* Status Icon */}
          <div className="mb-8">
            {status === "loading" && (
              <div className="animate-spin h-12 w-12 border-4 border-gray-300 rounded-full border-t-black"></div>
            )}
            
            {status === "success" && (
              <div className="text-green-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
                </svg>
              </div>
            )}
            
            {status === "error" && (
              <div className="text-[#ff4d4f]">
                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                  <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/>
                </svg>
              </div>
            )}
          </div>
          
          {/* Status Message */}
          <h2 className="text-3xl font-medium mb-6 text-gray-900">
            {status === "loading" ? "Verifying your email" : 
             status === "success" ? "Email Verified!" : 
             "Verification Failed"}
          </h2>
          
          <p className="text-gray-600 mb-10 text-[16px] leading-relaxed">{message}</p>
          
          {/* Additional message for redirects */}
          <p className="text-gray-500 text-sm italic">
            {status === "success" ? "Redirecting you to complete your profile setup..." : 
             status === "error" ? "Redirecting you to login..." : ""}
          </p>
        </div>
      </div>
      
      {/* Footer */}
      <div className="footer w-full max-w-[500px] mt-8 flex justify-center">
        <div className="text-center py-2 text-xs text-gray-500">
          <div className="flex flex-wrap justify-center items-center gap-4 mb-2">
            <span>© {new Date().getFullYear()} IELTS AI Limited</span>
            <a href="/privacy" className="hover:text-gray-900">Privacy Policy</a>
            <a href="/support" className="hover:text-gray-900">Support</a>
          </div>
        </div>
      </div>
    </div>
  );
}