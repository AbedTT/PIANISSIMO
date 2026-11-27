import { api, type AppNotification, type EmailMode } from './api';
import { t, tMsg } from '../ui/i18n';
import type { Cloud } from './ui';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ICON: Record<string, string> = { invite: '✏️', assignment: '📚', 'handed-in': '📥', returned: '📤', comment: '💬' };
const POLL_MS = 60_000;

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The bell in the editor's header: invitations, assignments, hand-ins, feedback and comments.
 * Checked every minute and whenever the tab comes back; opening one marks it read and goes
 * there (a library score or a class in this tab, a public page in a new one).
 */
export function initNotifications(
  cloud: Cloud,
  hooks: { openScore(id: number): void; openClass(id: number): void },
) {
  const wrap = document.getElementById('bell')!;
  const button = document.getElementById('bellBtn')!;
  const count = document.getElementById('bellCount')!;
  const panel = document.getElementById('bellPanel')!;
  let items: AppNotification[] = [];
  let email: { available: boolean; mode: EmailMode } = { available: false, mode: 'each' };
  let timer = 0;

  async function refresh() {
    if (!cloud.user) return;
    try {
      const r = await api.notifications();
      items = r.notifications;
      email = r.email;
      count.textContent = r.unread > 9 ? '9+' : String(r.unread);
      count.hidden = !r.unread;
      button.setAttribute('aria-label', r.unread ? `Notifications: ${r.unread} new` : 'Notifications');
      if (!panel.hidden) render();
    } catch {
      /* offline: try again later */
    }
  }

  function render() {
    panel.innerHTML = `<header><b>${t('Notifications')}</b>${items.some((n) => !n.read) ? '<button class="link-btn" data-act="all">Mark all read</button>' : ''}</header>
      <ul>${items
        .map(
          (n) => `<li class="${n.read ? '' : 'unread'}"><button type="button" data-id="${n.id}">
            <span class="n-icon" aria-hidden="true">${ICON[n.kind] ?? '🔔'}</span>
            <span class="n-text">${esc(tMsg(n.text))}<small>${ago(n.created_at)}</small></span></button></li>`,
        )
        .join('') || `<li class="hint empty">${t('Nothing yet. Invitations, assignments, feedback and comments show up here.')}</li>`}</ul>
      <footer>
        ${email.available
          ? `<label>${t('Email')} <select data-act="email">${(
              [
                ['off', 'No emails'],
                ['each', 'Each one'],
                ['daily', 'A daily summary'],
              ] as const
            )
              .map(([v, l]) => `<option value="${v}" ${email.mode === v ? 'selected' : ''}>${t(l)}</option>`)
              .join('')}</select></label>`
          : ''}
        ${cloud.user?.admin ? '<a href="admin.html" target="_blank" rel="noopener">Review reports ↗</a>' : ''}
      </footer>`;
    panel.querySelector('[data-act="all"]')?.addEventListener('click', async () => {
      await api.markRead().catch(() => {});
      void refresh();
    });
    panel.querySelector<HTMLSelectElement>('[data-act="email"]')?.addEventListener('change', (e) => {
      email.mode = (e.target as HTMLSelectElement).value as EmailMode;
      void api.setNotifyEmail(email.mode).catch(() => {});
    });
    panel.querySelectorAll<HTMLButtonElement>('li button[data-id]').forEach((b) =>
      b.addEventListener('click', async () => {
        const n = items.find((x) => x.id === Number(b.dataset.id))!;
        panel.hidden = true;
        await api.markRead([n.id]).catch(() => {});
        void refresh();
        go(n.link);
      }),
    );
  }

  /** Follow a notification's link without leaving the editor when it points into it. */
  function go(link: string) {
    const url = new URL(link, location.href);
    const open = Number(url.searchParams.get('open'));
    const cls = Number(url.searchParams.get('class'));
    if (url.pathname.endsWith('app.html') && open) hooks.openScore(open);
    else if (url.pathname.endsWith('app.html') && cls) hooks.openClass(cls);
    else window.open(url.href, '_blank', 'noopener');
  }

  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      render();
      void refresh();
    }
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !wrap.contains(e.target as Node)) panel.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      button.focus();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });

  /** Show the bell for signed-in people (call when the account changes). */
  function update() {
    const signedIn = !!cloud.user;
    if (wrap.hidden === !signedIn) return;
    wrap.hidden = !signedIn;
    clearInterval(timer);
    if (signedIn) {
      void refresh();
      timer = window.setInterval(() => void refresh(), POLL_MS);
    } else panel.hidden = true;
  }

  return { update, refresh };
}
