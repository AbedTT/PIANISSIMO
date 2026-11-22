import type { Score } from '../model/types';

/**
 * Client for the PHP API in /server. In development Vite proxies /server to `php -S`;
 * in a build the API is expected next to the dist folder (../server), which is how
 * XAMPP serves http://localhost/Pianissimo/dist/. `window.PIANISSIMO_API` overrides both.
 */
export const API_BASE: string =
  (window as unknown as { PIANISSIMO_API?: string }).PIANISSIMO_API ??
  (import.meta.env.DEV ? '/server/api/index.php' : new URL('../server/api/index.php', location.href).pathname);

export type Visibility = 'private' | 'unlisted' | 'public';

export interface User {
  id: number;
  email: string;
  name: string;
}

export interface ScoreMeta {
  id: number;
  title: string;
  composer: string;
  visibility: Visibility;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface ScoreFull extends ScoreMeta {
  data: Score;
}

export interface PublicScore {
  slug: string;
  title: string;
  composer: string;
  author: string;
  updated_at: string;
  data?: Score;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let csrf = '';

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  // state-changing requests need the session's CSRF token: fetch it first if we have none yet
  if (method !== 'GET' && !csrf) await call('GET', '/auth/me');
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the Pianissimo server. Is it running?');
  }
  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(res.status, 'The server sent an unexpected answer. Is the PHP API running?');
  }
  if (typeof data.csrf === 'string') csrf = data.csrf;
  if (!res.ok) throw new ApiError(res.status, (data.error as string) ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  me: () => call<{ user: User | null }>('GET', '/auth/me'),
  register: (name: string, email: string, password: string) =>
    call<{ user: User }>('POST', '/auth/register', { name, email, password }),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout', {}),

  listScores: () => call<{ scores: ScoreMeta[] }>('GET', '/scores'),
  createScore: (data: Score) => call<{ score: ScoreMeta }>('POST', '/scores', { data }),
  getScore: (id: number) => call<{ score: ScoreFull }>('GET', `/scores/${id}`),
  updateScore: (id: number, patch: { data?: Score; visibility?: Visibility; title?: string }) =>
    call<{ score: ScoreMeta }>('PUT', `/scores/${id}`, patch),
  deleteScore: (id: number) => call<{ ok: true }>('DELETE', `/scores/${id}`),
  duplicateScore: (id: number) => call<{ score: ScoreMeta }>('POST', `/scores/${id}/duplicate`, {}),

  publicScore: (slug: string) => call<{ score: PublicScore & { data: Score } }>('GET', `/public/${encodeURIComponent(slug)}`),
  publicList: (q = '') => call<{ scores: PublicScore[] }>('GET', `/public${q ? `?q=${encodeURIComponent(q)}` : ''}`),
};

/** Absolute link to a shared score's public page (the viewer next to the current page). */
export const shareUrl = (slug: string) => new URL(`view.html?s=${encodeURIComponent(slug)}`, location.href).href;
