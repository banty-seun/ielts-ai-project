import { motion } from "framer-motion";
import { Quote } from "lucide-react";

export default function Testimonials() {
  const testimonials = [
    {
      content: "The AI tutor helped me overcome my fear of the speaking section. I practiced daily with the AI, and it improved my confidence dramatically. I scored 7.5 overall and now live in Toronto!",
      author: "Sarah J.",
      profession: "Software Engineer",
      location: "Toronto, Canada",
      bandScore: "7.5"
    },
    {
      content: "Writing was always my weakness. The detailed feedback from the AI tutor on my essays made all the difference. I went from a 6.0 to an 8.0 in writing. I'm now settled in Vancouver!",
      author: "Michael T.",
      profession: "Digital Marketer",
      location: "Vancouver, Canada",
      bandScore: "8.0"
    },
    {
      content: "What impressed me most was how the platform adapted to my learning style. The personalized study plan helped me focus on my weak areas. I prepared for just 2 months and got a band score of 7.0.",
      author: "Priya K.",
      profession: "UX Designer",
      location: "Vancouver, Canada",
      bandScore: "7.0"
    }
  ];

  return (
    <section className="py-24 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          className="max-w-3xl mx-auto text-center mb-20"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <span className="text-xs font-medium uppercase tracking-wider border border-gray-200 py-1 px-3">Testimonials</span>
          <h2 className="mt-6 text-3xl font-medium text-gray-900">
            Success stories
          </h2>
          <p className="mt-4 text-xl text-gray-600">
            Hear from people who achieved their desired band scores and successfully moved to Canada
          </p>
        </motion.div>

        {/* Testimonials */}
        <div className="space-y-20">
          {testimonials.map((testimonial, index) => (
            <motion.div 
              key={index}
              className="border-t border-gray-200 pt-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="flex items-start">
                <div className="text-gray-900">
                  <Quote className="h-6 w-6 opacity-20" />
                </div>
                <div className="ml-4">
                  <blockquote className="text-lg text-gray-700 leading-relaxed">
                    "{testimonial.content}"
                  </blockquote>
                  <div className="mt-4">
                    <p className="font-medium text-gray-900">{testimonial.author}</p>
                    <p className="text-sm text-gray-500">{testimonial.profession}, {testimonial.location} • Band Score: {testimonial.bandScore}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
        
        {/* CTA */}
        <motion.div 
          className="mt-16 text-center border-t border-gray-100 pt-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p className="mb-6 text-lg font-medium text-gray-900">Join thousands of successful Canadian immigrants</p>
          <a href="#" className="attio-button-primary inline-flex py-3 px-8">
            Start Free Trial
          </a>
        </motion.div>
      </div>
    </section>
  );
}
