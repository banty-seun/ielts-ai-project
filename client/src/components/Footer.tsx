import { Facebook, Twitter, Instagram, Linkedin } from "lucide-react";

export default function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="border-t border-gray-100 py-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-8">
          <div className="md:col-span-1">
            <div className="text-xl font-medium text-gray-900">IELTS AI</div>
            <p className="mt-4 text-gray-600 text-sm">
              Helping aspiring immigrants achieve their Canadian dreams through AI-powered IELTS preparation.
            </p>
          </div>

          <div className="md:col-span-1">
            <h3 className="text-sm font-medium text-gray-900 mb-4">Product</h3>
            <ul className="space-y-2 text-sm">
              <li><a href="#features" className="text-gray-600 hover:text-gray-900">Features</a></li>
              <li><a href="#pricing" className="text-gray-600 hover:text-gray-900">Pricing</a></li>
              <li><a href="#testimonials" className="text-gray-600 hover:text-gray-900">Testimonials</a></li>
            </ul>
          </div>

          <div className="md:col-span-1">
            <h3 className="text-sm font-medium text-gray-900 mb-4">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="text-gray-600 hover:text-gray-900">IELTS Guide</a></li>
              <li><a href="#" className="text-gray-600 hover:text-gray-900">Practice Tests</a></li>
              <li><a href="#" className="text-gray-600 hover:text-gray-900">Immigration Tips</a></li>
            </ul>
          </div>

          <div className="md:col-span-1">
            <h3 className="text-sm font-medium text-gray-900 mb-4">Company</h3>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="text-gray-600 hover:text-gray-900">About Us</a></li>
              <li><a href="#" className="text-gray-600 hover:text-gray-900">Contact</a></li>
              <li><a href="#" className="text-gray-600 hover:text-gray-900">Privacy</a></li>
              <li><a href="#" className="text-gray-600 hover:text-gray-900">Terms</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-100 flex flex-col md:flex-row justify-between items-center">
          <p className="text-sm text-gray-500">© {currentYear} IELTS AI. All rights reserved.</p>
          <div className="mt-4 md:mt-0 flex space-x-4">
            <a href="#" className="text-gray-400 hover:text-gray-900">
              <Facebook className="h-5 w-5" />
            </a>
            <a href="#" className="text-gray-400 hover:text-gray-900">
              <Twitter className="h-5 w-5" />
            </a>
            <a href="#" className="text-gray-400 hover:text-gray-900">
              <Instagram className="h-5 w-5" />
            </a>
            <a href="#" className="text-gray-400 hover:text-gray-900">
              <Linkedin className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
