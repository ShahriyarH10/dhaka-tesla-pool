'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshUser = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return null;
    }
    try {
      const { user: u } = await api('/auth/me');
      setUser(u);
      return u;
    } catch (err) {
      if (err.status === 401) {
        tokenStore.clear();
        setUser(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setReady(true));
  }, [refreshUser]);

  const signIn = useCallback(async (path, body) => {
    const data = await api(path, { method: 'POST', body });
    tokenStore.set(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signOut, refreshUser }), [user, ready, signIn, signOut, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
