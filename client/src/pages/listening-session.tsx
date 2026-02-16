import React, { useEffect, useMemo, useState } from 'react';
import { useRoute, Link as WouterLink, useLocation } from 'wouter';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ListeningPracticeSession } from '@/components/practice/ListeningPracticeSession';
import { SessionState } from '../../../shared/schema';
import { Loader2 } from 'lucide-react';
import { useFirebaseAuthContext } from '@/contexts/FirebaseAuthContext';
import { DEFAULT_SESSION_MINUTES } from '@shared/constants';

/**
 * Session-based listening practice page
 *
 * Route: /listening-session?progressId=xxx
 *
 * This page uses the new session management system with:
 * - Drift-resistant timing
 * - Pause/resume functionality
 * - Auto-advance logic
 * - AI advisor feedback
 * - Session completion tracking
 */
export default function ListeningSession() {
  const [, params] = useRoute('/listening-session');
  const [location, setLocation] = useLocation();
  const { getToken } = useFirebaseAuthContext();

  // Parse query params
  const progressId = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return new URLSearchParams(window.location.search).get('progressId');
  }, []);

  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchWithAuth<T = any>(url: string, token: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed (${response.status})`);
    }

    return response.json();
  }

  const resolveSessionMinutes = async (token: string, taskId: string): Promise<number> => {
    const data = await fetchWithAuth<{ success: boolean; taskProgress?: any }>(
      `/api/firebase/task-progress/${encodeURIComponent(taskId)}`,
      token,
    );

    const task = data?.taskProgress;
    const progressData = (task?.progressData ?? {}) as Record<string, any>;

    if (typeof task?.duration === 'number' && task.duration > 0) {
      return task.duration;
    }

    const legacyMinutes = Number(progressData.sessionDurationMinutes);
    if (!Number.isNaN(legacyMinutes) && legacyMinutes > 0) {
      return legacyMinutes;
    }

    return DEFAULT_SESSION_MINUTES;
  };

  // Fetch or initialize session state
  useEffect(() => {
    if (!progressId) {
      setError('Missing progressId in URL');
      setIsLoading(false);
      return;
    }

    const progressKey = progressId;

    async function initializeSession() {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error('Not authenticated');
        }

        // Best-effort startup boost so Part 1 readiness is prioritized before session entry.
        void fetchWithAuth('/api/listening/readiness/boost', token, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskProgressId: progressKey,
            source: 'session_open',
          }),
        }).catch(() => undefined);

        // First, try to fetch existing session state (server will also recalc remaining time)
        const syncData = await fetchWithAuth<{ success: boolean; sessionState: SessionState | null }>(
          `/api/session/sync/${encodeURIComponent(progressKey)}`,
          token,
        );

        if (syncData.success && syncData.sessionState) {
          setSessionState(syncData.sessionState);
          return;
        }

        // No existing session - pull session duration and start a new one
        const sessionMinutes = await resolveSessionMinutes(token, progressKey);

        const startData = await fetchWithAuth<{ success: boolean; sessionState?: SessionState; message?: string }>(
          '/api/session/start',
          token,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              taskProgressId: progressKey,
              durationMinutes: sessionMinutes,
            }),
          },
        );

        if (startData.success && startData.sessionState) {
          setSessionState(startData.sessionState);
          return;
        }

        throw new Error(startData.message || 'Failed to initialize session');
      } catch (err: any) {
        console.error('[ListeningSession] Init error:', err);
        setError(err.message || 'Failed to load session');
      } finally {
        setIsLoading(false);
      }
    }

    initializeSession();
  }, [progressId, getToken]);

  // Handle session completion
  const handleSessionComplete = () => {
    // Navigate back to dashboard
    setLocation('/dashboard');
  };

  // Handle exit
  const handleExit = () => {
    // Navigate back to dashboard
    setLocation('/dashboard');
  };

  // Loading state
  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-indigo-600" />
            <p className="text-gray-600">Loading session...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // Error state
  if (error || !progressId) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <div className="max-w-md w-full bg-white border border-red-200 rounded-lg p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-red-900 mb-2">
              Error Loading Session
            </h2>
            <p className="text-red-700 mb-4">
              {error || 'Missing session information in URL'}
            </p>
            <WouterLink
              href="/dashboard"
              className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Return to Dashboard
            </WouterLink>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // No session state yet
  if (!sessionState) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-indigo-600" />
            <p className="text-gray-600">Initializing session...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // Render the session component
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50">
        <ListeningPracticeSession
          taskId={progressId}
          initialSessionState={sessionState}
          onSessionComplete={handleSessionComplete}
          onExit={handleExit}
        />
      </div>
    </ProtectedRoute>
  );
}
