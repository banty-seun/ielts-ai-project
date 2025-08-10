import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { getFreshWithAuth } from '@/lib/apiClient';

export default function DebugPage() {
  const { user, isLoading } = useAuth();
  const { getToken } = useFirebaseAuthContext();
  const [sessionCookie, setSessionCookie] = useState<string>('');
  const [sessionStatus, setSessionStatus] = useState<any>(null);
  const [weeklyPlanData, setWeeklyPlanData] = useState<any>(null);
  const [weeklyPlanError, setWeeklyPlanError] = useState<string | null>(null);
  const [isLoadingWeeklyPlan, setIsLoadingWeeklyPlan] = useState(false);
  const [debugOutput, setDebugOutput] = useState<string[]>([]);

  useEffect(() => {
    // Get the session cookie value
    const cookies = document.cookie.split(';');
    const sessionCookie = cookies.find(c => c.trim().startsWith('ieltsprep.sid='));
    if (sessionCookie) {
      setSessionCookie(sessionCookie.trim().split('=')[1]);
    }
    
    // Load session debug info
    fetchSessionDebug();
  }, []);

  const fetchSessionDebug = async () => {
    try {
      const data = await getFreshWithAuth<any>('/api/firebase/auth/debug', getToken);
      setSessionStatus(data);
      addToDebug('Session debug fetched successfully');
    } catch (error) {
      addToDebug('Error fetching session debug: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const testLogin = async () => {
    addToDebug('Attempting Firebase test login...');
    try {
      const data = await getFreshWithAuth<any>('/api/firebase/auth/test-login', getToken);
      setSessionStatus({
        ...sessionStatus,
        firebaseTestLogin: data
      });
      
      addToDebug('Firebase test login successful: ' + JSON.stringify(data, null, 2));
      
      // If weekly plan check was included, update that state
      if (data.weeklyPlanCheck) {
        if (data.weeklyPlanCheck.found) {
          addToDebug('Weekly plan check passed! Plan found with ID: ' + data.weeklyPlanCheck.id);
        } else {
          addToDebug('Weekly plan check failed: ' + 
            (data.weeklyPlanCheck.error || 'Plan not found'));
        }
      }
      
      // Show toast notification
      toast({
        title: "Firebase Test Login Successful",
        description: "User ID: " + data.uid,
      });
      
      // Refresh session debug
      await fetchSessionDebug();
      
    } catch (error) {
      addToDebug('Firebase test login error: ' + (error instanceof Error ? error.message : String(error)));
      toast({
        title: "Firebase Test Login Failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    }
  };

  const testWhoAmI = async () => {
    addToDebug('Checking current user with Firebase authentication...');
    try {
      const data = await getFreshWithAuth<any>('/api/firebase/auth/user', getToken);
      addToDebug('Firebase user data: ' + JSON.stringify(data, null, 2));
      toast({
        title: "Firebase Authentication Successful",
        description: "User ID: " + data.id,
      });
    } catch (error) {
      addToDebug('Firebase Who Am I error: ' + (error instanceof Error ? error.message : String(error)));
      toast({
        title: "Firebase Authentication Check Failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    }
  };

  const fetchWeeklyPlan = async () => {
    setIsLoadingWeeklyPlan(true);
    setWeeklyPlanError(null);
    addToDebug('Fetching weekly plan with Firebase authentication...');
    
    try {
      const data = await getFreshWithAuth<any>('/api/firebase/weekly-plan/1/Listening', getToken);
      setWeeklyPlanData(data);
      addToDebug('Weekly plan fetched successfully with Firebase auth');
      
      toast({
        title: "Weekly Plan Loaded",
        description: "Plan ID: " + data.plan.id,
      });
    } catch (error) {
      setWeeklyPlanError(error instanceof Error ? error.message : String(error));
      addToDebug('Weekly plan fetch error: ' + (error instanceof Error ? error.message : String(error)));
      setWeeklyPlanData(null);
      
      toast({
        title: "Weekly Plan Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setIsLoadingWeeklyPlan(false);
    }
  };

  const fetchDirectWeeklyPlan = async () => {
    setIsLoadingWeeklyPlan(true);
    setWeeklyPlanError(null);
    addToDebug('Fetching weekly plan through Firebase direct debug endpoint...');
    
    try {
      const data = await getFreshWithAuth<any>('/api/firebase/debug/weekly-plan/1/Listening', getToken);
      setWeeklyPlanData(data);
      addToDebug('Direct weekly plan fetched successfully with Firebase auth');
      
      toast({
        title: "Direct Weekly Plan Loaded",
        description: "Plan ID: " + data.plan.id,
      });
    } catch (error) {
      setWeeklyPlanError(error instanceof Error ? error.message : String(error));
      addToDebug('Direct weekly plan fetch error: ' + (error instanceof Error ? error.message : String(error)));
      setWeeklyPlanData(null);
      
      toast({
        title: "Direct Weekly Plan Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setIsLoadingWeeklyPlan(false);
    }
  };

  const testCookie = async () => {
    addToDebug('Testing Firebase auth token...');
    try {
      const data = await getFreshWithAuth<any>('/api/firebase/auth/test-token', getToken);
      setSessionStatus({
        ...sessionStatus,
        tokenTest: data
      });
      addToDebug('Firebase token test result: ' + JSON.stringify(data, null, 2));
      toast({
        title: "Firebase Token Test Complete",
        description: "Check console for details",
      });
    } catch (error) {
      addToDebug('Firebase token test error: ' + (error instanceof Error ? error.message : String(error)));
      toast({
        title: "Firebase Token Test Failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    }
  };

  const addToDebug = (message: string) => {
    setDebugOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Debug Page</h1>
      
      <Tabs defaultValue="session">
        <TabsList className="mb-4">
          <TabsTrigger value="session">Session &amp; Auth</TabsTrigger>
          <TabsTrigger value="weekly-plan">Weekly Plan</TabsTrigger>
          <TabsTrigger value="logs">Debug Logs</TabsTrigger>
        </TabsList>
        
        <TabsContent value="session">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Authentication Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <span className="font-medium">Status:</span>{' '}
                    {isLoading ? (
                      'Loading...'
                    ) : user ? (
                      <span className="text-green-600 font-medium">Authenticated</span>
                    ) : (
                      <span className="text-red-600 font-medium">Not Authenticated</span>
                    )}
                  </div>
                  
                  {user && (
                    <div className="space-y-2">
                      <div>
                        <span className="font-medium">User ID:</span> {user.id}
                      </div>
                      <div>
                        <span className="font-medium">Username:</span> {user.username}
                      </div>
                      <div>
                        <span className="font-medium">Email:</span> {user.email}
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <div>
                      <span className="font-medium">Session Cookie:</span>
                    </div>
                    <div className="break-all bg-gray-100 p-2 rounded text-sm">
                      {sessionCookie || 'No session cookie found'}
                    </div>
                  </div>
                  
                  <div className="flex space-x-2 pt-2">
                    <Button onClick={testLogin}>Test Login</Button>
                    <Button variant="outline" onClick={testWhoAmI}>Who Am I?</Button>
                    <Button variant="secondary" onClick={testCookie}>Test Cookie</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Session Debug</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-100 p-4 rounded overflow-auto max-h-80">
                  <pre className="text-xs">{JSON.stringify(sessionStatus, null, 2)}</pre>
                </div>
                <div className="mt-4">
                  <Button variant="outline" onClick={fetchSessionDebug}>Refresh Session Info</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="weekly-plan">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Weekly Plan Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Test fetching the Week 1 Listening plan via different methods.
                  </p>
                  
                  <div className="flex flex-col space-y-2">
                    <Button 
                      onClick={fetchWeeklyPlan} 
                      disabled={isLoadingWeeklyPlan}
                    >
                      {isLoadingWeeklyPlan ? 'Loading...' : 'Fetch Weekly Plan (Authenticated)'}
                    </Button>
                    
                    <Button 
                      variant="outline" 
                      onClick={fetchDirectWeeklyPlan}
                      disabled={isLoadingWeeklyPlan}
                    >
                      {isLoadingWeeklyPlan ? 'Loading...' : 'Fetch Weekly Plan (Direct)'}
                    </Button>
                  </div>
                  
                  {weeklyPlanError && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded">
                      {weeklyPlanError}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Weekly Plan Data</CardTitle>
              </CardHeader>
              <CardContent>
                {weeklyPlanData ? (
                  <div className="bg-gray-100 p-4 rounded overflow-auto max-h-80">
                    <pre className="text-xs">{JSON.stringify(weeklyPlanData, null, 2)}</pre>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    No data loaded. Click the fetch button to load weekly plan data.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Debug Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-900 text-gray-100 p-4 rounded font-mono text-sm overflow-auto max-h-96">
                {debugOutput.length > 0 ? (
                  debugOutput.map((message, index) => (
                    <div key={index} className="pb-1">{message}</div>
                  ))
                ) : (
                  <div className="text-gray-400">No logs yet. Perform actions to generate logs.</div>
                )}
              </div>
              <div className="mt-4">
                <Button 
                  variant="outline" 
                  onClick={() => setDebugOutput([])}
                  size="sm"
                >
                  Clear Logs
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}