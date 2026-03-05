/**
 * src/lib/RoleContext.tsx
 *
 * Provides the authenticated user's RBAC role to the entire app.
 * Role is read from the stored user object (set at login time).
 * Stays in sync via authEvents pub/sub.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadUser } from './api';
import { onAuthChange } from './authEvents';

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

  useEffect(() => {
    // Hydrate role from stored user on mount
    loadUser().then((user) => {
      setRole(user?.role === 'master_admin' ? 'master_admin' : 'user');
      setRoleLoading(false);
    });

    // Keep in sync when sign-in / sign-out happen
    const unsub = onAuthChange((user) => {
      setRole(user?.role === 'master_admin' ? 'master_admin' : 'user');
      setRoleLoading(false);
    });
    return unsub;
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

