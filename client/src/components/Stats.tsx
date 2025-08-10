import { motion } from "framer-motion";

export default function Stats() {
  const stats = [
    { value: "98%", label: "Success Rate", description: "of users achieve their target band score" },
    { value: "10,000+", label: "Users", description: "helped to reach their immigration goals" },
    { value: "7.5+", label: "Average Score", description: "achieved by users after 8 weeks of training" },
    { value: "24/7", label: "Support", description: "from our AI tutor whenever you need help" }
  ];

  return (
    <section className="py-20 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <span className="text-xs font-medium uppercase tracking-wider border border-gray-200 py-1 px-3">Results</span>
          <h2 className="mt-6 text-3xl font-medium text-gray-900">Trusted by thousands of migrants</h2>
          <p className="mt-4 text-xl text-gray-600 max-w-3xl mx-auto">
            Our AI-powered platform has helped people across the globe achieve their Canadian immigration goals
          </p>
        </motion.div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <motion.div 
              key={index} 
              className="border-t border-gray-200 pt-6"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <p className="text-3xl font-medium text-gray-900">{stat.value}</p>
              <p className="mt-2 font-medium text-gray-900">{stat.label}</p>
              <p className="mt-1 text-sm text-gray-600">{stat.description}</p>
            </motion.div>
          ))}
        </div>
        
        <motion.div 
          className="mt-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <div className="inline-flex flex-col md:flex-row items-center justify-center gap-4">
            <span className="text-gray-500">Trusted by candidates applying to</span>
            <div className="flex flex-wrap items-center justify-center gap-8">
              <div className="text-gray-900 font-medium">University of Toronto</div>
              <div className="text-gray-900 font-medium">McGill University</div>
              <div className="text-gray-900 font-medium">UBC</div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
