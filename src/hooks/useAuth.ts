/**
 * useAuth — JWT-based auth replacing Supabase Auth.
 * Stores token + user in AsyncStorage, emits auth events for RoleContext.
 */
import { useEffect, useState } from 'react';
import { api, setToken, clearAuth, storeUser, loadUser, StoredUser } from '../lib/api';
import { emitAuthChange, onAuthChange } from '../lib/authEvents';

interface AuthState {
  user: StoredUser | null;
  loading: boolean;
}

export function useAuth(): AuthState & {
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, fullName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
} {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Hydrate from AsyncStorage on mount
    loadUser().then((stored) => {
      setUser(stored);
      setLoading(false);
    });

    // Keep in sync when other parts of the app emit auth changes
    const unsub = onAuthChange((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    try {
      const res = await api<{ token: string; user: StoredUser }>('POST', '/api/auth/login', {
        email,
        password,
      });
      if (!res.token || !res.user) {
        throw new Error('Unexpected response from server. Please try again.');
      }
      await setToken(res.token);
      await storeUser(res.user);
      emitAuthChange(res.user);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Sign in failed';
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
  ): Promise<string | null> => {
    try {
      const res = await api<{ token: string; user: StoredUser }>('POST', '/api/auth/register', {
        email,
        password,
        full_name: fullName,
      });
      if (!res.token || !res.user) {
        throw new Error('Registration is temporarily unavailable. Please try again later.');
      }
      await setToken(res.token);
      await storeUser(res.user);
      emitAuthChange(res.user);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Sign up failed';
    }
  };

  const signOut = async () => {
    await clearAuth();
    emitAuthChange(null);
  };

  return { user, loading, signIn, signUp, signOut };
}

