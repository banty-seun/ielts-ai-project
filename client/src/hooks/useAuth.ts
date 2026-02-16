import { useAuthUser } from "./useAuthUser";

export function useAuth() {
  const { data: user, isLoading, error, refetch, status } = useAuthUser();

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
    status,
    isAuthenticated: !!user,
    error,
    refetch,
    loginRedirect,
    logoutRedirect,
    checkAuthStatus
  };
}
