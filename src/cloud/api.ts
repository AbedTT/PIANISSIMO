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
  /** may review reported content (admin.html) */
  admin?: boolean;
}

/** Email copies of notifications: none, one per event, or a daily digest. */
export type EmailMode = 'off' | 'each' | 'daily';

export interface AppNotification {
  id: number;
  kind: string;
  text: string;
  /** where it leads, relative to the site (app.html?open=…, app.html?class=…, view.html?s=…) */
  link: string;
  created_at: string;
  read: boolean;
}

export interface Report {
  kind: 'comment' | 'score';
  id: number;
  reports: number;
  last: string;
  hidden: boolean;
  text: string;
  author: string;
  link: string;
}

export interface ScoreMeta {
  id: number;
  title: string;
  composer: string;
  visibility: Visibility;
  slug: string;
  /** Goes up by one on every saved change; used to detect saves made elsewhere. */
  revision: number;
  created_at: string;
  updated_at: string;
  /** "owner", or "editor" when someone shared it with this user for editing. */
  role?: 'owner' | 'editor';
  /** The owner's name, on scores shared with this user. */
  owner?: string;
}

export interface Editor {
  id: number;
  name: string;
  email: string;
  role: 'owner' | 'editor';
}

export interface Submission {
  id: number;
  score_id: number;
  status: 'working' | 'submitted' | 'returned';
  feedback: string;
  /** free text, e.g. "8/10" or "B+" */
  grade: string;
  /** 0–4 per marking criterion of the assignment (null = not marked) */
  marks: (number | null)[];
  submitted_at: string | null;
  returned_at: string | null;
}

/** An entry of the due-date agenda. */
export interface CalendarItem {
  id: number;
  title: string;
  due_at: string;
  class_id: number;
  class: string;
  role: 'teacher' | 'student';
  done?: number;
  total?: number;
  status?: string;
}

export interface Assignment {
  id: number;
  title: string;
  instructions: string;
  /** marking criteria (each marked 0–4 when the work is given back) */
  rubric: string[];
  due_at: string | null;
  created_at: string;
  /** teacher: how many students are at each stage */
  counts?: { working: number; submitted: number; returned: number };
  /** student: their own work, if started */
  submission?: Submission | null;
}

export interface ClassInfo {
  id: number;
  name: string;
  role: 'teacher' | 'student';
  teacher: string;
  created_at: string;
  join_code?: string;
  students?: number;
  assignments?: Assignment[];
  members?: { id: number; name: string; email: string; joined_at: string }[];
}

/** The assignment a library score is someone's work on (for the banner in the editor). */
export interface ScoreAssignment {
  id: number;
  title: string;
  instructions: string;
  due_at: string | null;
  class: string;
  class_id: number;
  rubric: string[];
  student: string;
  /** the signed-in user is the student */
  mine: boolean;
  submission: Submission;
}

export interface ScoreVersion {
  id: number;
  title: string;
  created_at: string;
  data?: Score;
}

export interface ScoreFull extends ScoreMeta {
  data: Score;
}

export interface PublicScore {
  slug: string;
  title: string;
  composer: string;
  author: string;
  author_id: number;
  updated_at: string;
  likes: number;
  data?: Score;
  /** on the score's own page: whether the signed-in viewer likes it */
  liked?: boolean;
  /** on the score's own page: the shared score it was remixed from */
  remix_of?: { slug: string; title: string; author: string } | null;
}

export interface PublicComment {
  id: number;
  text: string;
  created_at: string;
  author: { id: number; name: string };
  can_delete: boolean;
}

export interface Profile {
  user: { id: number; name: string; created_at: string };
  scores: PublicScore[];
  likes: number;
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
        // a FormData body (file uploads) sets its own multipart content type
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
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
  /** Everything stored about the signed-in person. */
  exportAccount: () => call<{ data: unknown }>('GET', '/account/export'),
  deleteAccount: (password: string) => call<{ ok: true }>('POST', '/account/delete', { password }),

  listScores: () => call<{ scores: ScoreMeta[] }>('GET', '/scores'),
  createScore: (data: Score) => call<{ score: ScoreMeta }>('POST', '/scores', { data }),
  getScore: (id: number) => call<{ score: ScoreFull }>('GET', `/scores/${id}`),
  scoreInfo: (id: number) => call<{ score: ScoreMeta }>('GET', `/scores/${id}?meta=1`),
  updateScore: (id: number, patch: { data?: Score; visibility?: Visibility; base_revision?: number; force?: boolean }) =>
    call<{ score: ScoreMeta }>('PUT', `/scores/${id}`, patch),
  deleteScore: (id: number) => call<{ ok: true }>('DELETE', `/scores/${id}`),
  listVersions: (id: number) => call<{ versions: ScoreVersion[] }>('GET', `/scores/${id}/versions`),
  getVersion: (id: number, versionId: number) =>
    call<{ version: ScoreVersion & { data: Score } }>('GET', `/scores/${id}/versions/${versionId}`),
  duplicateScore: (id: number) => call<{ score: ScoreMeta }>('POST', `/scores/${id}/duplicate`, {}),
  listEditors: (id: number) => call<{ editors: Editor[] }>('GET', `/scores/${id}/editors`),
  addEditor: (id: number, email: string) => call<{ editors: Editor[] }>('POST', `/scores/${id}/editors`, { email }),
  removeEditor: (id: number, userId: number) => call<{ ok: true }>('DELETE', `/scores/${id}/editors/${userId}`),
  // teaching
  listClasses: () => call<{ classes: ClassInfo[] }>('GET', '/classes'),
  createClass: (name: string) => call<{ class: ClassInfo }>('POST', '/classes', { name }),
  joinClass: (code: string) => call<{ class: ClassInfo }>('POST', '/classes/join', { code }),
  getClass: (id: number) => call<{ class: ClassInfo }>('GET', `/classes/${id}`),
  deleteClass: (id: number) => call<{ ok: true }>('DELETE', `/classes/${id}`),
  leaveClass: (id: number, userId: number) => call<{ ok: true }>('DELETE', `/classes/${id}/members/${userId}`),
  assign: (classId: number, a: { title: string; instructions: string; due_at: string | null; score_id: number; rubric: string[] }) =>
    call<{ class: ClassInfo }>('POST', `/classes/${classId}/assignments`, a),
  startAssignment: (id: number) => call<{ submission: Submission }>('POST', `/assignments/${id}/start`, {}),
  submitAssignment: (id: number) => call<{ submission: Submission }>('POST', `/assignments/${id}/submit`, {}),
  submissions: (id: number) => call<{ submissions: (Partial<Submission> & { student: { id: number; name: string }; status: string })[] }>('GET', `/assignments/${id}/submissions`),
  giveBack: (submissionId: number, feedback: string, grade = '', marks: (number | null)[] = []) =>
    call<{ submission: Submission }>('POST', `/submissions/${submissionId}/return`, { feedback, grade, marks }),
  calendar: () => call<{ calendar: CalendarItem[] }>('GET', '/calendar'),
  assignmentOf: (scoreId: number) => call<{ assignment: ScoreAssignment | null }>('GET', `/scores/${scoreId}/assignment`),
  /** Whether the server can scan sheet music (it has an OMR engine set up). */
  omrAvailable: () => call<{ available: boolean }>('GET', '/omr'),
  /** Recognise a photo or PDF of sheet music; the result is MusicXML (base64, plain or .mxl). */
  scanMusic: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return call<{ result: { format: 'mxl' | 'musicxml'; data: string } }>('POST', '/omr', form);
  },
  /** A ticket for the live co-editing service; `url` is null when the server has none. */
  realtimeTicket: (id: number) => call<{ url: string | null; token?: string }>('POST', `/scores/${id}/realtime`, {}),

  publicScore: (slug: string) => call<{ score: PublicScore & { data: Score } }>('GET', `/public/${encodeURIComponent(slug)}`),
  publicList: (q = '', sort: 'new' | 'likes' = 'new') =>
    call<{ scores: PublicScore[] }>('GET', `/public?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort === 'likes' ? { sort } : {}) })}`),
  like: (slug: string) => call<{ liked: boolean; likes: number }>('POST', `/public/${encodeURIComponent(slug)}/like`, {}),
  remix: (slug: string) => call<{ score: ScoreMeta }>('POST', `/public/${encodeURIComponent(slug)}/remix`, {}),
  reportScore: (slug: string) => call<{ reported: true; hidden: boolean }>('POST', `/public/${encodeURIComponent(slug)}/report`, {}),
  comments: (slug: string) => call<{ comments: PublicComment[] }>('GET', `/public/${encodeURIComponent(slug)}/comments`),
  addComment: (slug: string, text: string) => call<{ comments: PublicComment[] }>('POST', `/public/${encodeURIComponent(slug)}/comments`, { text }),
  deleteComment: (id: number) => call<{ ok: true }>('DELETE', `/public/comments/${id}`),
  reportComment: (id: number) => call<{ reported: true; hidden: boolean }>('POST', `/public/comments/${id}/report`, {}),
  profile: (id: number) => call<{ profile: Profile }>('GET', `/people/${id}`),
  notifications: () =>
    call<{ notifications: AppNotification[]; unread: number; email: { available: boolean; mode: EmailMode } }>('GET', '/notifications'),
  /** Mark these (or all) notifications read. */
  markRead: (ids?: number[]) => call<{ ok: true }>('POST', '/notifications/read', ids ? { ids } : {}),
  setNotifyEmail: (mode: EmailMode) => call<{ ok: true }>('POST', '/notifications/email', { mode }),
  /** The language emails are written in. */
  setLanguage: (lang: string) => call<{ ok: true }>('POST', '/account/language', { lang }),
  adminReports: () => call<{ reports: Report[] }>('GET', '/admin/reports'),
  moderate: (kind: Report['kind'], id: number, action: 'restore' | 'dismiss' | 'remove') =>
    call<{ ok: true }>('POST', `/admin/reports/${kind}/${id}`, { action }),
};

/** Absolute link to a shared score's public page (the viewer next to the current page). */
export const shareUrl = (slug: string) => new URL(`view.html?s=${encodeURIComponent(slug)}`, location.href).href;

/** `<iframe>` code for the compact player (embed.html) of a shared score. */
export function embedCode(slug: string, title: string): string {
  const src = new URL(`embed.html?s=${encodeURIComponent(slug)}`, location.href).href;
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<iframe src="${attr(src)}" title="${attr(title)} (sheet music)" width="100%" height="420" style="border:1px solid #e3e6ee;border-radius:8px" loading="lazy" allow="autoplay"></iframe>`;
}
