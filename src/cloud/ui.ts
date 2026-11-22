import type { Editor } from '../editor/editor';
import type { Score } from '../model/types';
import { api, ApiError, shareUrl, type ScoreMeta, type User, type Visibility } from './api';

const CLOUD_ID_KEY = 'pianissimo:cloudId';
const SYNC_DELAY_MS = 8000;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Accounts, the cloud library and sharing, for the editor page.
 * The current score is linked to a cloud copy by id once saved; after that,
 * changes sync automatically a few seconds after you stop editing.
 */
export class Cloud {
  user: User | null = null;
  /** Cloud id of the score in the editor (null = not saved to the library yet). */
  scoreId: number | null = Number(localStorage.getItem(CLOUD_ID_KEY)) || null;
  meta: ScoreMeta | null = null;
  private syncedJson = '';
  private syncTimer = 0;
  private saving = false;
  /** Called when the account or sync state changes (to refresh the top bar). */
  onChange: () => void = () => {};

  constructor(
    private editor: Editor,
    private toast: (msg: string) => void,
    private confirmLoad: (score: Score) => void,
  ) {
    this.buildDialogs();
    editor.subscribe((kind) => {
      if (kind === 'score') this.scheduleSync();
    });
  }

  async init() {
    try {
      this.user = (await api.me()).user;
    } catch {
      this.user = null; // server not running: the editor still works locally
    }
    if (!this.user) this.forget();
    this.onChange();
  }

  /** "Saved" / "Saving…" / "Unsaved changes" / "" (not in the library). */
  get status(): string {
    if (!this.user || !this.scoreId) return '';
    if (this.saving) return 'Saving…';
    return JSON.stringify(this.editor.score) === this.syncedJson ? 'Saved' : 'Unsaved changes';
  }

  /** Forget the link to a cloud copy (new score, opened a file…). */
  forget() {
    this.scoreId = null;
    this.meta = null;
    this.syncedJson = '';
    localStorage.removeItem(CLOUD_ID_KEY);
    this.onChange();
  }

  private link(meta: ScoreMeta, json: string) {
    this.scoreId = meta.id;
    this.meta = meta;
    this.syncedJson = json;
    localStorage.setItem(CLOUD_ID_KEY, String(meta.id));
    this.onChange();
  }

  // ------------------------------------------------------------------ saving
  async save(): Promise<boolean> {
    if (!this.user) {
      this.showAuth('Sign in to save this score to your library and open it on any device.', () => this.save());
      return false;
    }
    const json = JSON.stringify(this.editor.score);
    this.saving = true;
    this.onChange();
    try {
      if (this.scoreId) {
        try {
          this.link((await api.updateScore(this.scoreId, { data: this.editor.score })).score, json);
        } catch (err) {
          // the cloud copy was deleted elsewhere: save as a new one
          if (err instanceof ApiError && err.status === 404) this.link((await api.createScore(this.editor.score)).score, json);
          else throw err;
        }
      } else {
        this.link((await api.createScore(this.editor.score)).score, json);
      }
      return true;
    } catch (err) {
      this.toast(`Could not save: ${(err as Error).message}`);
      return false;
    } finally {
      this.saving = false;
      this.onChange();
    }
  }

  private scheduleSync() {
    this.onChange();
    if (!this.user || !this.scoreId) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      if (this.status === 'Unsaved changes') void this.save();
    }, SYNC_DELAY_MS);
  }

  // ------------------------------------------------------------------ dialogs
  private el<T extends HTMLElement = HTMLElement>(id: string) {
    return document.getElementById(id) as T;
  }

  private buildDialogs() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal" id="authModal" hidden>
        <div class="modal-card">
          <header><h2 id="authTitle">Sign in</h2><button class="close" data-close>✕</button></header>
          <p class="hint" id="authReason"></p>
          <div class="seg"><button type="button" data-auth="login" class="on">Sign in</button><button type="button" data-auth="register">Create account</button></div>
          <form id="authForm" class="auth-form">
            <label id="authNameRow" hidden>Your name <input name="name" autocomplete="name" maxlength="60" /></label>
            <label>Email <input name="email" type="email" autocomplete="email" required /></label>
            <label>Password <input name="password" type="password" autocomplete="current-password" minlength="8" required /></label>
            <p class="form-error" id="authError" hidden></p>
            <button type="submit" class="primary" id="authSubmit">Sign in</button>
          </form>
        </div>
      </div>
      <div class="modal" id="libraryModal" hidden>
        <div class="modal-card wide">
          <header><h2>My scores</h2><button class="close" data-close>✕</button></header>
          <div class="lib-tools"><button class="primary small" id="libSaveCurrent">Save current score here</button><span class="hint" id="libCount"></span></div>
          <div id="libList" class="lib-list"></div>
        </div>
      </div>
      <div class="modal" id="shareModal" hidden>
        <div class="modal-card">
          <header><h2>Share “<span id="shareTitle"></span>”</h2><button class="close" data-close>✕</button></header>
          <div class="share-options">
            <label><input type="radio" name="vis" value="private" /> <b>Private</b><span>Only you can see it.</span></label>
            <label><input type="radio" name="vis" value="unlisted" /> <b>Anyone with the link</b><span>Not listed anywhere; people need the link.</span></label>
            <label><input type="radio" name="vis" value="public" /> <b>Public</b><span>Listed on Explore with your name.</span></label>
          </div>
          <div class="share-link" id="shareLinkRow" hidden>
            <input id="shareLink" readonly />
            <button class="primary small" id="shareCopy">Copy link</button>
            <a id="shareOpen" target="_blank" rel="noopener">Open ↗</a>
          </div>
        </div>
      </div>`;
    document.body.append(...Array.from(wrap.children));

    for (const modal of ['authModal', 'libraryModal', 'shareModal']) {
      const m = this.el(modal);
      m.querySelector('[data-close]')!.addEventListener('click', () => (m.hidden = true));
      m.addEventListener('mousedown', (e) => {
        if (e.target === m) m.hidden = true;
      });
      m.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') m.hidden = true;
        e.stopPropagation(); // typing in dialogs must not trigger editor shortcuts
      });
    }

    // auth
    let mode: 'login' | 'register' = 'login';
    const setMode = (m: typeof mode) => {
      mode = m;
      this.el('authModal').querySelectorAll<HTMLButtonElement>('[data-auth]').forEach((b) => b.classList.toggle('on', b.dataset.auth === m));
      this.el('authNameRow').hidden = m === 'login';
      this.el('authTitle').textContent = m === 'login' ? 'Sign in' : 'Create your free account';
      this.el('authSubmit').textContent = m === 'login' ? 'Sign in' : 'Create account';
      this.el<HTMLInputElement>('authForm').querySelector<HTMLInputElement>('[name=password]')!.autocomplete =
        m === 'login' ? 'current-password' : 'new-password';
      this.el('authError').hidden = true;
    };
    this.el('authModal').querySelectorAll<HTMLButtonElement>('[data-auth]').forEach((b) =>
      b.addEventListener('click', () => setMode(b.dataset.auth as typeof mode)),
    );
    this.el<HTMLFormElement>('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      const email = String(f.get('email'));
      const password = String(f.get('password'));
      const err = this.el('authError');
      err.hidden = true;
      try {
        this.user =
          mode === 'login'
            ? (await api.login(email, password)).user
            : (await api.register(String(f.get('name') || email.split('@')[0]), email, password)).user;
        this.el('authModal').hidden = true;
        (e.target as HTMLFormElement).reset();
        this.toast(`Signed in as ${this.user.name}`);
        this.onChange();
        if (this.afterAuth) {
          const next = this.afterAuth;
          this.afterAuth = null;
          await next();
        }
      } catch (ex) {
        err.textContent = (ex as Error).message;
        err.hidden = false;
      }
    });

    // library
    this.el('libSaveCurrent').addEventListener('click', async () => {
      if (await this.save()) void this.renderLibrary();
    });

    // share
    this.el('shareModal').querySelectorAll<HTMLInputElement>('input[name=vis]').forEach((r) =>
      r.addEventListener('change', async () => {
        if (!this.scoreId) return;
        try {
          this.meta = (await api.updateScore(this.scoreId, { visibility: r.value as Visibility })).score;
          this.renderShare();
          this.toast(
            r.value === 'private' ? 'Only you can see this score now' : r.value === 'public' ? 'Public: listed on Explore' : 'Anyone with the link can view it',
          );
        } catch (ex) {
          this.toast((ex as Error).message);
        }
      }),
    );
    this.el('shareCopy').addEventListener('click', async () => {
      const input = this.el<HTMLInputElement>('shareLink');
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      this.toast('Link copied');
    });
  }

  /** Runs after a successful sign-in (e.g. finish the save that asked for it). */
  private afterAuth: (() => Promise<unknown>) | null = null;

  showAuth(reason = '', then?: () => Promise<unknown>) {
    this.afterAuth = then ?? null;
    this.el('authReason').textContent = reason;
    this.el('authReason').hidden = !reason;
    this.el('authModal').hidden = false;
    this.el<HTMLFormElement>('authForm').querySelector<HTMLInputElement>('[name=email]')!.focus();
  }

  async signOut() {
    try {
      await api.logout();
    } catch {
      /* already signed out */
    }
    this.user = null;
    this.forget();
    this.toast('Signed out. Your score stays in this browser.');
  }

  async openLibrary(): Promise<void> {
    if (!this.user) return this.showAuth('Sign in to see your saved scores.', () => this.openLibrary());
    this.el('libraryModal').hidden = false;
    await this.renderLibrary();
  }

  private async renderLibrary() {
    const host = this.el('libList');
    host.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const { scores } = await api.listScores();
      this.el('libCount').textContent = `${scores.length} ${scores.length === 1 ? 'score' : 'scores'}`;
      if (!scores.length) {
        host.innerHTML = '<p class="hint">Nothing here yet. Press <kbd>Ctrl</kbd>+<kbd>S</kbd> in the editor to save your score.</p>';
        return;
      }
      const badge = (v: Visibility) => `<span class="vis vis-${v}">${v === 'unlisted' ? 'link' : v}</span>`;
      host.innerHTML = scores
        .map(
          (s) => `<div class="lib-row ${s.id === this.scoreId ? 'current' : ''}" data-id="${s.id}">
            <div class="lib-main"><b>${esc(s.title)}</b><span>${esc(s.composer || '')}</span></div>
            ${badge(s.visibility)}
            <span class="lib-date">${new Date(s.updated_at).toLocaleString()}</span>
            <button data-act="open">Open</button><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button>
          </div>`,
        )
        .join('');
      host.querySelectorAll<HTMLElement>('.lib-row').forEach((row) => {
        const id = Number(row.dataset.id);
        const title = scores.find((s) => s.id === id)!.title;
        row.querySelector('[data-act=open]')!.addEventListener('click', () => this.openScore(id));
        row.querySelector('[data-act=dup]')!.addEventListener('click', async () => {
          await api.duplicateScore(id);
          void this.renderLibrary();
        });
        row.querySelector('[data-act=del]')!.addEventListener('click', async () => {
          if (!confirm(`Delete “${title}” from your library? This cannot be undone.`)) return;
          await api.deleteScore(id);
          if (id === this.scoreId) this.forget();
          void this.renderLibrary();
        });
      });
    } catch (ex) {
      host.innerHTML = `<p class="form-error">${esc((ex as Error).message)}</p>`;
    }
  }

  private async openScore(id: number) {
    try {
      const { score } = await api.getScore(id);
      this.confirmLoad(score.data);
      this.link(score, JSON.stringify(this.editor.score));
      this.el('libraryModal').hidden = true;
      this.toast(`Opened “${score.title}”`);
    } catch (ex) {
      this.toast((ex as Error).message);
    }
  }

  async share(): Promise<void> {
    if (!this.user) return this.showAuth('Sign in to share your score with a link.', () => this.share());
    // sharing needs the latest version in the library
    if (!this.scoreId || this.status === 'Unsaved changes') {
      if (!(await this.save())) return;
    }
    this.renderShare();
    this.el('shareModal').hidden = false;
  }

  private renderShare() {
    if (!this.meta) return;
    this.el('shareTitle').textContent = this.meta.title;
    this.el('shareModal').querySelectorAll<HTMLInputElement>('input[name=vis]').forEach((r) => (r.checked = r.value === this.meta!.visibility));
    const shared = this.meta.visibility !== 'private';
    this.el('shareLinkRow').hidden = !shared;
    if (shared) {
      const url = shareUrl(this.meta.slug);
      this.el<HTMLInputElement>('shareLink').value = url;
      this.el<HTMLAnchorElement>('shareOpen').href = url;
    }
  }
}
