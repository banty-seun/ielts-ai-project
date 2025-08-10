import React, { useEffect } from 'react';
import { useTaskContent } from '@/hooks/useTaskContent';

export const ErrorTest: React.FC = () => {
  // Use a non-existent ID to trigger an error
  const { data, error, isLoading } = useTaskContent("non-existent-id-12345");
  
  useEffect(() => {
    if (error) {
      console.log("Error test successful! Error details:", error);
    }
  }, [error]);
  
  return (
    <div className="p-4 bg-gray-100 rounded-md">
      <h3 className="text-lg font-medium">Error Test Component</h3>
      {isLoading && <p>Loading...</p>}
      {error && (
        <div className="text-red-500 mt-2">
          <p>Error message: {error.message}</p>
        </div>
      )}
      {data && <p>Data loaded (this shouldn't happen)</p>}
    </div>
  );
};