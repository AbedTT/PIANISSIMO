import { t } from '../ui/i18n';
import { checkForUpdate, desktopInfo, installUpdate, remindLater, type DesktopInfo, type Release } from './updates';

/** Seconds after start before the automatic check (the app gets going first). */
const FIRST_CHECK_DELAY_MS = 4000;

/**
 * The desktop app tells you when a new release is out: a bar at the top with what is new,
 * "Update now" (Windows: downloads, installs and reopens) or "Download" (macOS, Linux, the
 * portable copy), and "Later". Checks once a day when the app starts, and on request.
 */
export function initUpdates(opts: { toast: (msg: string) => void; beforeInstall: () => Promise<void> }) {
  let info: DesktopInfo | null | undefined;
  const getInfo = async () => (info === undefined ? (info = await desktopInfo()) : info);

  async function check(force: boolean) {
    const me = await getInfo();
    if (!me) {
      if (force) opts.toast('This is the web version of Pianissimo: it updates itself whenever you reload the page');
      return;
    }
    try {
      const release = await checkForUpdate(me, __UPDATE_FEED__, { force });
      if (release) show(me, release);
      else if (force) opts.toast(`You have the latest version (${me.version})`);
    } catch (err) {
      if (force) opts.toast(`Could not check for updates: ${(err as Error).message}`);
    }
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

  window.setTimeout(() => void check(false), FIRST_CHECK_DELAY_MS);
  return { checkNow: () => check(true) };
}
