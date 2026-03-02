/**
 * src/lib/RoleContext.tsx
 *
 * Provides the authenticated user's RBAC role to the entire app.
 * Role is fetched once per session change and cached here.
 *
 * Usage:
 *   const { role, isMaster, roleLoading } = useRoleContext();
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AppRole = 'user' | 'master_admin';

interface RoleContextValue {
  role: AppRole;
  isMaster: boolean;
  roleLoading: boolean;
}

const RoleContext = createContext<RoleContextValue>({
  role: 'user',
  isMaster: false,
  roleLoading: true,
});

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<AppRole>('user');
  const [roleLoading, setRoleLoading] = useState(true);

  const fetchRole = async (session: Session | null) => {
    if (!session?.user) {
      setRole('user');
      setRoleLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (!error && data?.role === 'master_admin') {
      setRole('master_admin');
    } else {
      setRole('user');
    }
    setRoleLoading(false);
  };

  useEffect(() => {
    // Fetch role for existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetchRole(session);
    });

    // Re-fetch on sign-in / sign-out / token refresh
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      fetchRole(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <RoleContext.Provider value={{ role, isMaster: role === 'master_admin', roleLoading }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRoleContext(): RoleContextValue {
  return useContext(RoleContext);
}
