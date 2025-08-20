/**
 * API Client that automatically includes Firebase authentication tokens in requests
 */

import { tokenManager } from '@/lib/queryClient';
// The useFirebaseAuthContext hook is only imported in the useAuthenticatedApi hook
// to avoid React hooks call rules violations

// Base API request function that includes Firebase token in Authorization header
export async function apiRequestWithToken(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  // Get the Firebase token from token manager
  const token = tokenManager.getToken();
  
  // Add the token to the request headers if available
  const headers = new Headers(options.headers);
  if (token) {
    const authHeader = `Bearer ${token}`;
    headers.set('Authorization', authHeader);
    console.log(`[API Client] Request to ${path} with token`);
    console.log('[apiClient] getToken() return value:', token.substring(0, 10) + '...');
    console.log('[apiClient] Authorization header:', authHeader.slice(0, 15) + '...');
  } else {
    console.log(`[API Client] Request to ${path} without token - no token available`);
  }
  
  // Make the request with the updated headers
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include' // Include cookies for any remaining session-based auth
  });
  
  // Log response for debugging
  console.log(`[API Client] Response from ${path}`, { 
    status: response.status, 
    ok: response.ok,
    hasToken: !!token
  });
  
  return response;
}

// Track last token refresh to prevent too many refreshes
const tokenRefreshTracker = {
  lastRefreshTime: 0,
  refreshCooldownMs: 30000, // 30 seconds between forced refreshes
  refreshAttempts: 0,
  maxConsecutiveAttempts: 3 // After 3 failed attempts, use cached token for longer
};

// Function to get a fresh token and make a request
export async function apiRequestWithFreshToken(
  path: string,
  options: RequestInit = {},
  getToken: () => Promise<string | null>
): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRefresh = now - tokenRefreshTracker.lastRefreshTime;
  const shouldTryRefresh = timeSinceLastRefresh > tokenRefreshTracker.refreshCooldownMs;
  
  // If we're in a retry-backoff period due to previous errors, use cached token
  const isInBackoff = tokenRefreshTracker.refreshAttempts >= tokenRefreshTracker.maxConsecutiveAttempts;
  const backoffCooldownMs = Math.min(300000, 30000 * Math.pow(2, tokenRefreshTracker.refreshAttempts - 2)); // Exponential backoff up to 5 minutes
  const backoffTimeRemaining = isInBackoff ? 
    backoffCooldownMs - timeSinceLastRefresh : 0;
  
  if (isInBackoff && timeSinceLastRefresh < backoffCooldownMs) {
    console.log(`[API Client] Skipping token refresh for ${path} - in backoff mode for ${Math.round(backoffTimeRemaining/1000)}s more`);
    return apiRequestWithToken(path, options);
  }
  
  if (!shouldTryRefresh) {
    console.log(`[API Client] Using cached token for ${path} - last refresh ${Math.round(timeSinceLastRefresh/1000)}s ago`);
    return apiRequestWithToken(path, options);
  }
  
  try {
    // Get a fresh token directly from Firebase Auth
    console.log(`[API Client] Requesting fresh token for ${path}`);
    const token = await getToken();
    
    // Token refresh successful, reset retry counter
    tokenRefreshTracker.lastRefreshTime = now;
    tokenRefreshTracker.refreshAttempts = 0;
    
    if (token) {
      console.log(`[API Client] Received fresh token for ${path}`, {
        length: token.length,
        tokenStart: `${token.substring(0, 10)}...`,
        tokenEnd: `...${token.substring(token.length - 10)}`
      });
      
      // Update token in the token manager for future requests
      console.log('[Auth] Token updated in token manager');
      tokenManager.setToken(token);
    } else {
      console.log(`[API Client] No token received for ${path}`);
    }
    
    // Add the token to the request headers if available
    const headers = new Headers(options.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
      console.log(`[API Client] Request to ${path} with fresh token`);
    } else {
      console.log(`[API Client] Request to ${path} without token - no fresh token available`);
    }
    
    // Make the request with the updated headers
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: 'include' // Include cookies for any remaining session-based auth
    });
    
    // Log response for debugging
    console.log(`[API Client] Response from ${path}`, { 
      status: response.status, 
      ok: response.ok,
      hasToken: !!token
    });
    
    return response;
  } catch (error: any) {
    console.error(`[API Client] Error getting fresh token for ${path}:`, error);
    
    // Check if the error is quota-related
    const isQuotaError = error?.code === 'auth/quota-exceeded' || 
                         error?.code === 'auth/the-service-is-currently-unavailable.' ||
                         error?.message?.includes('quota') ||
                         error?.message?.includes('unavailable');
    
    if (isQuotaError) {
      // Increment retry counter for quota errors
      tokenRefreshTracker.refreshAttempts++;
      tokenRefreshTracker.lastRefreshTime = now;
      
      console.warn(`[API Client] Quota exceeded (attempt ${tokenRefreshTracker.refreshAttempts}). Backing off for ${
        tokenRefreshTracker.refreshAttempts >= tokenRefreshTracker.maxConsecutiveAttempts ? 
          Math.round(backoffCooldownMs/1000) : 
          Math.round(tokenRefreshTracker.refreshCooldownMs/1000)
      }s`);
    }
    
    // Fall back to using the cached token
    return apiRequestWithToken(path, options);
  }
}

// Safe JSON parsing that checks content type
async function safeParseJson<T>(response: Response): Promise<T> {
  // Guard against undefined response
  if (!response) {
    throw new Error('Response is undefined');
  }
  
  try {
    // Check if the content type is JSON - guard headers access
    const contentType = response.headers?.get ? response.headers.get('content-type') : null;
    console.log(`[API Client] safeParseJson called for ${response.url}, content-type: ${contentType}`);
    
    if (contentType && contentType.includes('application/json')) {
      const jsonData = await response.json();
      console.log(`[API Client] Parsed JSON data:`, jsonData);
      return jsonData;
    } else {
      // For non-JSON responses, read the text and log it
      const text = await response.text();
      
      // More detailed logging including URL path components to help diagnose route issues
      const url = new URL(response.url);
      console.error(`[API Client] Received non-JSON response from ${response.url}:`, {
        status: response.status,
        contentType: contentType || 'none',
        method: response.type,
        path: url.pathname,
        textPreview: text.substring(0, 150) + (text.length > 150 ? '...' : '')
      });
      
      // Special handling for HTML responses which likely indicate route not found
      if (text.includes('<!DOCTYPE html>') || text.includes('<html>')) {
        throw new Error(`Route not found or returning HTML instead of JSON: ${url.pathname} (${response.status})`);
      }
      
      throw new Error(`Received non-JSON response: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    if (error instanceof SyntaxError && error.message.includes('Unexpected token')) {
      console.error(`[API Client] JSON parsing error - Invalid JSON response:`, error);
      throw new Error(`Invalid JSON in response: ${error.message}`);
    }
    
    console.error(`[API Client] JSON parsing error:`, error);
    throw new Error(`Failed to parse response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// GET request with authentication
export async function getWithAuth<T>(path: string): Promise<T> {
  const response = await apiRequestWithToken(path);
  
  if (!response.ok) {
    // For error responses, try to safely parse JSON error message if available
    try {
      const contentType = response.headers?.get ? response.headers.get('content-type') : null;
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorData.message || JSON.stringify(errorData)}`);
      } else {
        const errorText = await response.text();
        console.error(`[API Client] Non-JSON error response from ${path}:`, {
          status: response.status,
          textPreview: errorText.substring(0, 100) + (errorText.length > 100 ? '...' : '')
        });
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
    } catch (parseError) {
      // If we can't parse the error response, just throw a basic error
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
  }
  
  return safeParseJson<T>(response);
}

// POST request with authentication
export async function postWithAuth<T>(path: string, data: any): Promise<T> {
  const response = await apiRequestWithToken(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    // For error responses, try to safely parse JSON error message if available
    try {
      const contentType = response.headers?.get ? response.headers.get('content-type') : null;
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorData.message || JSON.stringify(errorData)}`);
      } else {
        const errorText = await response.text();
        console.error(`[API Client] Non-JSON error response from ${path}:`, {
          status: response.status,
          textPreview: errorText.substring(0, 100) + (errorText.length > 100 ? '...' : '')
        });
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
    } catch (parseError) {
      // If we can't parse the error response, just throw a basic error
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
  }
  
  return safeParseJson<T>(response);
}

// PUT request with authentication
export async function putWithAuth<T>(path: string, data: any): Promise<T> {
  const response = await apiRequestWithToken(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    // For error responses, try to safely parse JSON error message if available
    try {
      const contentType = response.headers?.get ? response.headers.get('content-type') : null;
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorData.message || JSON.stringify(errorData)}`);
      } else {
        const errorText = await response.text();
        console.error(`[API Client] Non-JSON error response from ${path}:`, {
          status: response.status,
          textPreview: errorText.substring(0, 100) + (errorText.length > 100 ? '...' : '')
        });
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
    } catch (parseError) {
      // If we can't parse the error response, just throw a basic error
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
  }
  
  return safeParseJson<T>(response);
}

// DELETE request with authentication
export async function deleteWithAuth<T>(path: string): Promise<T> {
  const response = await apiRequestWithToken(path, {
    method: 'DELETE'
  });
  
  if (!response.ok) {
    // For error responses, try to safely parse JSON error message if available
    try {
      const contentType = response.headers?.get ? response.headers.get('content-type') : null;
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorData.message || JSON.stringify(errorData)}`);
      } else {
        const errorText = await response.text();
        console.error(`[API Client] Non-JSON error response from ${path}:`, {
          status: response.status,
          textPreview: errorText.substring(0, 100) + (errorText.length > 100 ? '...' : '')
        });
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
    } catch (parseError) {
      // If we can't parse the error response, just throw a basic error
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
  }
  
  return safeParseJson<T>(response);
}

// Safe POST helper that always builds absolute URL and valid headers
export async function postJsonWithAuth(
  path: string,
  getToken: () => Promise<string | null>,
  body: unknown,
): Promise<Response> {
  // Make absolute URL (avoids "expected pattern" from fetch/Request/URL)
  const url = new URL(path, window.location.origin);

  if (typeof getToken !== 'function') {
    throw new Error('getToken is not a function');
  }

  const token = await getToken();
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  // DEBUG: minimal diagnostics
  console.log('[POST][attempt] url', url.toString(), 'hasToken', !!token);

  return fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  });
}

// These functions are used directly with getToken from FirebaseAuthContext
// Example usage:
// const { getToken } = useFirebaseAuthContext();
// IMPORTANT: This function now returns Response, not parsed JSON
export async function getFreshWithAuth(path: string, getToken: () => Promise<string | null>): Promise<Response> {
  // Validate getToken parameter
  if (typeof getToken !== 'function') {
    throw new Error('getToken is not a function');
  }
  
  // IMPORTANT: declare before use (prevents implicit global / TDZ bugs)
  let res: Response;
  
  try {
    res = await apiRequestWithFreshToken(path, {}, getToken);
  } catch (e: any) {
    throw new Error(`apiRequestWithFreshToken failed: ${e?.message ?? 'unknown'}`);
  }
  
  // Null-safe headers access; never assume headers exists
  const contentType = res?.headers?.get ? res.headers.get('content-type') : null;
  console.log('[API][getFreshWithAuth][return]', {
    url: path,
    ok: res?.ok,
    status: res?.status,
    contentType,
  });
  
  // Always return a real Response object; never undefined/null
  return res;
}

export async function postFreshWithAuth<T>(
  path: string, 
  data: any, 
  getToken: (forceRefresh?: boolean) => Promise<string | null>
): Promise<T> {
  try {
    // Get token and log it before the API call
    const token = await getToken();
    if (token) {
      console.log('[apiClient] postFreshWithAuth using token:', token.substring(0, 10) + '...');
    } else {
      console.log('[apiClient] postFreshWithAuth has no token');
    }
    
    // Prepare auth header and log it
    const authHeader = token ? `Bearer ${token}` : '';
    console.log('[apiClient] Authorization header:', authHeader.slice(0, 15) + '...');
    
    // Make the request
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(data),
      credentials: 'include'
    });
    
    // If got a 401, try once with a fresh token
    if (response.status === 401) {
      console.warn('[apiClient] 401 — refreshing token and retrying');
      
      // Force refresh the token
      const newToken = await getToken(true);
      console.log('[apiClient] Got fresh token:', newToken ? newToken.substring(0, 10) + '...' : 'null');
      
      // Prepare auth header with new token
      const newAuthHeader = newToken ? `Bearer ${newToken}` : '';
      console.log('[apiClient] New Authorization header:', newAuthHeader.slice(0, 15) + '...');
      
      // Retry the request with the new token
      const retryResponse = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': newAuthHeader
        },
        body: JSON.stringify(data),
        credentials: 'include'
      });
      
      // Return the retry response (success or failure)
      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        console.error(`[apiClient] Retry also failed: ${retryResponse.status} ${errorText}`);
        throw new Error(`API error: ${retryResponse.status} ${retryResponse.statusText} - ${errorText}`);
      }
      
      return safeParseJson<T>(retryResponse);
    }
    
    // If not a 401 error but still not OK, throw error
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[apiClient] Request failed: ${response.status} ${errorText}`);
      throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    return safeParseJson<T>(response);
  } catch (err) {
    console.error('[apiClient] Error in postFreshWithAuth:', err);
    throw err;
  }
}

export async function patchFreshWithAuth<T>(
  path: string, 
  data: any, 
  getToken: () => Promise<string | null>
): Promise<T> {
  const response = await apiRequestWithFreshToken(
    path, 
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    }, 
    getToken
  );
  
  if (!response.ok) {
    // For error responses, try to safely parse JSON error message if available
    try {
      const contentType = response.headers?.get ? response.headers.get('content-type') : null;
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorData.message || JSON.stringify(errorData)}`);
      } else {
        const errorText = await response.text();
        console.error(`[API Client] Non-JSON error response from ${path}:`, {
          status: response.status,
          contentType: contentType || 'none',
          textPreview: errorText.substring(0, 100) + (errorText.length > 100 ? '...' : '')
        });
        throw new Error(`API error: ${response.status} ${response.statusText} - Non-JSON response received`);
      }
    } catch (parseError) {
      // If we can't parse the error response, just throw a basic error
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
  }
  
  return safeParseJson<T>(response);
}