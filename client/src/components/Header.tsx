import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu, X, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isAuthenticated } = useAuth();
  const [location, setLocation] = useLocation();

  const toggleMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleSignIn = (e: React.MouseEvent) => {
    e.preventDefault();
    setLocation("/login");
  };
  
  const handleSignUp = (e: React.MouseEvent) => {
    e.preventDefault();
    setLocation("/auth");
  };

  const handleSignOut = (e: React.MouseEvent) => {
    e.preventDefault();
    window.location.href = "/api/logout";
  };

  return (
    <header className="fixed top-0 left-0 w-full bg-white z-50 border-b border-gray-200">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 md:h-20">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <span className="text-xl font-medium text-gray-900">IELTS AI</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex md:items-center space-x-8">
            <a href="#features" className="text-gray-600 hover:text-gray-900 font-medium">Features</a>
            <a href="#modules" className="text-gray-600 hover:text-gray-900 font-medium">Test Modules</a>
            <a href="#pricing" className="text-gray-600 hover:text-gray-900 font-medium">Pricing</a>
            <a href="#about" className="text-gray-600 hover:text-gray-900 font-medium">About</a>
          </nav>

          {/* CTA Buttons */}
          <div className="flex items-center space-x-6">
            {isAuthenticated ? (
              <>
                <div className="hidden md:flex items-center space-x-2">
                  <User className="h-5 w-5 text-gray-600" />
                  <span className="text-gray-900 font-medium">{user?.username || 'User'}</span>
                </div>
                <Button 
                  variant="outline" 
                  className="text-gray-900 border-gray-200 hover:bg-gray-100 px-4 py-2"
                  onClick={handleSignOut}
                >
                  Sign Out
                </Button>
              </>
            ) : (
              <>
                <a 
                  href="/login" 
                  className="hidden md:inline-flex text-gray-900 hover:text-gray-600 font-medium"
                  onClick={handleSignIn}
                >
                  Sign in
                </a>
                <Button 
                  variant="default" 
                  className="attio-button-primary px-4 py-2"
                  onClick={handleSignUp}
                >
                  Get Started
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center">
            <button 
              type="button" 
              className="text-gray-900 hover:text-gray-600 focus:outline-none" 
              onClick={toggleMenu}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      <div 
        className={`${mobileMenuOpen ? 'block' : 'hidden'} md:hidden bg-white border-t border-gray-200 absolute w-full`}
        aria-hidden={!mobileMenuOpen}
      >
        <div className="px-4 py-3 space-y-1">
          <a 
            href="#features" 
            className="block py-2 text-base font-medium text-gray-900 hover:text-gray-600"
            onClick={() => setMobileMenuOpen(false)}
          >
            Features
          </a>
          <a 
            href="#modules" 
            className="block py-2 text-base font-medium text-gray-900 hover:text-gray-600"
            onClick={() => setMobileMenuOpen(false)}
          >
            Test Modules
          </a>
          <a 
            href="#pricing" 
            className="block py-2 text-base font-medium text-gray-900 hover:text-gray-600"
            onClick={() => setMobileMenuOpen(false)}
          >
            Pricing
          </a>
          <a 
            href="#about" 
            className="block py-2 text-base font-medium text-gray-900 hover:text-gray-600"
            onClick={() => setMobileMenuOpen(false)}
          >
            About
          </a>
          <div className="pt-4 pb-2 border-t border-gray-200 mt-2">
            {isAuthenticated ? (
              <>
                <div className="flex items-center py-2">
                  <User className="h-5 w-5 text-gray-600 mr-2" />
                  <span className="text-gray-900 font-medium">{user?.username || 'User'}</span>
                </div>
                <Button 
                  variant="outline" 
                  className="w-full text-gray-900 border-gray-200 hover:bg-gray-100 mt-3"
                  onClick={(e) => {
                    setMobileMenuOpen(false);
                    handleSignOut(e);
                  }}
                >
                  Sign Out
                </Button>
              </>
            ) : (
              <>
                <a
                  href="/login"
                  className="block py-2 text-base font-medium text-gray-900 hover:text-gray-600"
                  onClick={(e) => {
                    setMobileMenuOpen(false);
                    handleSignIn(e);
                  }}
                >
                  Sign in
                </a>
                <Button 
                  variant="default" 
                  className="w-full attio-button-primary mt-3"
                  onClick={(e) => {
                    setMobileMenuOpen(false);
                    handleSignUp(e);
                  }}
                >
                  Get Started
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
