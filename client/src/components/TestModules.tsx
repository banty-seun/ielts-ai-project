import { motion } from "framer-motion";
import { PlayCircle, BookOpen, PenTool, Mic, ChevronRight } from "lucide-react";

export default function TestModules() {
  const modules = [
    {
      title: "Listening",
      value: "listening",
      icon: <PlayCircle className="h-6 w-6 text-gray-900" />,
      description: "Enhance your listening skills with our curated audio materials and interactive exercises with AI-powered feedback."
    },
    {
      title: "Reading",
      value: "reading",
      icon: <BookOpen className="h-6 w-6 text-gray-900" />,
      description: "Improve your reading speed and comprehension with practice materials tailored to your skill level."
    },
    {
      title: "Writing",
      value: "writing",
      icon: <PenTool className="h-6 w-6 text-gray-900" />,
      description: "Master IELTS writing with our AI-powered assistant that provides detailed feedback on your essays."
    },
    {
      title: "Speaking",
      value: "speaking",
      icon: <Mic className="h-6 w-6 text-gray-900" />,
      description: "Practice speaking with our interactive AI tutor that simulates real IELTS speaking tests and provides feedback."
    }
  ];

  return (
    <section id="modules" className="py-24 bg-white border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          className="max-w-3xl mx-auto text-center mb-20"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <span className="text-xs font-medium uppercase tracking-wider border border-gray-200 py-1 px-3">Test Modules</span>
          <h2 className="mt-6 text-3xl md:text-4xl font-medium text-gray-900 leading-tight">
            Comprehensive IELTS preparation
          </h2>
          <p className="mt-4 text-xl text-gray-600">
            AI-powered tutoring for all four IELTS test components
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-12 md:gap-16">
          {modules.map((module, index) => (
            <motion.div 
              key={index}
              className="border-t border-gray-200 pt-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 border border-gray-200 rounded-full flex items-center justify-center mr-3">
                  {module.icon}
                </div>
                <h3 className="text-xl font-medium text-gray-900">{module.title}</h3>
              </div>
              <p className="text-gray-600 mb-4">{module.description}</p>
              <a href={`#${module.value}-details`} className="inline-flex items-center text-gray-900 font-medium hover:text-gray-600 transition-colors">
                Learn more 
                <ChevronRight className="ml-2 h-4 w-4" />
              </a>
            </motion.div>
          ))}
        </div>
        
        <motion.div
          className="mt-24 text-center border-t border-gray-100 pt-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-lg text-gray-900 mb-2 font-medium">Ready to start your IELTS journey?</p>
          <p className="text-gray-600 mb-8">Our AI tutor is available 24/7 to help you prepare</p>
          <a href="#pricing" className="attio-button-primary inline-flex py-3 px-6">Get Started</a>
        </motion.div>
      </div>
    </section>
  );
}
