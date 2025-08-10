import React, { useEffect, useState } from 'react';
import { useTaskContent } from '@/hooks/useTaskContent';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';

export default function ErrorTest() {
  const [, setLocation] = useLocation();
  const [testId, setTestId] = useState("non-existent-id-12345");
  const [showNetworkError, setShowNetworkError] = useState(false);
  
  // Use a non-existent ID to trigger an error
  const { data, error, isLoading } = useTaskContent(testId);
  
  useEffect(() => {
    if (error) {
      console.log("Error test successful! Error details:", error);
    }
  }, [error]);
  
  // Function to simulate a network error by setting an invalid URL
  const triggerNetworkError = () => {
    setShowNetworkError(true);
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold mb-6">Error Handling Test</h1>
        
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Testing useTaskContent with invalid ID</h2>
          <div className="p-4 rounded border">
            {isLoading && <p className="text-gray-500">Loading...</p>}
            
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-red-800">
                <p className="font-semibold">Error message:</p>
                <p className="mt-1 break-all">{error.message}</p>
              </div>
            )}
            
            {data && <p className="text-green-600">Data loaded (this shouldn't happen)</p>}
            
            {showNetworkError && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="font-semibold">Network Error Test:</p>
                <p>Open your browser console to see the network error details.</p>
                <p className="text-xs mt-2">Since we can't directly trigger a network error in the browser,
                check the console for the improved error format.</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex justify-between flex-wrap gap-2">
          <Button 
            variant="outline" 
            onClick={() => setLocation('/dashboard')}
          >
            Back to Dashboard
          </Button>
          
          <Button 
            variant="outline"
            onClick={triggerNetworkError}
          >
            Show Network Error Info
          </Button>
          
          <Button 
            onClick={() => window.location.reload()}
          >
            Run Test Again
          </Button>
        </div>
      </div>
    </div>
  );
}