/**
 * New releases for the desktop app.
 *
 * The desktop launcher answers `/__desktop.json` (platform, installed version, whether it can
 * install an update itself). The website has no such file, and updates itself through its
 * service worker, so none of this runs there.
 *
 * Where releases are announced is set at build time (`pianissimo.updateFeed` in package.json):
 *   github:owner/repo      the latest GitHub release of that (public) repository, or
 *   https://…/latest.json  a file written by `npm run package` and put on your own website.
 */

export interface DesktopInfo {
  platform: 'windows' | 'macos' | 'linux';
  version: string;
  /** The installed Windows app downloads and runs the new setup itself (the portable copy cannot). */
  canInstall: boolean;
  /** Audiveris is installed on this computer, so "Scan a page" works without a server. */
  scan?: boolean;
}

export interface Release {
  version: string;
  /** Release notes (plain text or Markdown). */
  notes: string;
  /** The release page, for reading and downloading. */
  url: string;
}

const LAST_CHECK_KEY = 'pianissimo:updateCheck';
const LATER_KEY = 'pianissimo:updateLater';
const DAY = 24 * 3600 * 1000;

/** "0.10.1" > "0.9.3"; a leading "v" and a "-beta" suffix are ignored. */
export function newer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The launcher's description of this copy, or null when this is the website. Asked afresh each time
 * (whether Audiveris is installed can change while the app runs). */
export async function desktopInfo(): Promise<DesktopInfo | null> {
  try {
    const res = await fetch('/__desktop.json', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const info = (await res.json()) as DesktopInfo;
    return typeof info.version === 'string' && info.platform ? info : null;
  } catch {
    return null;
  }
}

/** The newest release announced by the feed. */
export async function latestRelease(feed: string, fetcher: typeof fetch = fetch): Promise<Release> {
  const github = /^github:([\w.-]+\/[\w.-]+)$/.exec(feed);
  if (github) {
    const res = await fetcher(`https://api.github.com/repos/${github[1]}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(res.status === 404 ? 'No release has been published yet' : `The release list answered ${res.status}`);
    const r = (await res.json()) as { tag_name: string; body?: string; html_url: string };
    return { version: r.tag_name.replace(/^v/i, ''), notes: r.body ?? '', url: r.html_url };
  }
  if (!/^https:\/\//.test(feed)) throw new Error('No update feed is set for this build');
  const res = await fetcher(feed, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The update feed answered ${res.status}`);
  const r = (await res.json()) as { version: string; notes?: string; url?: string };
  return { version: String(r.version).replace(/^v/i, ''), notes: r.notes ?? '', url: r.url ?? new URL('.', feed).href };
}

/**
 * Is there a newer release? Automatic checks run at most once a day and stay quiet after
 * "Later" for that version; a manual check (`force`) always asks.
 */
export async function checkForUpdate(
  info: DesktopInfo,
  feed: string,
  opts: { force?: boolean; now?: number; storage?: Pick<Storage, 'getItem' | 'setItem'>; fetcher?: typeof fetch } = {},
): Promise<Release | null> {
  const now = opts.now ?? Date.now();
  const storage = opts.storage ?? localStorage;
  if (!opts.force && now - Number(storage.getItem(LAST_CHECK_KEY) ?? 0) < DAY) return null;
  storage.setItem(LAST_CHECK_KEY, String(now));
  const release = await latestRelease(feed, opts.fetcher);
  if (!newer(release.version, info.version)) return null;
  if (!opts.force && storage.getItem(LATER_KEY) === release.version) return null;
  return release;
}

/** "Later": no more automatic reminders for this version. */
export function remindLater(version: string, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(LATER_KEY, version);
}

/**
 * Windows: ask the launcher to download the new setup, check it and run it. The setup closes
 * Pianissimo, installs over it (scores and settings stay) and opens it again.
 */
export async function installUpdate(): Promise<void> {
  const res = await fetch('/__desktop/update', {
    method: 'POST',
    // a custom header: other websites cannot send it to this computer's launcher without permission
    headers: { 'X-Pianissimo-Desktop': '1' },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The update could not be installed (${res.status})`);
}
