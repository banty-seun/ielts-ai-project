import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import WeeklyPlan from './WeeklyPlan';
import { useWeeklyPlans } from '@/hooks/useWeeklyPlans';
import { createComponentTracker } from '@/lib/firestoreTracker';

// Create a tracker for this component
const weeklyPlanContainerTracker = createComponentTracker('WeeklyPlanContainer');

/**
 * Skills to display in the dashboard
 * The order here determines the tab order
 */
const SKILLS = ['Listening', 'Reading', 'Writing', 'Speaking'];

interface WeeklyPlanContainerProps {
  weekNumber: number;
}

/**
 * Container component that shows weekly plans for all skills using tabs
 * Uses the optimized batch loading approach to fetch all skill plans in a single request
 */
export default function WeeklyPlanContainer({ weekNumber }: WeeklyPlanContainerProps) {
  // Get all plans for this week using the new persisted data
  const { 
    data: weeklyPlansData, 
    isLoading, 
    error, 
    errorType
  } = useWeeklyPlans(weekNumber);
  
  // Track this component viewing multiple plans
  weeklyPlanContainerTracker.trackRead('weekly_plan_views', 1);
  
  // Default to first skill
  const [activeSkill, setActiveSkill] = useState(SKILLS[0]);
  
  // Helper function to get plan by skill from the data
  const getPlanBySkill = (skill: string) => {
    if (!weeklyPlansData?.skills) return null;
    return weeklyPlansData.skills[skill.toLowerCase()] || null;
  };
  
  // Handle skill tab selection
  const handleSkillChange = (skill: string) => {
    setActiveSkill(skill);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[WeeklyPlanContainer] Switched to ${skill} tab - using cached data`);
    }
  };
  
  // Handle loading state
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl flex items-center">
            <Skeleton className="h-6 w-40" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-60 mt-2" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-full mb-4" />
          <Skeleton className="h-20 w-full mb-2" />
          <Skeleton className="h-20 w-full mb-2" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }
  
  // Handle error state
  if (error) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load your study plan. Please refresh the page and try again.
        </AlertDescription>
      </Alert>
    );
  }
  
  // Handle case where no plans are found
  if (!isLoading && (!weeklyPlansData || Object.keys(weeklyPlansData.skills || {}).length === 0)) {
    return (
      <Alert className="my-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No study plans found for Week {weekNumber}. Complete your onboarding to generate your personalized study plan.
        </AlertDescription>
      </Alert>
    );
  }
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">Week {weekNumber} Study Plan</CardTitle>
        <CardDescription>
          Track your progress across all IELTS skills
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={activeSkill} onValueChange={handleSkillChange}>
          <TabsList className="mb-4">
            {SKILLS.map(skill => (
              <TabsTrigger 
                key={skill} 
                value={skill}
                disabled={!getPlanBySkill(skill)}
                className={!getPlanBySkill(skill) ? 'opacity-50 cursor-not-allowed' : ''}
              >
                {skill}
              </TabsTrigger>
            ))}
          </TabsList>
          
          {SKILLS.map(skill => (
            <TabsContent key={skill} value={skill}>
              {getPlanBySkill(skill) ? (
                <WeeklyPlan 
                  plan={getPlanBySkill(skill)!} 
                  loading={false} 
                  showSkillLabel={false}
                />
              ) : (
                <Alert className="my-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No study plan found for {skill} in Week {weekNumber}.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}