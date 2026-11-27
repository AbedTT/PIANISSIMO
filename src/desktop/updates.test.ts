import { describe, expect, it } from 'vitest';
import { checkForUpdate, latestRelease, newer, remindLater, type DesktopInfo } from './updates';

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const windows: DesktopInfo = { platform: 'windows', version: '0.3.0', canInstall: true };

describe('desktop updates', () => {
  it('compares versions as numbers', () => {
    expect(newer('0.10.0', '0.9.9')).toBe(true);
    expect(newer('v0.4.0', '0.3.0')).toBe(true);
    expect(newer('0.3.0', '0.3.0')).toBe(false);
    expect(newer('0.3', '0.3.1')).toBe(false);
    expect(newer('1.0.0-beta', '0.9.0')).toBe(true);
  });

  it('reads the latest GitHub release, or a latest.json on a website', async () => {
    const gh = await latestRelease('github:me/app', json({ tag_name: 'v0.4.0', body: '- Library on this computer', html_url: 'https://github.com/me/app/releases/tag/v0.4.0' }));
    expect(gh).toEqual({ version: '0.4.0', notes: '- Library on this computer', url: 'https://github.com/me/app/releases/tag/v0.4.0' });
    const site = await latestRelease('https://music.example.com/downloads/latest.json', json({ version: '0.4.1' }));
    expect(site).toEqual({ version: '0.4.1', notes: '', url: 'https://music.example.com/downloads/' });
    await expect(latestRelease('github:me/app', json({}, 404))).rejects.toThrow('No release');
    await expect(latestRelease('', json({}))).rejects.toThrow('No update feed');
  });

  it('checks at every start (not twice within minutes), tells only about newer versions, and respects "Later"', async () => {
    const storage = memory();
    const feed = json({ tag_name: 'v0.4.0', html_url: 'u' });
    const day0 = 1_000_000_000_000;
    expect((await checkForUpdate(windows, 'github:me/app', { now: day0, storage, fetcher: feed }))?.version).toBe('0.4.0');
    expect(await checkForUpdate(windows, 'github:me/app', { now: day0 + 60_000, storage, fetcher: feed })).toBeNull(); // restarted a minute later
    // started again an hour later (a release published meanwhile is found the same day)
    expect((await checkForUpdate(windows, 'github:me/app', { now: day0 + 3600_000, storage, fetcher: feed }))?.version).toBe('0.4.0');
    remindLater('0.4.0', storage);
    expect(await checkForUpdate(windows, 'github:me/app', { now: day0 + 2 * 86400_000, storage, fetcher: feed })).toBeNull();
    // asking from the menu always answers
    expect((await checkForUpdate(windows, 'github:me/app', { force: true, now: day0 + 3 * 86400_000, storage, fetcher: feed }))?.version).toBe('0.4.0');
    // an even newer one is shown again
    const next = json({ tag_name: 'v0.5.0', html_url: 'u' });
    expect((await checkForUpdate(windows, 'github:me/app', { now: day0 + 4 * 86400_000, storage, fetcher: next }))?.version).toBe('0.5.0');
    // nothing newer
    expect(await checkForUpdate({ ...windows, version: '0.5.0' }, 'github:me/app', { force: true, storage, fetcher: next })).toBeNull();
  });
});
