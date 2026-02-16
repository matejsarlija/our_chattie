import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseClient } from '../lib/supabaseClient';
import { apiFetch } from '../lib/apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const claimInFlightRef = useRef(false);

  const claimTrialRuns = useCallback(async (accessToken) => {
    if (!accessToken || claimInFlightRef.current) {
      return;
    }

    claimInFlightRef.current = true;
    try {
      await apiFetch('/api/trial/claim', {
        method: 'POST',
        token: accessToken,
      });
    } catch (error) {
      // Trial claim failures should not block normal auth usage.
      console.error('[Auth] Trial claim failed:', error.message || error);
    } finally {
      claimInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
          console.error('[Auth] Failed to get session:', error.message);
        }

        if (!mounted) return;

        const currentSession = data?.session || null;
        setSession(currentSession);
        setUser(currentSession?.user || null);

        if (currentSession?.access_token) {
          await claimTrialRuns(currentSession.access_token);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    bootstrap();

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession || null);
      setUser(nextSession?.user || null);

      if (nextSession?.access_token) {
        await claimTrialRuns(nextSession.access_token);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [claimTrialRuns]);

  const signIn = useCallback(async ({ email, password, mode = 'signin' }) => {
    if (mode === 'signup') {
      const { error } = await supabaseClient.auth.signUp({
        email,
        password,
      });

      if (error) throw error;
      return { ok: true, mode: 'signup' };
    }

    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return { ok: true, mode: 'signin' };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  }, []);

  const openAuthModal = useCallback(() => setIsAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => setIsAuthModalOpen(false), []);

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      signIn,
      signOut,
      openAuthModal,
      closeAuthModal,
      isAuthModalOpen,
      accessToken: session?.access_token || null,
      claimTrialRuns,
    }),
    [session, user, loading, signIn, signOut, openAuthModal, closeAuthModal, isAuthModalOpen, claimTrialRuns]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}
