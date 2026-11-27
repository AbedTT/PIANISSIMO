import { t } from '../ui/i18n';
import { RECHECK_MS, checkForUpdate, desktopInfo, installUpdate, remindLater, type DesktopInfo, type Release } from './updates';

/** Seconds after start before the automatic check (the app gets going first). */
const FIRST_CHECK_DELAY_MS = 4000;

/** How long the answer to "Check for updates" stays when there is nothing new. */
const ANSWER_MS = 12000;

/**
 * The desktop app tells you when a new release is out: a bar at the top with what is new,
 * "Update now" (Windows: downloads, installs and reopens) or "Download" (macOS, Linux, the
 * portable copy), and "Later". Checks when the app starts, once a day while it stays open, and
 * on request; a check on request always answers in the bar (up to date, or what went wrong).
 */
export function initUpdates(opts: { toast: (msg: string) => void; beforeInstall: () => Promise<void> }) {
  let info: DesktopInfo | null | undefined;
  const getInfo = async () => (info === undefined ? (info = await desktopInfo()) : info);

  async function check(force: boolean) {
    if (force) answer(t('Checking for updates…'));
    const me = await getInfo();
    if (!me) {
      if (force) answer(t('This is the web version of Pianissimo: it updates itself whenever you reload the page'), 'ok');
      return;
    }
    try {
      const release = await checkForUpdate(me, __UPDATE_FEED__, { force });
      if (release) show(me, release);
      else if (force) answer(t('✓ Pianissimo is up to date: you have the latest version ({version}).').replace('{version}', me.version), 'ok');
    } catch (err) {
      if (force) answer(`${t('Could not check for updates:')} ${t((err as Error).message)}`, 'error');
    }
  }

  /** The answer to "Check for updates", in the same bar as a new release. */
  function answer(message: string, kind?: 'ok' | 'error') {
    document.getElementById('updateBar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'updateBar';
    bar.className = `update-bar${kind === 'ok' ? ' update-ok' : kind === 'error' ? ' update-error' : ''}`;
    bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.className = 'update-text';
    text.textContent = message;
    bar.append(text);
    if (kind) {
      if (kind === 'error') {
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'link-btn';
        again.textContent = t('Try again');
        again.addEventListener('click', () => void check(true));
        bar.append(again);
      }
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'primary small';
      ok.textContent = t('OK');
      ok.addEventListener('click', () => bar.remove());
      bar.append(ok);
      if (kind === 'ok') setTimeout(() => bar.remove(), ANSWER_MS);
    }
    document.body.prepend(bar);
  }

  function show(me: DesktopInfo, release: Release) {
    document.getElementById('updateBar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'updateBar';
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.className = 'update-text';
    text.textContent = t('Pianissimo {version} is available.').replace('{version}', release.version) + ` (${t('you have')} ${me.version})`;
    const button = (label: string, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t(label);
      if (cls) b.className = cls;
      return b;
    };
    const notes = document.createElement('pre');
    notes.className = 'update-notes';
    notes.hidden = true;
    notes.textContent = release.notes.trim().slice(0, 4000) || t('No release notes.');
    const whatsNew = button("What's new", 'link-btn');
    whatsNew.addEventListener('click', () => (notes.hidden = !notes.hidden));
    const later = button('Later', 'link-btn');
    later.addEventListener('click', () => {
      remindLater(release.version);
      bar.remove();
    });
    const download = () => window.open(release.url, '_blank', 'noopener');
    const main = button(me.canInstall ? 'Update now' : 'Download', 'primary small');
    let byHand = !me.canInstall;
    main.addEventListener('click', async () => {
      if (byHand) {
        download();
        return;
      }
      main.disabled = true;
      later.hidden = true;
      main.textContent = t('Downloading…');
      try {
        await opts.beforeInstall(); // your work is saved first
        await installUpdate();
        text.textContent = t('Installing the update: Pianissimo closes and opens again in a moment. Your scores are kept.');
        main.remove();
        // close this window so the browser can store everything; the setup reopens Pianissimo
        setTimeout(() => window.close(), 1200);
      } catch (err) {
        main.disabled = false;
        later.hidden = false;
        main.textContent = t('Download');
        byHand = true; // fall back to installing it by hand
        opts.toast((err as Error).message);
      }
    });
    bar.append(text, whatsNew, main, later, notes);
    document.body.prepend(bar);
  }

  // the desktop app shows its version and a "Check for updates" button in the side panel
  void getInfo().then((me) => {
    const btn = document.getElementById('updatesBtn');
    const version = document.getElementById('appVersion');
    if (!me || !btn || !version) return;
    btn.hidden = false;
    version.hidden = false;
    version.textContent = `Pianissimo ${me.version}`;
  });
  window.setTimeout(() => void check(false), FIRST_CHECK_DELAY_MS);
  // left open for days: look again once a day
  window.setInterval(() => void check(false), RECHECK_MS);
  return { checkNow: () => check(true) };
}
