import React from 'react';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, LogIn, CheckCircle2 } from 'lucide-react';

export function AuthStatus() {
  const { currentUser, loading, logOut } = useFirebaseAuthContext();
  
  if (loading) {
    return (
      <Alert className="mt-4 bg-gray-50 border-gray-200">
        <AlertTitle className="flex items-center gap-2">
          <div className="animate-pulse w-4 h-4 bg-gray-300 rounded-full"></div>
          Checking authentication status...
        </AlertTitle>
      </Alert>
    );
  }
  
  if (!currentUser) {
    return (
      <Alert variant="warning" className="mt-4">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Not authenticated</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <p>You need to sign in to access all features.</p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/login" className="flex items-center gap-1">
                <LogIn className="h-3 w-3" />
                Sign In
              </a>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  
  return (
    <Alert variant="success" className="mt-4">
      <CheckCircle2 className="h-4 w-4" />
      <AlertTitle>Authenticated</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>Signed in as {currentUser.email}</p>
        <div className="flex gap-2 mt-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={logOut}
          >
            Sign Out
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}