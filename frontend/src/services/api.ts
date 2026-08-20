import { AuthUser } from '../types';

const BASE = '/api/admin';
const AUTH_BASE = '/api/auth';

function getToken(): string {
  return localStorage.getItem('soledd_admin_token') || '';
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem('soledd_admin_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function storeSession(token: string, user: AuthUser) {
  localStorage.setItem('soledd_admin_token', token);
  localStorage.setItem('soledd_admin_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('soledd_admin_token');
  localStorage.removeItem('soledd_admin_user');
}

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    clearSession();
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }

  return res;
}

export async function requestJson(path: string, options: RequestInit = {}) {
  const res = await request(path, options);
  return res.json();
}

export async function requestBlob(path: string, options: RequestInit = {}) {
  const res = await request(path, options);
  return res.blob();
}

/**
 * Unified login: pass `email` for a credit officer account, or leave it
 * blank to sign in with the shared admin password.
 */
export async function login(password: string, email?: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(email ? { email, password } : { password }),
    });
    if (!res.ok) return null;
    const { token, user } = await res.json();
    storeSession(token, user);
    return user;
  } catch {
    return null;
  }
}

export async function resetOwnPassword(newPassword: string, currentPassword?: string): Promise<void> {
  const res = await fetch(`${AUTH_BASE}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ newPassword, currentPassword }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not update password');
  }
  const user = getStoredUser();
  if (user) storeSession(getToken(), { ...user, mustResetPassword: false });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
