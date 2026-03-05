/**
 * src/lib/api.ts
 *
 * Thin HTTP client that replaces the Supabase client.
 * - Reads the JWT from AsyncStorage on every request (no global state).
 * - Throws on non-2xx responses (message taken from body.error if present).
 *
 * Usage:
 *   import { api, uploadGlb, deleteUpload, storeUser, loadUser, clearAuth } from '../lib/api';
 *   const { developments } = await api('GET', '/api/developments');
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Config ────────────────────────────────────────────────────────
export const API_BASE = 'https://realestatear.dev.sbgroup.tech';

const TOKEN_KEY = '@rear:token';
const USER_KEY  = '@rear:user';

// ── Token helpers ─────────────────────────────────────────────────
export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearAuth(): Promise<void> {
  await Promise.all([AsyncStorage.removeItem(TOKEN_KEY), AsyncStorage.removeItem(USER_KEY)]);
}

// ── User helpers ─────────────────────────────────────────────────
export interface StoredUser {
  id: string;
  email: string;
  full_name: string | null;
  phone?: string | null;
  country?: string | null;
  role: 'user' | 'master_admin';
}

export async function storeUser(user: StoredUser): Promise<void> {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function loadUser(): Promise<StoredUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as StoredUser; } catch { return null; }
}

// ── Core fetch helper ─────────────────────────────────────────────
export async function api<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let json: unknown;
  try { json = await res.json(); } catch { json = {}; }

  if (!res.ok) {
    const errMsg =
      (json as { error?: string })?.error ??
      `Request failed: ${res.status} ${res.statusText}`;
    throw new Error(errMsg);
  }

  return json as T;
}

// ── File upload (multipart/form-data) ────────────────────────────
/**
 * Upload a file to POST /api/uploads/glb
 * @returns public URL of the uploaded file
 */
export async function uploadGlb(fileUri: string, fileName: string): Promise<string> {
  const token = await getToken();

  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: 'model/gltf-binary',
  } as unknown as Blob);

  const res = await fetch(`${API_BASE}/api/uploads/glb`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  let json: unknown;
  try { json = await res.json(); } catch { json = {}; }

  if (!res.ok) {
    const errMsg = (json as { error?: string })?.error ?? `Upload failed: ${res.status}`;
    throw new Error(errMsg);
  }

  return (json as { url: string }).url;
}

/**
 * Delete a file via DELETE /api/uploads/glb
 */
export async function deleteUpload(url: string): Promise<void> {
  await api('DELETE', '/api/uploads/glb', { url });
}
