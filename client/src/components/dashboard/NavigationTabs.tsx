import React from 'react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { Home, BarChart3, BookOpen, User } from 'lucide-react';

interface NavigationTabsProps {
  activeTab: string;
}

export function NavigationTabs({ activeTab }: NavigationTabsProps) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: <Home className="h-5 w-5" /> },
    { id: 'insight', label: 'Progress', href: '/insight', icon: <BarChart3 className="h-5 w-5" /> },
    { id: 'practice', label: 'Practice', href: '/practice', icon: <BookOpen className="h-5 w-5" /> },
  ];

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-200">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="text-xl font-bold text-black">
              IELTS AI
            </Link>
          </div>
          
          {/* Desktop Navigation Tabs */}
          <div className="hidden md:flex items-center space-x-1">
            {tabs.map((tab) => (
              <Link
                key={tab.id}
                href={tab.href}
                className={cn(
                  'px-4 py-2 rounded-md text-sm font-medium flex items-center space-x-1',
                  activeTab === tab.id
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </Link>
            ))}
          </div>
          
          {/* User Profile */}
          <div className="flex items-center">
            <Link 
              href="/profile" 
              className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 transition-colors"
            >
              <span className="text-sm font-medium hidden sm:block">My Account</span>
              <div className="h-8 w-8 rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center">
                <User className="h-4 w-4 text-gray-600" />
              </div>
            </Link>
          </div>
        </div>
      </div>
      
      {/* Mobile Navigation - Fixed to bottom */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-10">
        <div className="flex justify-around items-center h-16">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                'flex flex-col items-center justify-center px-2 py-1',
                activeTab === tab.id
                  ? 'text-black'
                  : 'text-gray-500 hover:text-gray-900'
              )}
            >
              <div className="mb-1">
                {tab.icon}
              </div>
              <span className="text-xs">{tab.label}</span>
            </Link>
          ))}
          <Link
            href="/profile"
            className="flex flex-col items-center justify-center px-2 py-1 text-gray-500 hover:text-gray-900"
          >
            <div className="mb-1">
              <User className="h-5 w-5" />
            </div>
            <span className="text-xs">Profile</span>
          </Link>
        </div>
      </div>
    </header>
  );
}