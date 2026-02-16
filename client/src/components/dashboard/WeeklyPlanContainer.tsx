import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import WeeklyPlan from './WeeklyPlan';
import { useWeeklyPlans } from '@/hooks/useWeeklyPlans';
import { createComponentTracker } from '@/lib/firestoreTracker';
import { Badge } from '@/components/ui/badge';

// Create a tracker for this component
const weeklyPlanContainerTracker = createComponentTracker('WeeklyPlanContainer');

/**
 * Skills to display in the dashboard
 * The order here determines the tab order
 */
const SKILLS = ['Listening', 'Reading', 'Writing', 'Speaking'];
const OVERVIEW_TAB = 'Overview';
const TABS = [OVERVIEW_TAB, ...SKILLS];

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
  
  const [activeTab, setActiveTab] = useState(OVERVIEW_TAB);
  
  // Helper function to get plan by skill from the data
  const getPlanBySkill = (skill: string) => {
    if (!weeklyPlansData?.skills) return null;
    return weeklyPlansData.skills[skill.toLowerCase()] || null;
  };

  const overviewData = useMemo(() => {
    const focusSummaries: { skill: string; focus: string }[] = [];
    const combinedTasks: Array<{
      dayNumber: number | null;
      dayLabel: string;
      skill: string;
      title: string;
      duration: string;
      description?: string;
    }> = [];

    const parseDayNumber = (task: any): number | null => {
      if (typeof task?.dayNumber === 'number' && Number.isFinite(task.dayNumber)) {
        return task.dayNumber;
      }
      const dayString = typeof task?.day === 'string' ? task.day : '';
      const match = dayString.match(/\d+/);
      return match ? Number(match[0]) : null;
    };

    SKILLS.forEach(skill => {
      const plan = getPlanBySkill(skill);
      if (!plan) return;

      const focusText = plan.planData?.weekFocus || plan.weekFocus || '';
      if (focusText) {
        focusSummaries.push({ skill, focus: focusText });
      }

      const planTasks = Array.isArray(plan.planData?.plan)
        ? (plan.planData?.plan as any[])
        : [];

      planTasks.forEach(task => {
        const dayNumber = parseDayNumber(task);
        const dayLabel = typeof task?.day === 'string' && task.day.trim().length > 0
          ? task.day
          : dayNumber
            ? `Day ${dayNumber}`
            : 'Day';

        combinedTasks.push({
          dayNumber,
          dayLabel,
          skill,
          title: task?.title || task?.originalTitle || 'Practice',
          duration: task?.duration || '—',
          description: task?.description,
        });
      });
    });

    combinedTasks.sort((a, b) => {
      const aDay = Number.isFinite(a.dayNumber) ? (a.dayNumber as number) : Number.MAX_SAFE_INTEGER;
      const bDay = Number.isFinite(b.dayNumber) ? (b.dayNumber as number) : Number.MAX_SAFE_INTEGER;
      if (aDay !== bDay) return aDay - bDay;
      return a.skill.localeCompare(b.skill);
    });

    const groupsMap = new Map<string, { dayLabel: string; dayNumber: number | null; tasks: typeof combinedTasks }>();

    combinedTasks.forEach(task => {
      const key = `${task.dayNumber ?? 'none'}-${task.dayLabel}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { dayLabel: task.dayLabel, dayNumber: task.dayNumber, tasks: [] });
      }
      groupsMap.get(key)!.tasks.push(task);
    });

    const dayGroups = Array.from(groupsMap.values())
      .sort((a, b) => {
        const aDay = Number.isFinite(a.dayNumber) ? (a.dayNumber as number) : Number.MAX_SAFE_INTEGER;
        const bDay = Number.isFinite(b.dayNumber) ? (b.dayNumber as number) : Number.MAX_SAFE_INTEGER;
        if (aDay !== bDay) return aDay - bDay;
        return a.dayLabel.localeCompare(b.dayLabel);
      })
      .map(group => ({
        ...group,
        tasks: group.tasks.sort((a, b) => a.skill.localeCompare(b.skill)),
      }));

    return {
      focusSummaries,
      dayGroups,
    };
  }, [weeklyPlansData]);
  
  // Handle skill tab selection
  const handleTabChange = (value: string) => {
    setActiveTab(value);

    if (process.env.NODE_ENV === 'development') {
      console.log(`[WeeklyPlanContainer] Switched to ${value} tab - using cached data`);
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
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="mb-4">
            {TABS.map(tab => {
              const isOverview = tab === OVERVIEW_TAB;
              const planExists = isOverview || Boolean(getPlanBySkill(tab));
              return (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  disabled={!planExists}
                  className={!planExists ? 'opacity-50 cursor-not-allowed' : ''}
                >
                  {tab}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value={OVERVIEW_TAB}>
            {overviewData.focusSummaries.length > 0 && (
              <div className="mb-6 space-y-3">
                {overviewData.focusSummaries.map(({ skill, focus }) => (
                  <div key={`focus-${skill}`} className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0 capitalize">{skill}</Badge>
                    <p className="text-sm text-gray-600">{focus}</p>
                  </div>
                ))}
              </div>
            )}

            {overviewData.dayGroups.length > 0 ? (
              <div className="space-y-4">
                {overviewData.dayGroups.map(group => (
                  <div
                    key={`overview-${group.dayLabel}-${group.dayNumber ?? 'x'}`}
                    className="border border-gray-200 rounded-lg p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700">{group.dayLabel}</span>
                      <span className="text-xs uppercase tracking-wide text-gray-400">Week {weekNumber}</span>
                    </div>
                    <div className="space-y-3">
                      {group.tasks.map(task => (
                        <div
                          key={`${group.dayLabel}-${task.skill}-${task.title}`}
                          className="flex items-start justify-between gap-4 rounded-md bg-gray-50 px-3 py-2"
                        >
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="capitalize">{task.skill}</Badge>
                              <span className="text-sm font-medium text-gray-900">{task.title}</span>
                            </div>
                            {task.description && (
                              <p className="max-w-xl text-xs text-gray-500">{task.description}</p>
                            )}
                          </div>
                          <span className="whitespace-nowrap text-sm text-gray-500">{task.duration}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Alert className="my-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No tasks found for Week {weekNumber}. Generate your study plan to see the full overview.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

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
