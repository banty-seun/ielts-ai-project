import { motion } from "framer-motion";
import { 
  LayoutGrid, 
  Users, 
  MessageSquare, 
  LineChart, 
  Layers, 
  Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Features() {
  const features = [
    {
      icon: <LayoutGrid className="h-6 w-6 text-gray-900" />,
      title: "AI Personalized Learning",
      description: "Our AI analyzes your strengths and weaknesses to create a personalized study plan tailored to your IELTS preparation needs."
    },
    {
      icon: <MessageSquare className="h-6 w-6 text-gray-900" />,
      title: "Real-time Feedback",
      description: "Get immediate feedback on your writing and speaking tasks with specific suggestions for improvement from our advanced AI tutor."
    },
    {
      icon: <Users className="h-6 w-6 text-gray-900" />,
      title: "Interactive Practice",
      description: "Engage with our AI tutor for realistic speaking practice and interactive listening exercises that simulate real exam conditions."
    },
    {
      icon: <LineChart className="h-6 w-6 text-gray-900" />,
      title: "Performance Analytics",
      description: "Track your progress with detailed analytics and insights that help you identify areas for improvement and focus your study efforts."
    },
    {
      icon: <Layers className="h-6 w-6 text-gray-900" />,
      title: "Mock Exams",
      description: "Practice with full-length mock tests that closely simulate the actual IELTS exam environment and provide accurate scoring."
    },
    {
      icon: <Globe className="h-6 w-6 text-gray-900" />,
      title: "Canadian Content",
      description: "Access specially curated material focused on Canadian culture, society, and immigration processes to better prepare for your move."
    }
  ];

  return (
    <section id="features" className="py-24 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <motion.div 
          className="max-w-3xl mx-auto text-center mb-20"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <span className="text-xs font-medium uppercase tracking-wider border border-gray-200 py-1 px-3">Features</span>
          <h2 className="mt-6 text-3xl md:text-4xl font-medium text-gray-900 leading-tight">
            AI-powered features to help you succeed
          </h2>
          <p className="mt-4 text-xl text-gray-600">
            Cutting-edge technology combined with proven IELTS preparation techniques
          </p>
        </motion.div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-16">
          {features.map((feature, index) => (
            <motion.div 
              key={index}
              className="flex flex-col"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="w-10 h-10 border border-gray-200 rounded-full flex items-center justify-center mb-6">
                {feature.icon}
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">{feature.title}</h3>
              <p className="text-gray-600 text-sm">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
        
        {/* CTA */}
        <motion.div 
          className="mt-24 text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Button className="attio-button-primary min-w-[200px] py-6">
            Explore All Features
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
