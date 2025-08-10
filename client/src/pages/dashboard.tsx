import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useFirebaseAuthContext } from '../contexts/FirebaseAuthContext';
import { useLocation } from 'wouter';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { AuthStatus } from '../components/AuthStatus';
import { postFreshWithAuth } from '../lib/apiClient';
import { useOnboardingStatus } from '../hooks/useOnboardingStatus';
import { useUserOnboarding } from '../hooks/useUserOnboarding';
import { createComponentTracker, logFirestoreMetricsSummary, resetFirestoreMetrics } from '../lib/firestoreTracker';
import { 
  Headphones, BookOpen, MessageSquare, Mic, Calendar, 
  Clock, ArrowRight, BarChart, CheckCircle, 
  Settings, User, Home, ChevronRight, Target,
  X, MinusSquare, ShieldAlert
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { format } from 'date-fns';
import WeeklyPlan from '../components/dashboard/WeeklyPlan';
import WeeklyPlanContainer from '../components/dashboard/WeeklyPlanContainer';
import { getCurrentWeekNumber, UserProfile } from '../lib/weekUtils';

// Create a tracker for Dashboard component
const dashboardTracker = createComponentTracker('Dashboard');

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const { currentUser, loading: authLoading } = useFirebaseAuthContext();
  const { onboardingCompleted, isLoading: onboardingLoading } = useOnboardingStatus();
  const { data: onboardingData, isLoading: onboardingDataLoading } = useUserOnboarding();
  const [, setLocation] = useLocation();
  const [showMobileCoach, setShowMobileCoach] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [showAuthStatus, setShowAuthStatus] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Log Firestore metrics when in development mode
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Log metrics when dashboard mounts
      const timer = setTimeout(() => {
        logFirestoreMetricsSummary();
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, []);
  
  // Add guard to redirect if onboarding is incomplete
  if (!onboardingLoading && !onboardingCompleted) {
    console.log('[Dashboard] Onboarding incomplete, redirecting to /onboarding');
    setLocation('/onboarding');
    return null;
  }
  
  // Get the getToken function from the Firebase context outside the function
  const { getToken } = useFirebaseAuthContext();
  
  // Function to generate a weekly plan using Firebase auth
  const generateWeeklyPlan = async (skill: string = 'Listening') => {
    try {
      setIsGeneratingPlan(true);
      setGenerationError(null);
      
      console.log(`Generating ${skill} plan for week ${currentWeek}...`);
      
      // Use postFreshWithAuth to ensure we have the latest token
      const data = await postFreshWithAuth(
        '/api/firebase/weekly-plan/generate-listening',
        { weekNumber: currentWeek },
        getToken
      );
      
      console.log('Weekly plan generated successfully:', data);
      
      // Reload the page to show the new plan
      window.location.reload();
    } catch (error) {
      console.error('Error generating weekly plan:', error);
      setGenerationError(error instanceof Error ? error.message : 'Failed to generate weekly plan');
    } finally {
      setIsGeneratingPlan(false);
    }
  };
  
  // Function to handle showing Firestore metrics
  const handleShowMetrics = () => {
    logFirestoreMetricsSummary();
    setShowMetrics(!showMetrics);
  };
  
  // Calculate current week when user data is available
  useEffect(() => {
    if (user) {
      const userProfile: UserProfile = {
        id: user.id || '',
        // Handle the string createdAt from AuthUser type
        createdAt: user.createdAt ? new Date(user.createdAt) : new Date()
      };
      
      const calculatedWeek = getCurrentWeekNumber(userProfile);
      
      // Only update state if the calculated week is different from current state
      if (calculatedWeek && calculatedWeek !== currentWeek) {
        console.log("Week Number (Dashboard):", calculatedWeek, "Current:", currentWeek);
        setCurrentWeek(calculatedWeek);
      }
    }
  }, [user?.createdAt, currentWeek]);
  
  // Detect if keyboard is visible on mobile
  useEffect(() => {
    // Function to check if keyboard is likely visible based on window size
    const checkKeyboard = () => {
      // Only relevant on mobile devices
      if (window.innerWidth >= 768) return;
      
      // Get the visual viewport height (accounts for keyboard on most mobile browsers)
      const windowHeight = window.innerHeight;
      const visualViewportHeight = window.visualViewport?.height || windowHeight;
      
      // If visual viewport height is significantly less than window height, keyboard is likely open
      const keyboardThreshold = 150; // Typical keyboard height threshold in pixels
      setIsKeyboardVisible(windowHeight - visualViewportHeight > keyboardThreshold);
    };
    
    // Add event listeners to detect changes
    window.visualViewport?.addEventListener('resize', checkKeyboard);
    window.addEventListener('resize', checkKeyboard);
    
    // Check on mount
    checkKeyboard();
    
    return () => {
      window.visualViewport?.removeEventListener('resize', checkKeyboard);
      window.removeEventListener('resize', checkKeyboard);
    };
  }, []);
  
  // Auto-scroll to bottom of messages when keyboard opens
  useEffect(() => {
    if (isKeyboardVisible && showMobileCoach) {
      // Scroll the message container to the bottom
      const messageContainer = document.querySelector('.ai-coach-messages');
      if (messageContainer) {
        messageContainer.scrollTop = messageContainer.scrollHeight;
      }
      
      // Focus the input
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isKeyboardVisible, showMobileCoach]);

  // Mock data for tasks
  const tasks = [
    {
      id: '1',
      title: 'Listening Practice: Office Dialogue',
      day: 'Today',
      completed: true,
      type: 'listening',
      duration: 30,
    },
    {
      id: '2',
      title: 'Reading: IELTS Academic Passage',
      day: 'Today',
      completed: false,
      type: 'reading',
      duration: 45,
    },
    {
      id: '3',
      title: 'Writing: Task 1 (Graph description)',
      day: 'Tomorrow',
      completed: false,
      type: 'writing',
      duration: 40,
    },
    {
      id: '4',
      title: 'Speaking: Part 2 (Describe a person)',
      day: 'Tomorrow',
      completed: false,
      type: 'speaking',
      duration: 20,
    },
  ];

  // Define skill data using real onboarding data
  const skills = [
    { 
      name: 'Listening', 
      icon: <Headphones className="h-4 w-4" />, 
      score: onboardingData?.skillRatings?.listening || 0, 
      progress: ((onboardingData?.skillRatings?.listening || 0) / 9) * 100 
    },
    { 
      name: 'Reading', 
      icon: <BookOpen className="h-4 w-4" />, 
      score: onboardingData?.skillRatings?.reading || 0, 
      progress: ((onboardingData?.skillRatings?.reading || 0) / 9) * 100 
    },
    { 
      name: 'Writing', 
      icon: <MessageSquare className="h-4 w-4" />, 
      score: onboardingData?.skillRatings?.writing || 0, 
      progress: ((onboardingData?.skillRatings?.writing || 0) / 9) * 100 
    },
    { 
      name: 'Speaking', 
      icon: <Mic className="h-4 w-4" />, 
      score: onboardingData?.skillRatings?.speaking || 0, 
      progress: ((onboardingData?.skillRatings?.speaking || 0) / 9) * 100 
    },
  ];

  if (isLoading || onboardingLoading || onboardingDataLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse h-2 w-24 bg-gray-200 rounded-full"></div>
      </div>
    );
  }

  // Calculate days until test date
  const calculateDaysUntilTest = () => {
    if (!onboardingData?.testDate || onboardingData.notDecided) {
      return null;
    }
    const testDate = new Date(onboardingData.testDate);
    const today = new Date();
    const diffTime = testDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const daysUntilTest = calculateDaysUntilTest();
  
  // Calculate average current skill level
  const calculateCurrentBand = () => {
    if (!onboardingData?.skillRatings) return 0;
    const { listening, reading, writing, speaking } = onboardingData.skillRatings;
    return (listening + reading + writing + speaking) / 4;
  };

  const currentBand = calculateCurrentBand();

  // AI Coach messages
  const messages = [
    {
      id: '1',
      content: "Based on your progress, I recommend focusing on listening comprehension with Canadian accents. Would you like a custom practice session?",
      sender: 'ai',
      timestamp: '11:05 AM',
    },
    {
      id: '2',
      content: "Yes, that sounds good.",
      sender: 'user',
      timestamp: '11:06 AM',
    },
    {
      id: '3',
      content: "Great! I've created a 20-minute listening practice on Canadian academic contexts. This targets your specific challenges in section 3.",
      sender: 'ai',
      timestamp: '11:06 AM',
    },
    {
      id: '4',
      content: "What specific aspects of Canadian accents should I focus on?",
      sender: 'user',
      timestamp: '11:07 AM',
    },
    {
      id: '5',
      content: "You should focus on vowel sounds and intonation patterns that are unique to Canadian English. Pay special attention to how Canadians pronounce words with 'ou' like 'about' and how sentence stress differs from British English.",
      sender: 'ai',
      timestamp: '11:07 AM',
    },
    {
      id: '6',
      content: "Can you suggest some practice resources?",
      sender: 'user',
      timestamp: '11:08 AM',
    },
    {
      id: '7',
      content: "I recommend CBC News podcasts, Canadian TED talks, and the University of Toronto lecture series. I've added these to your listening practice queue with timestamps for the most relevant sections.",
      sender: 'ai',
      timestamp: '11:09 AM',
    },
  ];

  const renderAICoach = (isMobile = false) => (
    <div className={`border border-gray-200 rounded-lg overflow-hidden ${isMobile ? 'h-[450px]' : 'h-[500px]'} flex flex-col`}>
      <div className="bg-gray-50 p-3 border-b flex items-center justify-between">
        <div className="flex items-center">
          <span className="p-1 bg-black rounded-full mr-2">
            <MessageSquare className="h-3 w-3 text-white" />
          </span>
          <span className="text-sm font-medium">Your IELTS Assistant</span>
        </div>
        {isMobile && (
          <button 
            onClick={() => setShowMobileCoach(false)}
            className="p-1 rounded-full hover:bg-gray-200"
          >
            <MinusSquare className="h-4 w-4 text-gray-500" />
          </button>
        )}
      </div>
      
      <div className="p-4 flex-grow overflow-y-auto ai-coach-messages">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
            <div 
              className={`${
                message.sender === 'user' 
                  ? 'bg-black text-white rounded-lg rounded-br-none' 
                  : 'bg-gray-100 rounded-lg rounded-tl-none'
              } p-3 max-w-[90%]`}
            >
              <p className="text-sm">{message.content}</p>
              <p className={`text-xs ${message.sender === 'user' ? 'text-gray-400' : 'text-gray-500'} mt-1`}>
                {message.timestamp}
              </p>
            </div>
          </div>
        ))}
      </div>
      
      <div className="p-3 border-t mt-auto">
        <div className="flex rounded-md border border-gray-200 overflow-hidden bg-gray-50">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask your AI coach..."
            className="flex-grow px-3 py-2 text-sm focus:outline-none bg-transparent"
          />
          <Button size="sm" className="rounded-l-none">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-white">
        {/* Top Navigation */}
        {/* Auth Status Modal */}
        {showAuthStatus && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">Authentication Status</h3>
                <button 
                  onClick={() => setShowAuthStatus(false)} 
                  className="p-1 rounded-full hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <AuthStatus />
              <div className="mt-4 flex justify-end">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setShowAuthStatus(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {/* Development-only Firestore metrics panel */}
        {process.env.NODE_ENV === 'development' && showMetrics && (
          <div className="fixed top-16 right-0 w-80 bg-white border-l border-b border-gray-200 shadow-md z-30 p-3 text-xs overflow-auto max-h-[80vh]">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold">Firestore Metrics</h3>
              <div>
                <button 
                  onClick={() => { resetFirestoreMetrics(); logFirestoreMetricsSummary(); }}
                  className="text-xs mr-2 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded"
                >
                  Reset
                </button>
                <button 
                  onClick={() => logFirestoreMetricsSummary()}
                  className="text-xs mr-2 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded"
                >
                  Refresh
                </button>
                <button 
                  onClick={() => setShowMetrics(false)}
                  className="text-xs"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="text-xs mb-2">
              <p className="font-semibold">To view detailed metrics:</p>
              <p>Check your browser's console after clicking "Refresh"</p>
            </div>
            <hr className="my-2" />
            <p className="opacity-70">
              This panel only appears in development mode and helps track Firestore usage to optimize performance.
            </p>
          </div>
        )}
        
        <header className="border-b border-gray-100">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-8">
              <span className="font-semibold text-xl">IELTS AI</span>
              <nav className="hidden md:flex space-x-6">
                <a href="/dashboard" className="text-black font-medium text-sm flex items-center">
                  <Home className="h-4 w-4 mr-1" /> Dashboard
                </a>
                <a href="/progress" className="text-gray-500 hover:text-black text-sm flex items-center">
                  <BarChart className="h-4 w-4 mr-1" /> Progress
                </a>
                <a href="/practice" className="text-gray-500 hover:text-black text-sm flex items-center">
                  <BookOpen className="h-4 w-4 mr-1" /> Practice
                </a>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              {/* Development mode: Firestore metrics button */}
              {process.env.NODE_ENV === 'development' && (
                <div className="hidden md:flex">
                  <button
                    onClick={handleShowMetrics}
                    className="px-3 py-1.5 text-xs rounded bg-gray-100 hover:bg-gray-200 flex items-center gap-1"
                  >
                    <BarChart className="h-3 w-3" /> {showMetrics ? 'Hide' : 'Show'} Metrics
                  </button>
                </div>
              )}
              
              {/* Authentication Status */}
              <div className="hidden md:flex gap-2">
                <button 
                  onClick={() => setShowAuthStatus(!showAuthStatus)}
                  className="px-3 py-1.5 text-xs rounded bg-black text-white hover:bg-gray-800 flex items-center gap-1"
                >
                  <ShieldAlert className="h-3 w-3" /> Auth Status
                </button>
              </div>
              
              {/* User Account Button */}
              <button className="flex items-center text-sm text-gray-600 hover:text-black">
                <span className="hidden md:inline mr-2">Account</span>
                <div className="h-8 w-8 rounded-full border border-gray-200 flex items-center justify-center">
                  <User className="h-4 w-4" />
                </div>
              </button>
            </div>
          </div>
        </header>
        
        {/* Main Content */}
        <main className="max-w-5xl mx-auto px-4 py-6 pb-24 md:pb-16">
          {/* Header + Date */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold">
                Hello, {onboardingData?.fullName || user?.firstName || user?.username || 'Student'}
              </h1>
              <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 mt-1">
                <p className="text-gray-500 flex items-center text-sm">
                  <Calendar className="h-4 w-4 mr-1" /> {format(new Date(), 'EEEE, MMMM d, yyyy')}
                </p>

              </div>
            </div>
            <Button className="mt-4 md:mt-0 bg-black text-white hover:bg-gray-800">
              Start Practice Session
            </Button>
          </div>
          
          {/* Progress Overview Card */}
          <div className="border border-gray-200 rounded-lg p-5 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium">Your Progress</h2>
              <button className="text-xs text-gray-500 hover:text-black flex items-center">
                <Settings className="h-3 w-3 mr-1" /> Update Goals
              </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Target Score */}
              <div className="border border-gray-100 rounded-md p-3 flex flex-col">
                <span className="text-xs text-gray-500 mb-1">Target Score</span>
                <div className="flex items-center">
                  <Target className="h-4 w-4 mr-1 text-gray-500" />
                  <span className="text-xl font-semibold">
                    {onboardingData?.targetBandScore?.toFixed(1) || 'N/A'}
                  </span>
                </div>
              </div>
              
              {/* Days Until Test */}
              <div className="border border-gray-100 rounded-md p-3 flex flex-col">
                <span className="text-xs text-gray-500 mb-1">Days to Test</span>
                <div className="flex items-center">
                  <Clock className="h-4 w-4 mr-1 text-gray-500" />
                  <span className="text-xl font-semibold">
                    {daysUntilTest !== null ? daysUntilTest : 'TBD'}
                  </span>
                </div>
              </div>
              
              {/* Current Score */}
              <div className="border border-gray-100 rounded-md p-3 flex flex-col">
                <span className="text-xs text-gray-500 mb-1">Current Band</span>
                <div className="flex items-center">
                  <BarChart className="h-4 w-4 mr-1 text-gray-500" />
                  <span className="text-xl font-semibold">
                    {currentBand > 0 ? currentBand.toFixed(1) : 'N/A'}
                  </span>
                </div>
              </div>
              
              {/* Weekly goal */}
              <div className="border border-gray-100 rounded-md p-3 flex flex-col">
                <span className="text-xs text-gray-500 mb-1">Weekly Goal</span>
                <div className="flex items-center">
                  <Target className="h-4 w-4 mr-1 text-gray-500" />
                  <span className="text-xl font-semibold">50%</span>
                </div>
                <div className="mt-1">
                  <Progress value={50} className="h-1 bg-gray-100" />
                </div>
              </div>
            </div>
            
            {/* Skill Progress */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {skills.map((skill) => (
                <div key={skill.name} className="flex flex-col px-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center">
                      <span className="p-1 bg-gray-100 rounded-full mr-1.5">{skill.icon}</span>
                      <span className="text-sm">{skill.name}</span>
                    </div>
                    <span className="text-sm font-medium">{skill.score}</span>
                  </div>
                  <Progress value={skill.progress} className="h-1 bg-gray-100" />
                </div>
              ))}
            </div>
          </div>
          
          {/* Two-column layout for main content */}
          <div className="flex flex-col md:flex-row gap-6">
            {/* Left Column - Tasks */}
            <div className="w-full md:w-7/12">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium">
                  Study Plan
                </h2>
                <a href="/dashboard/calendar" className="text-xs text-gray-500 hover:text-black flex items-center">
                  View Calendar <ChevronRight className="h-3 w-3 ml-1" />
                </a>
              </div>
              
              {/* Weekly Study Plan - Optimized Batch Loading */}
              <div className="mb-6">
                
                {generationError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
                    Error: {generationError}
                  </div>
                )}
                
                {/* New optimized container with batched loading of all skills */}
                <WeeklyPlanContainer weekNumber={currentWeek} />
              </div>
              
              {/* Skill Cards */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-medium">Skill Practice</h2>
                  <button 
                    onClick={() => setShowAllSkills(!showAllSkills)}
                    className="text-xs text-gray-500 hover:text-black flex items-center"
                  >
                    {showAllSkills ? 'Show Less' : 'View All'} <ChevronRight className={`h-3 w-3 ml-1 transition-transform ${showAllSkills ? 'rotate-90' : ''}`} />
                  </button>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Listening Practice Card */}
                  <div className="border border-gray-200 rounded-lg p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center">
                        <span className="p-1 bg-gray-100 rounded-full mr-2">
                          <Headphones className="h-4 w-4" />
                        </span>
                        <span className="font-medium">Listening</span>
                      </div>
                      <span className="text-sm font-medium">
                        {onboardingData?.skillRatings?.listening || 'N/A'}
                      </span>
                    </div>
                    <p className="text-sm mb-3 flex-grow">Focus on understanding British and Canadian accents in academic settings</p>
                    <a href="/practice/listening" className="mt-auto">
                      <Button variant="outline" size="sm" className="w-full border-gray-200 text-sm">
                        Start Practice
                      </Button>
                    </a>
                  </div>
                  
                  {/* Reading Practice Card */}
                  <div className="border border-gray-200 rounded-lg p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center">
                        <span className="p-1 bg-gray-100 rounded-full mr-2">
                          <BookOpen className="h-4 w-4" />
                        </span>
                        <span className="font-medium">Reading</span>
                      </div>
                      <span className="text-sm font-medium">
                        {onboardingData?.skillRatings?.reading || 'N/A'}
                      </span>
                    </div>
                    <p className="text-sm mb-3 flex-grow">Improve skimming and scanning techniques for academic passages</p>
                    <a href="/practice/reading" className="mt-auto">
                      <Button variant="outline" size="sm" className="w-full border-gray-200 text-sm">
                        Start Practice
                      </Button>
                    </a>
                  </div>
                  
                  {/* Only show Writing and Speaking cards when "View All" is clicked */}
                  {showAllSkills && (
                    <>
                      {/* Writing Practice Card */}
                      <div className="border border-gray-200 rounded-lg p-4 flex flex-col">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center">
                            <span className="p-1 bg-gray-100 rounded-full mr-2">
                              <MessageSquare className="h-4 w-4" />
                            </span>
                            <span className="font-medium">Writing</span>
                          </div>
                          <span className="text-sm font-medium">
                            {onboardingData?.skillRatings?.writing || 'N/A'}
                          </span>
                        </div>
                        <p className="text-sm mb-3 flex-grow">Develop structured essays and master data interpretation for Task 1</p>
                        <a href="/practice/writing" className="mt-auto">
                          <Button variant="outline" size="sm" className="w-full border-gray-200 text-sm">
                            Start Practice
                          </Button>
                        </a>
                      </div>
                      
                      {/* Speaking Practice Card */}
                      <div className="border border-gray-200 rounded-lg p-4 flex flex-col">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center">
                            <span className="p-1 bg-gray-100 rounded-full mr-2">
                              <Mic className="h-4 w-4" />
                            </span>
                            <span className="font-medium">Speaking</span>
                          </div>
                          <span className="text-sm font-medium">
                            {onboardingData?.skillRatings?.speaking || 'N/A'}
                          </span>
                        </div>
                        <p className="text-sm mb-3 flex-grow">Practice fluency and articulation with Canadian immigration topics</p>
                        <a href="/practice/speaking" className="mt-auto">
                          <Button variant="outline" size="sm" className="w-full border-gray-200 text-sm">
                            Start Practice
                          </Button>
                        </a>
                      </div>
                    </>
                  )}
                </div>
                
                {/* View All button for mobile that links to full practice page */}
                {showAllSkills && (
                  <div className="mt-4 text-center">
                    <a href="/practice">
                      <Button variant="outline" className="text-xs">
                        Go to Practice Hub
                      </Button>
                    </a>
                  </div>
                )}
              </div>
            </div>
            
            {/* Right Column - AI Coach - Only visible on desktop */}
            <div className="hidden md:block md:w-5/12">
              <div className="sticky top-20">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-medium">AI Coach</h2>
                </div>
                {/* Taller AI coach for desktop */}
                {renderAICoach(false)}
              </div>
            </div>
          </div>
        </main>
        
        {/* Mobile Navigation */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-10">
          <div className="flex justify-around items-center h-16">
            <a href="/dashboard" className="flex flex-col items-center justify-center text-black">
              <Home className="h-5 w-5 mb-1" />
              <span className="text-xs">Home</span>
            </a>
            <a href="/progress" className="flex flex-col items-center justify-center text-gray-500">
              <BarChart className="h-5 w-5 mb-1" />
              <span className="text-xs">Progress</span>
            </a>
            <button 
              onClick={() => setShowMobileCoach(true)}
              className="flex flex-col items-center justify-center text-gray-500"
            >
              <MessageSquare className="h-5 w-5 mb-1" />
              <span className="text-xs">AI Coach</span>
            </button>
            <a href="/practice" className="flex flex-col items-center justify-center text-gray-500">
              <BookOpen className="h-5 w-5 mb-1" />
              <span className="text-xs">Practice</span>
            </a>
            <a href="/profile" className="flex flex-col items-center justify-center text-gray-500">
              <User className="h-5 w-5 mb-1" />
              <span className="text-xs">Profile</span>
            </a>
          </div>
        </div>
        
        {/* Mobile AI Coach Pop-up */}
        {showMobileCoach && (
          <div className="md:hidden fixed inset-0 z-50 flex flex-col">
            <div className="absolute inset-0 bg-black bg-opacity-25" onClick={() => setShowMobileCoach(false)}></div>
            <div 
              className={`relative mt-auto bg-white rounded-t-xl overflow-hidden shadow-xl ${isKeyboardVisible ? 'h-[85vh]' : ''}`}
              style={{ maxHeight: isKeyboardVisible ? '85vh' : 'calc(100vh - 80px)' }}
            >
              <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto my-2"></div>
              {renderAICoach(true)}
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}