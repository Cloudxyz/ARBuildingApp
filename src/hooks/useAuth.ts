import { Session, User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

export function useAuth(): AuthState & {
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, fullName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
} {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Wipe the invalid token from AsyncStorage without triggering a network call.
    // scope:'local' still fires SIGNED_OUT, but our SIGNED_OUT handler below
    // only sets state — it does NOT call signOut again, so there is no loop.
    const wipeStaleToken = () => supabase.auth.signOut({ scope: 'local' });

    supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          wipeStaleToken(); // SIGNED_OUT handler will set loading:false
          return;
        }
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        wipeStaleToken();
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESH_FAILED') {
        // Background refresh failed — wipe stale token; the resulting SIGNED_OUT
        // event will clean up state (no recursive loop).
        wipeStaleToken();
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setLoading(false);
      } else {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string
  ): Promise<string | null> => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    return error?.message ?? null;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { session, user, loading, signIn, signUp, signOut };
}
