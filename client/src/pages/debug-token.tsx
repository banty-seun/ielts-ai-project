import { useState, useEffect } from 'react';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function DebugTokenPage() {
  const { currentUser, getToken } = useFirebaseAuthContext();
  const [token, setToken] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<any>(null);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get token on page load
  useEffect(() => {
    if (currentUser) {
      fetchFreshToken();
    }
  }, [currentUser]);

  // Function to get a fresh token
  const fetchFreshToken = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Requesting fresh token...');
      
      if (!currentUser) {
        setError('No user logged in');
        setLoading(false);
        return;
      }
      
      // Get token directly from current user
      const newToken = await currentUser.getIdToken(true);
      setToken(newToken);
      
      // Show token info
      if (newToken) {
        const parts = newToken.split('.');
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(atob(parts[1]));
            setTokenInfo({
              issued: new Date(payload.iat * 1000).toLocaleString(),
              expires: new Date(payload.exp * 1000).toLocaleString(),
              userId: payload.user_id || payload.sub,
              email: payload.email || 'not available'
            });
          } catch (err) {
            console.error('Error parsing token:', err);
            setTokenInfo({ error: 'Could not parse token' });
          }
        }
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error getting token:', err);
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  // Function to call the API with the token
  const testApi = async () => {
    try {
      setLoading(true);
      setError(null);
      setApiResponse(null);
      
      if (!token) {
        setError('No token available');
        setLoading(false);
        return;
      }
      
      // Make request to the debug onboarding status API (which skips middleware chain)
      console.log('Making request to debug API with token...');
      const response = await fetch('/api/debug/firebase/onboarding-status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const responseData = await response.json();
      console.log('Debug API response:', responseData);
      
      setApiResponse({
        status: response.status,
        statusText: response.statusText,
        data: responseData
      });
      
      // Also try the regular API for comparison
      console.log('Making request to regular API with token...');
      const regularResponse = await fetch('/api/firebase/auth/onboarding-status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      let regularData = null;
      try {
        regularData = await regularResponse.json();
        console.log('Regular API response:', regularData);
      } catch (e) {
        console.error('Error parsing regular API response:', e);
      }
      
      // Add regular API response to the results
      setApiResponse(prev => ({
        ...prev,
        regularStatus: regularResponse.status,
        regularStatusText: regularResponse.statusText,
        regularData: regularData
      }));
      
      setLoading(false);
    } catch (err) {
      console.error('API error:', err);
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <div className="container max-w-3xl py-10">
      <h1 className="text-3xl font-bold mb-8">Firebase Token Debugger</h1>
      
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>User Status</CardTitle>
          <CardDescription>Current Firebase authentication status</CardDescription>
        </CardHeader>
        <CardContent>
          {currentUser ? (
            <div>
              <p><strong>User ID:</strong> {currentUser.uid}</p>
              <p><strong>Email:</strong> {currentUser.email || 'No email'}</p>
              <p><strong>Verified:</strong> {currentUser.emailVerified ? 'Yes' : 'No'}</p>
            </div>
          ) : (
            <p>No user logged in</p>
          )}
        </CardContent>
      </Card>
      
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Firebase ID Token</CardTitle>
          <CardDescription>The ID token used for API authentication</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-x-2">
            <Button onClick={fetchFreshToken} disabled={loading || !currentUser}>
              {loading ? 'Loading...' : 'Get Fresh Token'}
            </Button>
            <Button onClick={testApi} disabled={loading || !token} variant="outline">
              Test API Call
            </Button>
          </div>
          
          {error && (
            <div className="bg-red-50 p-4 mb-4 rounded border border-red-200">
              <p className="text-red-600">{error}</p>
            </div>
          )}
          
          {tokenInfo && (
            <div className="bg-gray-50 p-4 mb-4 rounded border">
              <h3 className="text-lg font-medium mb-2">Token Information</h3>
              <p><strong>Issued:</strong> {tokenInfo.issued}</p>
              <p><strong>Expires:</strong> {tokenInfo.expires}</p>
              <p><strong>User ID:</strong> {tokenInfo.userId}</p>
              <p><strong>Email:</strong> {tokenInfo.email}</p>
            </div>
          )}
          
          {token && (
            <div>
              <h3 className="text-lg font-medium mb-2">Token Value</h3>
              <div className="bg-gray-100 p-3 rounded overflow-auto max-h-32 text-xs font-mono">
                {token}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {apiResponse && (
        <>
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Debug API Response</CardTitle>
              <CardDescription>Result from the direct debug API endpoint</CardDescription>
            </CardHeader>
            <CardContent>
              <p><strong>Status:</strong> {apiResponse.status} {apiResponse.statusText}</p>
              <h3 className="text-lg font-medium mt-4 mb-2">Response Data</h3>
              <div className="bg-gray-100 p-3 rounded overflow-auto max-h-64">
                <pre className="text-xs">{JSON.stringify(apiResponse.data, null, 2)}</pre>
              </div>
            </CardContent>
          </Card>
          
          {apiResponse.regularStatus && (
            <Card>
              <CardHeader>
                <CardTitle>Regular API Response</CardTitle>
                <CardDescription>Result from the regular API endpoint with middleware</CardDescription>
              </CardHeader>
              <CardContent>
                <p><strong>Status:</strong> {apiResponse.regularStatus} {apiResponse.regularStatusText}</p>
                <h3 className="text-lg font-medium mt-4 mb-2">Response Data</h3>
                <div className="bg-gray-100 p-3 rounded overflow-auto max-h-64">
                  <pre className="text-xs">{JSON.stringify(apiResponse.regularData, null, 2)}</pre>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}