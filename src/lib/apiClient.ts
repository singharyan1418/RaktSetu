import { auth } from './firebase';
import type { SavedScreeningRecord, UserProfile } from '../types';

const SESSION_TOKEN_KEY = 'raktsetu_session_token';
const CACHED_USER_KEY = 'raktsetu_cached_user';
const SCREENINGS_CACHE_PREFIX = 'raktsetu_screenings_';
const UNLOCKED_CACHE_PREFIX = 'raktsetu_unlocked_';

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore storage quota or sandbox restrictions
  }
}

export function getCachedUser(): UserProfile | null {
  try {
    const raw = window.localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    return parsed && typeof parsed.email === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function setCachedUser(user: UserProfile | null): void {
  try {
    if (user) {
      window.localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(CACHED_USER_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getLocalScreenings(uid: string): SavedScreeningRecord[] {
  try {
    const raw = window.localStorage.getItem(`${SCREENINGS_CACHE_PREFIX}${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedScreeningRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalScreenings(uid: string, records: SavedScreeningRecord[]): void {
  try {
    window.localStorage.setItem(
      `${SCREENINGS_CACHE_PREFIX}${uid}`,
      JSON.stringify(records.slice(0, 50))
    );
  } catch {
    // Ignore storage errors
  }
}

export function getLocalUnlockedDonors(uid: string): string[] {
  try {
    const raw = window.localStorage.getItem(`${UNLOCKED_CACHE_PREFIX}${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveLocalUnlockedDonors(uid: string, donorIds: string[]): void {
  try {
    window.localStorage.setItem(
      `${UNLOCKED_CACHE_PREFIX}${uid}`,
      JSON.stringify(Array.from(new Set(donorIds)).slice(0, 200))
    );
  } catch {
    // Ignore storage errors
  }
}

export function clearClientAuth(): void {
  setSessionToken(null);
  setCachedUser(null);
}

/**
 * Authenticated fetch wrapper that sends both cookies and X-Session-Token header
 * so sessions survive cross-site iframe cookie blocking and container restarts.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const buildHeaders = (tokenOverride?: string | null) => {
    const headers = new Headers(init.headers);
    const token = tokenOverride !== undefined ? tokenOverride : getSessionToken();
    if (token && !headers.has('X-Session-Token')) {
      headers.set('X-Session-Token', token);
    }
    return headers;
  };

  let res = await fetch(input, {
    ...init,
    credentials: 'include',
    headers: buildHeaders(),
  });

  // If session expired/missed on backend while Firebase Auth user is still signed in,
  // silently re-sync session token once and retry without prompting the user.
  if (res.status === 401 && auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const cached = getCachedUser();
      const syncRes = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          role: cached?.role,
        }),
      });
      if (syncRes.ok) {
        const data = (await syncRes.json()) as {
          sessionToken?: string;
          user?: UserProfile;
        };
        if (data.sessionToken) {
          setSessionToken(data.sessionToken);
        }
        if (data.user) {
          setCachedUser(data.user);
        }
        res = await fetch(input, {
          ...init,
          credentials: 'include',
          headers: buildHeaders(data.sessionToken || null),
        });
      }
    } catch {
      // Return original 401 if silent refresh fails
    }
  }

  return res;
}
