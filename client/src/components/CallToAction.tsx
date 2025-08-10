import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function CallToAction() {
  const { isAuthenticated } = useAuth();

  const handleSignIn = (e: React.MouseEvent) => {
    e.preventDefault();
    window.location.href = "/auth";
  };

  return (
    <section className="py-24 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className="text-xs font-medium uppercase tracking-wider border border-gray-200 py-1 px-3">Get Started</span>
          <h2 className="mt-6 text-3xl font-medium text-gray-900">
            Begin your journey to Canada today
          </h2>
          <p className="mt-4 text-xl text-gray-600 max-w-2xl mx-auto">
            Join thousands of successful Canadian immigrants who achieved their target band scores
          </p>
        </div>
        
        <div className="max-w-md mx-auto text-center">
          {isAuthenticated ? (
            <div className="space-y-6">
              <h3 className="text-xl font-medium text-gray-900">Welcome back!</h3>
              <p className="text-gray-600">You're already signed in. Continue your IELTS preparation journey.</p>
              <Button 
                className="attio-button-primary py-4 px-8 text-base"
                onClick={() => window.location.href = "/dashboard"}
              >
                Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-gray-600">Sign up to start your IELTS preparation journey.</p>
              <div className="space-y-4">
                <Button 
                  className="w-full attio-button-primary py-4 text-base"
                  onClick={handleSignIn}
                >
                  Start Preparing Now <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <p className="text-sm text-gray-500 mt-3 text-center">
                  No credit card required. Cancel anytime.
                </p>
              </div>
              <div className="flex items-center justify-center">
                <div className="border-t border-gray-200 w-full"></div>
                <span className="px-4 text-sm text-gray-500">OR</span>
                <div className="border-t border-gray-200 w-full"></div>
              </div>
              <div>
                <Button 
                  variant="outline"
                  className="w-full text-gray-900 border-gray-200 py-4 text-base"
                  onClick={handleSignIn}
                >
                  Log in
                </Button>
              </div>
            </div>
          )}
          
          <div className="mt-16 text-center">
            <p className="text-sm text-gray-500">
              By signing up, you agree to our <a href="#" className="text-gray-900 hover:underline">Terms of Service</a> and <a href="#" className="text-gray-900 hover:underline">Privacy Policy</a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
