import type { Editor } from '../editor/editor';
import type { Score } from '../model/types';
import { LocalLibrary, type LocalMeta } from '../library/local';
import { isValidScore } from '../model/validate';
import { t } from '../ui/i18n';
import { api, ApiError, embedCode, shareUrl, type ScoreMeta, type User, type Visibility } from './api';

const CLOUD_ID_KEY = 'pianissimo:cloudId';
/** The entry of the library on this computer that the editor's score is saved in. */
const LOCAL_ID_KEY = 'pianissimo:localId';
/** Changes to a score from the library on this computer are saved this long after the last edit. */
const LOCAL_SAVE_MS = 1200;
const SYNC_DELAY_MS = 8000;
/** How often to check whether the score was saved from another tab or device. */
const POLL_MS = 20000;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Accounts, the cloud library and sharing, for the editor page.
 * The current score is linked to a cloud copy by id once saved; after that,
 * changes sync automatically a few seconds after you stop editing.
 */
type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'change';

export class Cloud {
  user: User | null = null;
  /** Cloud id of the score in the editor (null = not saved to the library yet). */
  scoreId: number | null = Number(localStorage.getItem(CLOUD_ID_KEY)) || null;
  meta: ScoreMeta | null = null;
  private syncedJson = '';
  private syncTimer = 0;
  private saving = false;
  /** A save was refused because the cloud copy changed elsewhere; auto-sync pauses until resolved. */
  private conflict = false;
  /** The library on this computer (no account or server needed). */
  readonly local = new LocalLibrary();
  /** The entry of that library the editor's score is saved in (null = not saved there). */
  localId: string | null = localStorage.getItem(LOCAL_ID_KEY) || null;
  private localJson = '';
  private localSaving = false;
  private localTimer = 0;
  /** The online server answered (false in the desktop app without a server, or offline). */
  serverAvailable = false;
  /** Called when the account or sync state changes (to refresh the top bar). */
  onChange: () => void = () => {};
  /** The editor is now linked to this library score (or to none). */
  onLinked: (meta: ScoreMeta | null) => void = () => {};
  /** We saved the score to the library (revision is the new one). */
  onSaved: (revision: number) => void = () => {};
  /**
   * Set while a live co-editing session runs. Only its leader saves to the library; the others
   * are kept in step by the session (and told when the leader saved).
   */
  live: { leader: boolean } | null = null;

  constructor(
    private editor: Editor,
    private toast: (msg: string) => void,
    private confirmLoad: (score: Score) => void,
  ) {
    this.buildDialogs();
    editor.subscribe((kind) => {
      if (kind === 'score') this.scheduleSync();
    });
    window.setInterval(() => void this.poll(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.poll();
    });
    // back online: send what was written meanwhile, then look for saves made elsewhere
    window.addEventListener('online', () => {
      if (!this.user) void this.init();
      else if (this.status === 'Unsaved changes' && !this.conflict) void this.save().then(() => this.poll());
      else void this.poll();
    });
    window.addEventListener('offline', () => this.onChange());
  }

  /** The server can send emails (password reset and confirmation links). */
  mailAvailable = false;

  async init() {
    await this.loadLocal();
    await this.loadAccount();
    await this.followEmailLink();
  }

  /** Reconnect to the entry of the library on this computer that we were editing before the reload. */
  private async loadLocal() {
    if (!this.localId) return;
    try {
      const item = await this.local.get(this.localId);
      if (item) this.localJson = JSON.stringify(item.data);
      else this.forgetLocal();
    } catch {
      /* storage unavailable: keep the id, saving will tell */
    }
    this.onChange();
  }

  private async loadAccount() {
    try {
      const me = await api.me();
      this.serverAvailable = true;
      this.user = me.user;
      this.mailAvailable = !!me.mail;
    } catch (err) {
      // offline or no server: the editor still works locally. Keep the link to the cloud copy,
      // so saving resumes when the 'online' event retries init
      this.user = null;
      this.serverAvailable = false;
      if (!(err instanceof ApiError)) {
        this.onChange();
        return;
      }
    }
    if (!this.user) this.forget();
    else if (this.scoreId) {
      // reconnect to the cloud copy we were editing before the reload
      try {
        const { score } = await api.getScore(this.scoreId);
        this.meta = score;
        this.syncedJson = JSON.stringify(score.data);
        this.onChange();
        this.onLinked(score);
      } catch {
        this.forget();
      }
    }
    this.onChange();
  }

  /** Notice saves made in another tab or on another device. */
  private async poll() {
    if (!this.user || !this.scoreId || !this.meta || this.saving || this.live || document.visibilityState !== 'visible') return;
    let remote: ScoreMeta;
    try {
      remote = (await api.scoreInfo(this.scoreId)).score;
    } catch {
      return; // offline: try again later
    }
    if (remote.revision <= this.meta.revision || this.conflict) return;
    if (this.status === 'Saved') {
      // nothing local to lose: follow the newer version
      const { score } = await api.getScore(this.scoreId);
      this.confirmLoad(score.data);
      this.link(score, JSON.stringify(this.editor.score));
      this.toast('Updated with changes saved in another tab or device (Ctrl+Z goes back)');
    } else {
      this.conflict = true;
      this.showConflict();
    }
  }

  /** "Saved" / "Saving…" / "Unsaved changes" / "" (not in the library). */
  get status(): string {
    if (this.localId) {
      if (this.localSaving) return 'Saving…';
      return JSON.stringify(this.editor.score) === this.localJson ? 'Saved on this computer' : 'Unsaved changes';
    }
    if (!this.user || !this.scoreId) return '';
    if (this.saving) return 'Saving…';
    if (JSON.stringify(this.editor.score) === this.syncedJson) return 'Saved';
    // in a live session someone else saves; changes are already shared with everyone
    if (this.live && !this.live.leader) return 'Live';
    return navigator.onLine ? 'Unsaved changes' : 'Offline: kept in this browser';
  }

  /** Forget the link to a cloud copy (new score, opened a file…). */
  forget() {
    const had = this.scoreId !== null;
    this.scoreId = null;
    this.meta = null;
    this.syncedJson = '';
    localStorage.removeItem(CLOUD_ID_KEY);
    this.onChange();
    if (had) this.onLinked(null);
  }

  /** Forget the link to the library on this computer. */
  forgetLocal() {
    clearTimeout(this.localTimer);
    this.localId = null;
    this.localJson = '';
    localStorage.removeItem(LOCAL_ID_KEY);
    this.onChange();
  }

  /** A different score is now in the editor (new, template, opened file…): it is in no library yet. */
  detach() {
    this.forget();
    this.forgetLocal();
  }

  private linkLocal(id: string, json: string) {
    this.localId = id;
    this.localJson = json;
    localStorage.setItem(LOCAL_ID_KEY, id);
    this.onChange();
  }

  private link(meta: ScoreMeta, json: string) {
    // a score lives in one library: now the online one
    if (this.localId) this.forgetLocal();
    const changed = this.scoreId !== meta.id;
    this.scoreId = meta.id;
    this.meta = meta;
    this.syncedJson = json;
    localStorage.setItem(CLOUD_ID_KEY, String(meta.id));
    this.onChange();
    if (changed) this.onLinked(meta);
  }

  /** The live session's leader saved: our copy (the same score) is now that revision. */
  markSaved(revision: number) {
    if (!this.meta) return;
    this.meta = { ...this.meta, revision };
    this.syncedJson = JSON.stringify(this.editor.score);
    this.onChange();
  }

  /** The library score the editor is linked to, if any. */
  get current(): ScoreMeta | null {
    return this.meta;
  }

  // ------------------------------------------------------------------ saving
  /**
   * Ctrl+S: save where this score belongs. A score from the library on this computer stays
   * there; otherwise it goes to the online library when signed in, or to this computer's.
   */
  async saveAnywhere(): Promise<boolean> {
    if (this.localId || !this.user) return this.saveLocal();
    return this.save();
  }

  /** Save what is waiting to be saved (before the app closes for an update). */
  async flush(): Promise<void> {
    if (this.status !== 'Unsaved changes') return;
    if (this.localId) await this.saveLocal(true);
    else if (this.user && this.scoreId && !this.conflict) await this.save();
  }

  /** Save to the library on this computer (no account needed). Quiet = an automatic save. */
  async saveLocal(quiet = false): Promise<boolean> {
    clearTimeout(this.localTimer);
    const json = JSON.stringify(this.editor.score);
    const first = !this.localId;
    this.localSaving = true;
    this.onChange();
    try {
      const meta = await this.local.save(this.editor.score, this.localId);
      if (this.scoreId) this.forget(); // it was an online score: this computer's copy is the one now
      this.linkLocal(meta.id, json);
      if (first) void LocalLibrary.keep();
      if (!quiet) this.toast(first ? 'Saved to My scores on this computer' : 'Saved');
      return true;
    } catch (err) {
      this.toast(`Could not save: ${(err as Error).message}`);
      return false;
    } finally {
      this.localSaving = false;
      this.onChange();
    }
  }

  async save(force = false): Promise<boolean> {
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
          const base = this.meta?.id === this.scoreId ? this.meta.revision : undefined;
          this.link((await api.updateScore(this.scoreId, { data: this.editor.score, base_revision: base, force })).score, json);
          this.conflict = false;
          this.onSaved(this.meta!.revision);
        } catch (err) {
          // the cloud copy was deleted elsewhere: save as a new one
          if (err instanceof ApiError && err.status === 404) this.link((await api.createScore(this.editor.score)).score, json);
          else if (err instanceof ApiError && err.status === 409) {
            this.conflict = true;
            this.showConflict();
            return false;
          } else throw err;
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
    if (this.localId) {
      // a score from the library on this computer keeps itself saved
      clearTimeout(this.localTimer);
      this.localTimer = window.setTimeout(() => {
        if (this.status === 'Unsaved changes') void this.saveLocal(true);
      }, LOCAL_SAVE_MS);
      return;
    }
    if (!this.user || !this.scoreId) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      // offline: nothing is sent; the 'online' handler saves later. Live: only the leader saves
      if (this.status === 'Unsaved changes' && !this.conflict && (!this.live || this.live.leader)) void this.save();
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
          <div class="seg" id="authTabs"><button type="button" data-auth="login" class="on">Sign in</button><button type="button" data-auth="register">Create account</button></div>
          <form id="authForm" class="auth-form">
            <p class="hint" id="authHelp" hidden></p>
            <label id="authNameRow" hidden>Your name <input name="name" autocomplete="name" maxlength="60" /></label>
            <label id="authEmailRow">Email <input name="email" type="email" autocomplete="email" required /></label>
            <label id="authCurrentRow" hidden>Current password <input name="current" type="password" autocomplete="current-password" /></label>
            <label id="authPasswordRow"><span id="authPasswordLabel">Password</span> <input name="password" type="password" autocomplete="current-password" minlength="8" required /></label>
            <p class="form-error" id="authError" hidden></p>
            <p class="form-ok" id="authDone" role="status" hidden></p>
            <button type="submit" class="primary" id="authSubmit">Sign in</button>
            <button type="button" class="link-btn" id="authForgot">Forgot your password?</button>
            <button type="button" class="link-btn" id="authBack" hidden>← Back to sign in</button>
          </form>
        </div>
      </div>
      <div class="modal" id="libraryModal" hidden>
        <div class="modal-card wide">
          <header><h2>My scores</h2><button class="close" data-close>✕</button></header>
          <div class="lib-tools">
            <button class="primary small" id="libSaveCurrent">Save current score here</button>
            <span class="hint" id="libCount"></span>
            <span class="lib-spacer"></span>
            <button class="small" id="libBackup" title="All the scores on this computer, as one file">Back up all…</button>
            <button class="small" id="libRestore" title="Add the scores from a backup file">Restore…</button>
          </div>
          <div class="lib-scroll">
            <h3 class="lib-h">On this computer</h3>
            <div id="libLocal" class="lib-list"></div>
            <div id="libOnline" hidden>
              <h3 class="lib-h">Online library</h3>
              <div id="libList" class="lib-list"></div>
            </div>
            <p class="hint lib-signin" id="libSignIn" hidden>Sign in to keep scores online too and open them on any device. <button type="button" class="link-btn" id="libSignInBtn">Sign in</button></p>
          </div>
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
          <div class="share-editors" id="shareEditorsRow">
            <h3>Edit together</h3>
            <p class="hint" id="shareEditorsHint">People you invite can open this score from their library and edit it with you, live.</p>
            <ul id="shareEditors" class="editor-list"></ul>
            <form id="shareInvite" class="invite-form">
              <input type="email" name="email" placeholder="Their Pianissimo account email" aria-label="Email of the person to invite" required />
              <button type="submit" class="small">Invite</button>
            </form>
          </div>
          <div class="share-embed" id="shareEmbedRow" hidden>
            <label for="shareEmbed">Embed on a website or blog</label>
            <textarea id="shareEmbed" readonly rows="3" spellcheck="false"></textarea>
            <button class="small" id="shareEmbedCopy">Copy embed code</button>
          </div>
        </div>
      </div>
      <div class="modal" id="conflictModal" hidden>
        <div class="modal-card" role="alertdialog" aria-labelledby="conflictTitle">
          <header><h2 id="conflictTitle">Changed somewhere else</h2><button class="close" data-close>✕</button></header>
          <p class="hint">This score was saved from another tab or device after you opened it. Which version do you want to keep?
          (The one you do not keep stays in <b>Version history</b>.)</p>
          <div class="side-buttons">
            <button class="primary small" id="conflictMine">Keep mine</button>
            <button id="conflictTheirs">Load the other version</button>
          </div>
        </div>
      </div>
      <div class="modal" id="historyModal" hidden>
        <div class="modal-card wide">
          <header><h2>Version history</h2><button class="close" data-close>✕</button></header>
          <p class="hint">Earlier versions are kept automatically when you save (at most one every 5 minutes, the last 50).
          Restoring loads a version into the editor; <kbd>Ctrl</kbd>+<kbd>Z</kbd> takes you back.</p>
          <div id="historyList" class="lib-list"></div>
        </div>
      </div>`;
    document.body.append(...Array.from(wrap.children));

    this.el('conflictMine').addEventListener('click', async () => {
      this.el('conflictModal').hidden = true;
      if (await this.save(true)) this.toast('Saved your version (the other one is in Version history)');
    });
    this.el('conflictTheirs').addEventListener('click', async () => {
      this.el('conflictModal').hidden = true;
      if (!this.scoreId) return;
      try {
        const { score } = await api.getScore(this.scoreId);
        this.confirmLoad(score.data);
        this.link(score, JSON.stringify(this.editor.score));
        this.conflict = false;
        this.toast('Loaded the other version (Ctrl+Z brings back yours)');
      } catch (ex) {
        this.toast((ex as Error).message);
      }
    });

    for (const modal of ['authModal', 'libraryModal', 'shareModal', 'conflictModal', 'historyModal']) {
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

    // auth: one dialog for signing in, creating an account and the password pages
    this.el('authModal').querySelectorAll<HTMLButtonElement>('[data-auth]').forEach((b) =>
      b.addEventListener('click', () => this.authMode(b.dataset.auth as AuthMode)),
    );
    this.el('authForgot').addEventListener('click', () => this.authMode('forgot'));
    this.el('authBack').addEventListener('click', () => this.authMode('login'));
    this.el<HTMLFormElement>('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const f = new FormData(form);
      const email = String(f.get('email') ?? '');
      const password = String(f.get('password') ?? '');
      const err = this.el('authError');
      err.hidden = true;
      const mode = this.mode;
      const submit = this.el<HTMLButtonElement>('authSubmit');
      submit.disabled = true;
      try {
        if (mode === 'forgot') {
          await api.forgotPassword(email);
          const done = this.el('authDone');
          done.textContent = t('If an account uses that email, a link to choose a new password is on its way. It works for one hour.');
          done.hidden = false;
          return;
        }
        if (mode === 'reset') {
          this.user = (await api.resetPassword(this.resetToken, password)).user;
          this.resetToken = '';
          this.toast('Your new password is saved and you are signed in');
        } else if (mode === 'change') {
          this.user = (await api.changePassword(String(f.get('current') ?? ''), password)).user;
          this.toast('Password changed. Your other devices are signed out.');
        } else if (mode === 'login') {
          this.user = (await api.login(email, password)).user;
          this.toast(`Signed in as ${this.user.name}`);
        } else {
          this.user = (await api.register(String(f.get('name') || email.split('@')[0]), email, password)).user;
          this.toast(this.mailAvailable ? 'Welcome! We sent you a link to confirm your email address.' : `Signed in as ${this.user.name}`);
        }
        this.el('authModal').hidden = true;
        form.reset();
        this.onChange();
        if (this.afterAuth && (mode === 'login' || mode === 'register' || mode === 'reset')) {
          const next = this.afterAuth;
          this.afterAuth = null;
          await next();
        }
      } catch (ex) {
        err.textContent = (ex as Error).message;
        err.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });

    // library
    this.el('libSaveCurrent').addEventListener('click', async () => {
      if (await this.saveAnywhere()) void this.renderLibrary();
    });
    this.el('libSignInBtn').addEventListener('click', () => {
      this.el('libraryModal').hidden = true;
      this.showAuth('', () => this.openLibrary());
    });
    this.el('libBackup').addEventListener('click', async () => {
      const url = URL.createObjectURL(new Blob([await this.local.exportAll()], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `pianissimo-library-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    this.el('libRestore').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) await this.restoreLibrary(await file.text());
      };
      input.click();
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
    this.el<HTMLFormElement>('shareInvite').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = this.el<HTMLFormElement>('shareInvite').elements.namedItem('email') as HTMLInputElement;
      if (!this.scoreId) return;
      try {
        const { editors } = await api.addEditor(this.scoreId, input.value);
        input.value = '';
        this.renderEditors(editors);
        this.toast('Invited: the score is now in their library');
      } catch (ex) {
        this.toast((ex as Error).message);
      }
    });
    this.el('shareEmbedCopy').addEventListener('click', async () => {
      const box = this.el<HTMLTextAreaElement>('shareEmbed');
      try {
        await navigator.clipboard.writeText(box.value);
      } catch {
        box.select();
        document.execCommand('copy');
      }
      this.toast('Embed code copied: paste it into your page’s HTML');
    });
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
  private mode: AuthMode = 'login';
  /** From a password reset link (#reset=…), until the new password is saved. */
  private resetToken = '';

  /** Switch the account dialog between signing in, a new account and the password pages. */
  private authMode(mode: AuthMode) {
    this.mode = mode;
    const form = this.el<HTMLFormElement>('authForm');
    const input = (name: string) => form.querySelector<HTMLInputElement>(`[name=${name}]`)!;
    const show = (id: string, on: boolean, field?: string) => {
      this.el(id).hidden = !on;
      if (field) input(field).required = on;
    };
    const password = mode === 'reset' || mode === 'change' || mode === 'login' || mode === 'register';
    this.el('authTabs').hidden = !(mode === 'login' || mode === 'register');
    this.el('authModal').querySelectorAll<HTMLButtonElement>('[data-auth]').forEach((b) => b.classList.toggle('on', b.dataset.auth === mode));
    show('authNameRow', mode === 'register');
    show('authEmailRow', mode === 'login' || mode === 'register' || mode === 'forgot', 'email');
    show('authCurrentRow', mode === 'change', 'current');
    show('authPasswordRow', password, 'password');
    show('authForgot', mode === 'login' && this.mailAvailable);
    show('authBack', mode === 'forgot');
    input('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    const texts: Record<AuthMode, [title: string, submit: string, help: string]> = {
      login: ['Sign in', 'Sign in', ''],
      register: ['Create your free account', 'Create account', ''],
      forgot: ['Forgot your password?', 'Send the link', 'Type the email of your account. We send you a link to choose a new password.'],
      reset: ['Choose a new password', 'Save the new password', 'At least 8 characters. Your other devices are signed out.'],
      change: ['Change your password', 'Change password', 'At least 8 characters. Your other devices are signed out.'],
    };
    const [title, submit, help] = texts[mode];
    this.el('authTitle').textContent = t(title);
    this.el('authSubmit').textContent = t(submit);
    this.el('authHelp').textContent = t(help);
    this.el('authHelp').hidden = !help;
    this.el('authPasswordLabel').textContent = t(mode === 'login' || mode === 'register' ? 'Password' : 'New password');
    this.el('authError').hidden = true;
    this.el('authDone').hidden = true;
  }

  showAuth(reason = '', then?: () => Promise<unknown>, mode: AuthMode = 'login') {
    this.afterAuth = then ?? null;
    this.authMode(mode);
    this.el('authReason').textContent = reason;
    this.el('authReason').hidden = !reason;
    this.el('authModal').hidden = false;
    const first = mode === 'change' ? 'current' : mode === 'reset' ? 'password' : 'email';
    this.el<HTMLFormElement>('authForm').querySelector<HTMLInputElement>(`[name=${first}]`)!.focus();
  }

  /** Change the password of the signed-in account. */
  changePassword() {
    if (this.user) this.showAuth('', undefined, 'change');
  }

  /** Send a new link that confirms the account's email address. */
  async resendVerification() {
    try {
      const { sent } = await api.resendVerification();
      this.toast(sent ? 'We sent you a new link: open it to confirm your email address' : 'No new link was sent: your address is confirmed already, or several links went out in the last hour');
    } catch (ex) {
      this.toast((ex as Error).message);
    }
  }

  /** A link from one of our emails: #reset=… opens "Choose a new password", #verify=… confirms the address. */
  private async followEmailLink() {
    const m = /^#(reset|verify)=([0-9a-f]{64})$/.exec(location.hash);
    if (!m) return;
    // the token must not stay in the address bar or the history
    history.replaceState(null, '', location.pathname + location.search);
    if (m[1] === 'reset') {
      this.resetToken = m[2];
      this.showAuth('', undefined, 'reset');
      return;
    }
    try {
      const { user } = await api.verifyEmail(m[2]);
      if (user) this.user = user;
      this.toast('Thank you: your email address is confirmed');
      this.onChange();
    } catch (ex) {
      this.toast((ex as Error).message);
    }
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

  /** Download everything stored about this account, as one JSON file. */
  async downloadMyData() {
    try {
      const { data } = await api.exportAccount();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pianissimo-my-data.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (ex) {
      this.toast((ex as Error).message);
    }
  }

  /** Delete the account and everything in it, after the password. */
  async deleteAccount() {
    if (!this.user) return;
    const ok = confirm(
      'Delete your account? Your library, shared scores, classes you teach, your work in classes, comments and likes are deleted for good. Download your data first if you want a copy.',
    );
    if (!ok) return;
    const password = prompt('Type your password to confirm:');
    if (!password) return;
    try {
      await api.deleteAccount(password);
      this.user = null;
      this.forget();
      this.toast('Your account and its data were deleted. The score open here stays in this browser.');
    } catch (ex) {
      this.toast((ex as Error).message);
    }
  }

  async openLibrary(): Promise<void> {
    this.el('libraryModal').hidden = false;
    await this.renderLibrary();
  }

  /** Add the scores of a library backup file to this computer's library. */
  async restoreLibrary(text: string) {
    try {
      const n = await this.local.importAll(text, isValidScore);
      this.toast(`Added ${n} ${n === 1 ? 'score' : 'scores'} to My scores`);
      if (!this.el('libraryModal').hidden) void this.renderLibrary();
    } catch (ex) {
      this.toast((ex as Error).message);
    }
  }

  private async renderLibrary() {
    this.el('libOnline').hidden = !this.user;
    this.el('libSignIn').hidden = !!this.user || !this.serverAvailable;
    await this.renderLocal();
    if (this.user) await this.renderOnline();
  }

  /** The scores saved on this computer. */
  private async renderLocal() {
    const host = this.el('libLocal');
    let scores: LocalMeta[];
    try {
      scores = await this.local.list();
    } catch (ex) {
      host.innerHTML = `<p class="form-error">${esc((ex as Error).message)}</p>`;
      return;
    }
    this.el('libCount').textContent = this.user ? '' : `${scores.length} ${scores.length === 1 ? 'score' : 'scores'}`;
    if (!scores.length) {
      host.innerHTML = `<p class="hint">${t('Nothing here yet. Press Ctrl+S in the editor to save the score you are writing; it then keeps itself saved.')}</p>`;
      return;
    }
    host.innerHTML = scores
      .map(
        (s) => `<div class="lib-row ${s.id === this.localId ? 'current' : ''}" data-id="${esc(s.id)}">
          <div class="lib-main"><b>${esc(s.title)}</b><span>${esc(s.composer)}</span></div>
          <span class="lib-date">${new Date(s.updated_at).toLocaleString()}</span>
          <button data-act="open">${t('Open')}</button><button data-act="dup">${t('Duplicate')}</button>${
            this.user ? `<button data-act="up" title="${t('Copy it to your online library')}">${t('Copy online')}</button>` : ''
          }<button data-act="del" class="danger">${t('Delete')}</button>
        </div>`,
      )
      .join('');
    host.querySelectorAll<HTMLElement>('.lib-row').forEach((row) => {
      const id = row.dataset.id!;
      const title = scores.find((s) => s.id === id)!.title;
      row.querySelector('[data-act=open]')!.addEventListener('click', () => void this.openLocal(id));
      row.querySelector('[data-act=dup]')!.addEventListener('click', async () => {
        await this.local.duplicate(id);
        void this.renderLocal();
      });
      row.querySelector('[data-act=up]')?.addEventListener('click', async () => {
        const item = await this.local.get(id);
        if (!item) return;
        try {
          await api.createScore(item.data);
          this.toast(`“${title}” copied to your online library`);
          void this.renderOnline();
        } catch (ex) {
          this.toast((ex as Error).message);
        }
      });
      row.querySelector('[data-act=del]')!.addEventListener('click', async () => {
        if (!confirm(t('Delete this score from this computer? This cannot be undone.') + `\n\n${title}`)) return;
        await this.local.remove(id);
        if (id === this.localId) this.forgetLocal();
        void this.renderLocal();
      });
    });
  }

  /** Open a score from the library on this computer; it then keeps itself saved there. */
  async openLocal(id: string) {
    const item = await this.local.get(id);
    if (!item) {
      this.toast('That score is no longer on this computer');
      return;
    }
    this.confirmLoad(item.data);
    this.forget();
    this.linkLocal(id, JSON.stringify(this.editor.score));
    this.el('libraryModal').hidden = true;
    this.toast(`Opened “${item.meta.title}”`);
  }

  /** The scores in the online library. */
  private async renderOnline() {
    const host = this.el('libList');
    host.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const { scores } = await api.listScores();
      if (!scores.length) {
        host.innerHTML = '<p class="hint">Nothing here yet. Press <kbd>Ctrl</kbd>+<kbd>S</kbd> in the editor to save your score.</p>';
        return;
      }
      const badge = (v: Visibility) => `<span class="vis vis-${v}">${v === 'unlisted' ? 'link' : v}</span>`;
      host.innerHTML = scores
        .map(
          (s) => `<div class="lib-row ${s.id === this.scoreId ? 'current' : ''}" data-id="${s.id}">
            <div class="lib-main"><b>${esc(s.title)}</b><span>${esc(s.composer || '')}${s.role === 'editor' ? ` · shared by ${esc(s.owner ?? '')}` : ''}</span></div>
            ${s.role === 'editor' ? '<span class="vis vis-shared">shared</span>' : badge(s.visibility)}
            <span class="lib-date">${new Date(s.updated_at).toLocaleString()}</span>
            <button data-act="open">Open</button><button data-act="dup">Duplicate</button>${s.role === 'editor' ? '' : '<button data-act="del" class="danger">Delete</button>'}
          </div>`,
        )
        .join('');
      host.querySelectorAll<HTMLElement>('.lib-row').forEach((row) => {
        const id = Number(row.dataset.id);
        const title = scores.find((s) => s.id === id)!.title;
        row.querySelector('[data-act=open]')!.addEventListener('click', () => this.openScore(id));
        row.querySelector('[data-act=dup]')!.addEventListener('click', async () => {
          await api.duplicateScore(id);
          void this.renderOnline();
        });
        row.querySelector('[data-act=del]')?.addEventListener('click', async () => {
          if (!confirm(`Delete “${title}” from your library? This cannot be undone.`)) return;
          await api.deleteScore(id);
          if (id === this.scoreId) this.forget();
          void this.renderOnline();
        });
      });
    } catch (ex) {
      host.innerHTML = `<p class="form-error">${esc((ex as Error).message)}</p>`;
    }
  }

  /** Open a library score (own, or shared with this user) in the editor. */
  async openScore(id: number) {
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

  private showConflict() {
    this.el('conflictModal').hidden = false;
    this.el('conflictMine').focus();
  }

  async showHistory(): Promise<void> {
    if (!this.user) return this.showAuth('Sign in to keep a history of your score.', () => this.showHistory());
    if (!this.scoreId) {
      this.toast('Save the score to your library first (Ctrl+S); history starts from there.');
      return;
    }
    const id = this.scoreId;
    const host = this.el('historyList');
    this.el('historyModal').hidden = false;
    host.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const { versions } = await api.listVersions(id);
      if (!versions.length) {
        host.innerHTML = '<p class="hint">No earlier versions yet. They appear after you save changes.</p>';
        return;
      }
      host.innerHTML = versions
        .map(
          (v) => `<div class="lib-row" data-id="${v.id}">
            <div class="lib-main"><b>${new Date(v.created_at).toLocaleString()}</b><span>${esc(v.title)}</span></div>
            <button data-act="restore">Restore</button>
          </div>`,
        )
        .join('');
      host.querySelectorAll<HTMLElement>('.lib-row').forEach((row) =>
        row.querySelector('[data-act=restore]')!.addEventListener('click', async () => {
          try {
            const { version } = await api.getVersion(id, Number(row.dataset.id));
            this.confirmLoad(version.data);
            this.el('historyModal').hidden = true;
            this.toast(`Restored the version from ${new Date(version.created_at).toLocaleString()} (Ctrl+Z undoes)`);
          } catch (ex) {
            this.toast((ex as Error).message);
          }
        }),
      );
    } catch (ex) {
      host.innerHTML = `<p class="form-error">${esc((ex as Error).message)}</p>`;
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
    void api
      .listEditors(this.scoreId!)
      .then(({ editors }) => this.renderEditors(editors))
      .catch(() => this.renderEditors([]));
  }

  private renderEditors(editors: { id: number; name: string; email: string; role: 'owner' | 'editor' }[]) {
    const owner = this.meta?.role !== 'editor';
    this.el('shareInvite').hidden = !owner;
    this.el('shareEditorsHint').hidden = !owner;
    const host = this.el('shareEditors');
    host.innerHTML = editors
      .map((e) => {
        const me = e.id === this.user?.id;
        const canRemove = e.role === 'editor' && (owner || me);
        return `<li><span><b>${esc(e.name)}</b> <span class="hint">${esc(e.email)}</span></span>
          <span class="role">${e.role === 'owner' ? 'owner' : 'can edit'}</span>
          ${canRemove ? `<button class="small" data-remove="${e.id}">${me ? 'Leave' : 'Remove'}</button>` : ''}</li>`;
      })
      .join('');
    host.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
      b.addEventListener('click', async () => {
        const uid = Number(b.dataset.remove);
        if (!this.scoreId) return;
        try {
          await api.removeEditor(this.scoreId, uid);
          if (uid === this.user?.id) {
            this.el('shareModal').hidden = true;
            this.forget();
            this.toast('You left this score; it is no longer in your library');
            return;
          }
          this.renderEditors(editors.filter((x) => x.id !== uid));
        } catch (ex) {
          this.toast((ex as Error).message);
        }
      }),
    );
  }

  private renderShare() {
    if (!this.meta) return;
    this.el('shareTitle').textContent = this.meta.title;
    this.el('shareModal').querySelectorAll<HTMLInputElement>('input[name=vis]').forEach((r) => {
      r.checked = r.value === this.meta!.visibility;
      r.disabled = this.meta!.role === 'editor';
    });
    const shared = this.meta.visibility !== 'private';
    this.el('shareLinkRow').hidden = !shared;
    this.el('shareEmbedRow').hidden = !shared;
    if (shared) {
      const url = shareUrl(this.meta.slug);
      this.el<HTMLInputElement>('shareLink').value = url;
      this.el<HTMLAnchorElement>('shareOpen').href = url;
      this.el<HTMLTextAreaElement>('shareEmbed').value = embedCode(this.meta.slug, this.meta.title);
    }
  }
}
