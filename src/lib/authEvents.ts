/**
 * src/lib/authEvents.ts
 *
 * Minimal pub/sub so useAuth and RoleContext stay in sync
 * without turning useAuth into a context.
 */
import type { StoredUser } from './api';

type Listener = (user: StoredUser | null) => void;
const listeners = new Set<Listener>();

export function onAuthChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitAuthChange(user: StoredUser | null): void {
  listeners.forEach((cb) => cb(user));
}
