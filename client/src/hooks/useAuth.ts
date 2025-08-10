import { useQuery } from "@tanstack/react-query";
import { AuthUser } from "@/types/auth";

export function useAuth() {
  const { data: user, isLoading, error, refetch } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
    // Important: include credentials for auth cookies
    meta: {
      requestConfig: {
        credentials: 'include'
      }
    },
    refetchOnWindowFocus: false
  });

  const loginRedirect = () => {
    window.location.href = "/api/login";
  };

  const logoutRedirect = () => {
    window.location.href = "/api/logout";
  };
  
  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/debug', { credentials: 'include' });
      const data = await res.json();
      console.log('Auth Debug Info:', data);
      return data;
    } catch (err) {
      console.error('Auth check failed:', err);
      return null;
    }
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
    refetch,
    loginRedirect,
    logoutRedirect,
    checkAuthStatus
  };
}