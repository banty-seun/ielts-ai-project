import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Firebase token storage singleton with enhanced caching
// This allows components that don't have direct access to the FirebaseAuthContext
// to still include the token in their requests, with proper caching behavior
class TokenManager {
  private static instance: TokenManager;
  private token: string | null = null;
  private tokenExpiry: number = 0; // Timestamp when token expires
  private tokenCreatedAt: number = 0; // Timestamp when token was created
  
  // Default token lifetime is 1 hour (3600 seconds)
  private TOKEN_LIFETIME_MS = 60 * 60 * 1000;
  // Consider token stale after 45 minutes (75% of lifetime)
  private TOKEN_STALE_THRESHOLD_MS = 45 * 60 * 1000;

  private constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager();
    }
    return TokenManager.instance;
  }
  
  // Load token from sessionStorage if available
  private loadFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const cachedToken = sessionStorage.getItem('firebase_token');
        const cachedExpiry = sessionStorage.getItem('firebase_token_expiry');
        const cachedCreatedAt = sessionStorage.getItem('firebase_token_created_at');
        
        if (cachedToken && cachedExpiry && cachedCreatedAt) {
          this.token = cachedToken;
          this.tokenExpiry = parseInt(cachedExpiry, 10);
          this.tokenCreatedAt = parseInt(cachedCreatedAt, 10);
          
          // Validate token expiry - clear if already expired
          if (Date.now() >= this.tokenExpiry) {
            this.clearToken();
            console.log('[TokenManager] Cleared expired token from cache');
          } else {
            console.log('[TokenManager] Loaded cached token expiring in', 
              Math.round((this.tokenExpiry - Date.now()) / 1000 / 60), 'minutes');
          }
        }
      }
    } catch (error) {
      console.error('[TokenManager] Error loading from storage:', error);
      this.clearToken();
    }
  }
  
  // Save token to sessionStorage for persistence across refreshes
  private saveToStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (this.token) {
          sessionStorage.setItem('firebase_token', this.token);
          sessionStorage.setItem('firebase_token_expiry', this.tokenExpiry.toString());
          sessionStorage.setItem('firebase_token_created_at', this.tokenCreatedAt.toString());
        } else {
          sessionStorage.removeItem('firebase_token');
          sessionStorage.removeItem('firebase_token_expiry');
          sessionStorage.removeItem('firebase_token_created_at');
        }
      }
    } catch (error) {
      console.error('[TokenManager] Error saving to storage:', error);
    }
  }

  public setToken(token: string | null): void {
    this.token = token;
    
    // Set expiry time when token is updated
    if (token) {
      this.tokenCreatedAt = Date.now();
      this.tokenExpiry = this.tokenCreatedAt + this.TOKEN_LIFETIME_MS;
      console.log(`[TokenManager] Token updated, expires in ${this.TOKEN_LIFETIME_MS / 1000 / 60} minutes`);
    } else {
      this.clearToken();
    }
    
    this.saveToStorage();
  }
  
  public clearToken(): void {
    this.token = null;
    this.tokenExpiry = 0;
    this.tokenCreatedAt = 0;
    this.saveToStorage();
  }

  public getToken(): string | null {
    // If token is expired, return null
    if (this.token && Date.now() >= this.tokenExpiry) {
      console.log('[TokenManager] Token expired, returning null');
      return null;
    }
    console.log('[apiClient] getToken() called, returned:', this.token?.substring(0,10) + '...');
    return this.token;
  }
  
  // Check if token is stale (over 75% of lifetime elapsed)
  public isTokenStale(): boolean {
    if (!this.token) return false;
    const now = Date.now();
    const tokenAge = now - this.tokenCreatedAt;
    return tokenAge >= this.TOKEN_STALE_THRESHOLD_MS;
  }
  
  // Check if token is about to expire (less than 5 minutes remaining)
  public isTokenExpiringSoon(): boolean {
    if (!this.token) return false;
    const now = Date.now();
    const timeToExpiry = this.tokenExpiry - now;
    return timeToExpiry < 5 * 60 * 1000; // Less than 5 minutes
  }
  
  // Debug information about token status
  public getTokenStatus(): {
    hasToken: boolean;
    isStale: boolean;
    isExpiringSoon: boolean;
    ageMinutes?: number;
    expiresInMinutes?: number;
  } {
    if (!this.token) {
      return { hasToken: false, isStale: false, isExpiringSoon: false };
    }
    
    const now = Date.now();
    const ageMinutes = Math.round((now - this.tokenCreatedAt) / 1000 / 60);
    const expiresInMinutes = Math.round((this.tokenExpiry - now) / 1000 / 60);
    
    return {
      hasToken: true,
      isStale: this.isTokenStale(),
      isExpiringSoon: this.isTokenExpiringSoon(),
      ageMinutes,
      expiresInMinutes
    };
  }
}

export const tokenManager = TokenManager.getInstance();

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Helper to add authorization header if token is available
function getAuthHeaders(contentType = false): HeadersInit {
  const headers: HeadersInit = {};
  const token = tokenManager.getToken();
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }
  
  return headers;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = getAuthHeaders(!!data);
  
  // Log for debugging
  console.log(`[API] ${method} request to ${url}`, {
    hasToken: !!tokenManager.getToken(),
    hasCredentials: true
  });
  
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include", // Keep credentials for compatibility with both auth systems
  });

  // Log response for debugging
  console.log(`[API] ${method} response from ${url}`, { 
    status: res.status,
    ok: res.ok
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Function to get fresh token
    const getAndRefreshToken = async (forceRefresh = false) => {
      // Implementation will be provided by Firebase auth context
      if (forceRefresh && typeof window !== 'undefined') {
        console.log('[Query] Forcing token refresh');
        // Clear existing token to force a refresh
        tokenManager.clearToken();
        
        // Attempt to get a fresh token from local storage
        const storedToken = localStorage.getItem('firebase_token');
        if (storedToken) {
          console.log('[Query] Using refreshed token from localStorage');
          tokenManager.setToken(storedToken);
          return storedToken;
        }
      }
      
      return tokenManager.getToken();
    };
    
    // Try initial request with current token
    const token = await getAndRefreshToken();
    const headers: HeadersInit = {};
    
    if (token) {
      const authHeader = `Bearer ${token}`;
      headers['Authorization'] = authHeader;
      console.log(`[Query] Request to ${queryKey[0]} with token`);
      console.log('[apiClient] Authorization header:', authHeader.slice(0, 15) + '...');
    } else {
      console.log(`[Query] Request to ${queryKey[0]} without token`);
    }
    
    try {
      const res = await fetch(queryKey[0] as string, {
        headers,
        credentials: "include", // Keep credentials for compatibility with both auth systems
      });
  
      // Log for debugging
      console.log(`[Query] Response from ${queryKey[0]}`, { 
        status: res.status, 
        hasToken: !!token 
      });
  
      // Handle 401 Unauthorized errors
      if (res.status === 401) {
        console.warn(`[Query] 401 Unauthorized from ${queryKey[0]}`);
        
        if (unauthorizedBehavior === "returnNull") {
          console.log(`[Query] Returning null for 401 response as configured`);
          return null;
        }
        
        // Try to refresh the token and retry once
        console.log('[Query] Attempting to refresh token and retry request');
        const freshToken = await getAndRefreshToken(true);
        
        if (freshToken) {
          console.log(`[Query] Retrying with fresh token: ${freshToken.substring(0, 10)}...`);
          const newAuthHeader = `Bearer ${freshToken}`;
          headers['Authorization'] = newAuthHeader;
          
          // Retry the request with the new token
          const retryRes = await fetch(queryKey[0] as string, {
            headers,
            credentials: "include"
          });
          
          if (!retryRes.ok) {
            console.error(`[Query] Retry with fresh token also failed: ${retryRes.status}`);
            await throwIfResNotOk(retryRes);
          }
          
          console.log(`[Query] Retry successful, status: ${retryRes.status}`);
          return await retryRes.json();
        } else {
          console.error('[Query] Failed to get fresh token for retry');
          if (unauthorizedBehavior === "throw") {
            throw new Error(`Authentication failed: Unable to refresh token for ${queryKey[0]}`);
          }
          return null;
        }
      }
  
      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      console.error(`[Query] Error fetching ${queryKey[0]}:`, error);
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
