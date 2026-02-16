import { useQuery } from '@tanstack/react-query';
import { AuthUser } from '@/types/auth';
import { tokenManager } from '@/lib/queryClient';

/**
 * Stable singleton hook for fetching the authenticated user.
 * Adds defensive query defaults to avoid refetch storms.
 */
export function useAuthUser() {
  const query = useQuery<AuthUser>({
    queryKey: ['authUser'],
    queryFn: async () => {
      const token = tokenManager.getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/auth/user', { credentials: 'include', headers });
      const contentType = res.headers.get('content-type');
      if (!res.ok) {
        const text = await res.text();
      }
      if (!res.ok) {
        throw new Error('auth/user failed');
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: 1,
  });

  return query;
}
