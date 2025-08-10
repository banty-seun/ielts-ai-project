import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function Hero() {
  const { isAuthenticated } = useAuth();
  const benefits = [
    "Personalized AI tutoring",
    "Real IELTS-style practice tests",
    "Detailed performance analytics",
    "Canadian immigration focus"
  ];

  const handleSignIn = (e: React.MouseEvent) => {
    e.preventDefault();
    window.location.href = "/auth";
  };

  return (
    <section className="pt-32 pb-16 md:pt-40 md:pb-20 bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          {/* Hero Text */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-16"
          >
            <motion.span 
              className="inline-block py-1 px-3 mb-5 text-xs font-medium uppercase tracking-wider border border-gray-200"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              AI-Powered IELTS Preparation
            </motion.span>
            <motion.h1 
              className="text-4xl md:text-5xl lg:text-6xl font-medium text-gray-900 leading-tight mb-6 max-w-4xl mx-auto"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            >
              Mastering IELTS for Canadian Immigration
            </motion.h1>
            <motion.p 
              className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
            >
              Your personal AI tutor that helps you prepare for all IELTS sections with Canada-specific content, real-time feedback, and performance analytics.
            </motion.p>
            
            {/* CTA Buttons */}
            <motion.div 
              className="flex flex-col sm:flex-row justify-center gap-4 mb-8"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.4 }}
            >
              {isAuthenticated ? (
                <Button 
                  className="attio-button-primary py-6 px-8 text-base min-w-[180px]"
                  onClick={() => window.location.href = "/dashboard"}
                >
                  Go to Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <>
                  <Button 
                    className="attio-button-primary py-6 px-8 text-base min-w-[180px]"
                    onClick={handleSignIn}
                  >
                    Start Free Trial
                  </Button>
                  <Button 
                    variant="outline" 
                    className="attio-button-secondary py-6 px-8 text-base min-w-[180px]"
                    onClick={handleSignIn}
                  >
                    View Demo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </>
              )}
            </motion.div>
            
            {!isAuthenticated && (
              <motion.p 
                className="text-sm text-gray-500"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.5 }}
              >
                No credit card required. 7-day free trial.
              </motion.p>
            )}
          </motion.div>
          
          {/* Benefits Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="grid md:grid-cols-4 gap-8 border-t border-gray-100 pt-16"
          >
            {benefits.map((benefit, index) => (
              <div key={index} className="flex flex-col items-center">
                <div className="w-10 h-10 border border-gray-200 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="h-5 w-5 text-gray-900" />
                </div>
                <p className="text-gray-900 font-medium">{benefit}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
