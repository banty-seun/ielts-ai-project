import React from 'react';
import { cn } from '../../lib/utils';
import { useWeeklyPlan, WeeklyPlan as WeeklyPlanType, WeeklyPlanErrorType } from '../../hooks/useWeeklyPlan';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { 
  RefreshCw as RefreshCwIcon,
  AlertCircle as AlertCircleIcon,
  ClipboardList as ClipboardListIcon,
  LockKeyhole as LockKeyholeIcon,
  LayoutDashboard as LayoutDashboardIcon,
  ShieldAlert as ShieldAlertIcon
} from 'lucide-react';
import { Link } from 'wouter';
import { useFirebaseAuthContext } from '../../contexts/FirebaseAuthContext';
import { TaskListWithProgress } from './TaskListWithProgress';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

interface WeeklyPlanProps {
  // Either pass the weekNumber and skillFocus for non-batched operation
  weekNumber?: number;
  skillFocus?: string;
  // Or pass a plan directly for batched operation
  plan?: WeeklyPlanType;
  // Additional props for flexibility
  loading?: boolean;
  className?: string;
  showSkillLabel?: boolean;
}

/**
 * Renders a weekly study plan with tasks and progress tracking
 * Supports both direct loading via useWeeklyPlan hook and batch loading via useWeeklyPlansBatch
 */
export default function WeeklyPlan({
  weekNumber = 1,
  skillFocus = 'Listening',
  plan: passedPlan,
  loading: passedLoading,
  className,
  showSkillLabel = true
}: WeeklyPlanProps) {
  // Get Firebase auth status
  const { currentUser, loading: firebaseLoading } = useFirebaseAuthContext();
  
  // Only use the hook if we're not using batched loading
  const { 
    data: weeklyPlan, 
    isLoading, 
    error, 
    errorType,
    errorMessage,
    refetch
  } = !passedPlan ? useWeeklyPlan(weekNumber, skillFocus) : { 
    data: passedPlan, 
    isLoading: false, 
    error: null, 
    errorType: null as WeeklyPlanErrorType | null,
    errorMessage: null,
    refetch: () => {} 
  };
  
  // Determine the loading state based on props or hook
  const loading = passedLoading !== undefined ? passedLoading : isLoading;

  // Firebase authentication check
  if (!firebaseLoading && !currentUser) {
    return (
      <div className={cn("w-full", className)}>
        <Card className="border border-gray-200 rounded-lg">
          <CardContent className="p-6">
            <Alert variant="warning" className="mb-4">
              <ShieldAlertIcon className="h-4 w-4" />
              <AlertTitle>Authentication Required</AlertTitle>
              <AlertDescription>
                <p className="mb-2">You need to be signed in to view and generate weekly plans.</p>
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <Link href="/login" className="flex items-center gap-1">
                      <LockKeyholeIcon className="h-3 w-3" />
                      Sign In
                    </Link>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  // Loading skeleton
  if (loading || firebaseLoading) {
    return (
      <div className={cn("w-full", className)}>
        <Card className="border border-gray-200 rounded-lg">
          <CardContent className="p-6">
            <Skeleton className="h-6 w-3/4 mb-6" />
            
            <div>
              {Array(4).fill(0).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex items-center">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <div className="ml-4">
                      <Skeleton className="h-5 w-48 mb-1" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </div>
                  <Skeleton className="h-8 w-16 rounded-md" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error states with specific messaging based on error type
  if (error) {
    let errorIcon;
    const message = errorMessage || 'Failed to load weekly plan';
    
    // Generate appropriate error icon
    switch (errorType) {
      case 'unauthorized':
        errorIcon = <LockKeyholeIcon className="w-8 h-8 text-red-400" />;
        break;
      case 'onboarding_incomplete':
        errorIcon = <LayoutDashboardIcon className="w-8 h-8 text-amber-400" />;
        break;
      case 'not_found':
        errorIcon = <ClipboardListIcon className="w-8 h-8 text-gray-400" />;
        break;
      case 'server_error':
      case 'unknown':
      default:
        errorIcon = <AlertCircleIcon className="w-8 h-8 text-red-400" />;
    }
    
    // Generate appropriate action button
    let actionButton;
    switch (errorType) {
      case 'unauthorized':
        actionButton = (
          <Button asChild variant="outline">
            <Link href="/login" className="flex items-center gap-2">
              <LockKeyholeIcon className="w-4 h-4" />
              Log In
            </Link>
          </Button>
        );
        break;
      case 'onboarding_incomplete':
        actionButton = (
          <Button asChild variant="outline">
            <Link href="/onboarding" className="flex items-center gap-2">
              <LayoutDashboardIcon className="w-4 h-4" />
              Complete Onboarding
            </Link>
          </Button>
        );
        break;
      case 'not_found':
      case 'server_error':
      case 'unknown':
      default:
        actionButton = (
          <Button 
            variant="outline" 
            onClick={() => refetch()}
            className="flex items-center gap-2"
          >
            <RefreshCwIcon className="w-4 h-4" />
            Try Again
          </Button>
        );
    }
    
    return (
      <div className={cn("w-full", className)}>
        <Card className="border border-gray-200 rounded-lg">
          <CardContent className="p-6 text-center space-y-4">
            <div className="flex flex-col items-center justify-center gap-2">
              {errorIcon}
              <p className="text-red-500">{message}</p>
            </div>
            {actionButton}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determine weekly plan (either passed directly or from hook)
  const plan = passedPlan || weeklyPlan;
  
  // No data state
  if (!plan) {
    return (
      <div className={cn("w-full", className)}>
        <Card className="border border-gray-200 rounded-lg">
          <CardContent className="p-6 text-center space-y-4">
            <div className="flex flex-col items-center justify-center gap-2">
              <ClipboardListIcon className="w-8 h-8 text-gray-400" />
              <p className="text-gray-500">No study plan found for Week {weekNumber} - {skillFocus}</p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => refetch()}
              className="flex items-center gap-2"
            >
              <RefreshCwIcon className="w-4 h-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Extract plan data and use the appropriate week number
  const { planData, weekNumber: planWeekNumber, skillFocus: planSkillFocus } = plan;
  const { weekFocus = 'Weekly focus not available', plan: tasks = [] } = planData || {};
  const displayedWeekNumber = planWeekNumber || weekNumber;
  const displayedSkill = planSkillFocus || skillFocus;

  return (
    <div className={cn("w-full", className)}>      
      <Card className="border border-gray-200 rounded-lg">
        <CardContent className="p-6">
          {/* Display skill badge if requested */}
          {showSkillLabel && (
            <div className="mb-3">
              <Badge variant="outline">{displayedSkill}</Badge>
            </div>
          )}
          
          <h3 className="text-base font-medium mb-6">
            This week's focus: <span className="font-medium">{weekFocus}</span>
          </h3>
          
          <Separator className="my-4" />
          
          <TaskListWithProgress 
            tasks={tasks} 
            weeklyPlanId={plan.id}
            weekNumber={displayedWeekNumber}
          />
        </CardContent>
      </Card>
    </div>
  );
}