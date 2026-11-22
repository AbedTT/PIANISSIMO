/**
 * Integration test for the PHP API: starts `php -S` on a throw-away SQLite database
 * and drives it like the browser does (cookies + CSRF header). Skipped when PHP is missing.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newScore } from '../model/score';

const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].find(
  (c) => c && (existsSync(c) || spawnSync(c, ['-v']).status === 0),
);
const PORT = 8123;
const BASE = `http://localhost:${PORT}/server/api/index.php`;

/** A minimal browser: keeps the session cookie and the CSRF token. */
class Client {
  cookie = '';
  csrf = '';
  async call(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' && opts.csrf !== false ? { 'X-CSRF-Token': this.csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    const sid = set?.match(/pianissimo_sid=[^;]+/)?.[0];
    if (sid) this.cookie = sid;
    const data = await res.json();
    if (data.csrf) this.csrf = data.csrf;
    return { status: res.status, data };
  }
}

let server: ChildProcess | undefined;
let dir = '';

describe.skipIf(!php)('PHP API', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pianissimo-'));
    server = spawn(php!, ['-S', `localhost:${PORT}`, '-t', resolve(__dirname, '../..')], {
      env: { ...process.env, PIANISSIMO_DB: join(dir, 'test.sqlite') },
      stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${BASE}/health`)).ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('PHP server did not start');
  }, 15000);

  afterAll(() => {
    server?.kill();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may still hold the file briefly */
    }
  });

  const alice = new Client();
  const bob = new Client();
  const visitor = new Client();
  let id = 0;
  let slug = '';

  it('rejects writes without the CSRF token', async () => {
    const me = await alice.call('GET', '/auth/me');
    expect(me.data.user).toBeNull();
    expect(me.data.csrf).toMatch(/^[0-9a-f]{64}$/);
    const r = await alice.call('POST', '/auth/register', { name: 'A', email: 'a@example.com', password: 'secret123' }, { csrf: false });
    expect(r.status).toBe(403);
  });

  it('registers, validates input and refuses duplicate emails', async () => {
    expect((await alice.call('POST', '/auth/register', { name: 'Alice', email: 'bad', password: 'secret123' })).status).toBe(422);
    expect((await alice.call('POST', '/auth/register', { name: 'Alice', email: 'a@example.com', password: 'short' })).status).toBe(422);
    const ok = await alice.call('POST', '/auth/register', { name: 'Alice', email: 'Alice@Example.com', password: 'secret123' });
    expect(ok.status).toBe(201);
    expect(ok.data.user).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    await bob.call('GET', '/auth/me');
    expect((await bob.call('POST', '/auth/register', { name: 'B', email: 'alice@example.com', password: 'secret123' })).status).toBe(409);
    expect((await bob.call('POST', '/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'secret123' })).status).toBe(201);
  });

  it('saves, lists, reads and updates a score; rejects invalid data', async () => {
    const score = newScore({ title: 'Song for Bob', composer: 'Alice' });
    const created = await alice.call('POST', '/scores', { data: score });
    expect(created.status).toBe(201);
    expect(created.data.score).toMatchObject({ title: 'Song for Bob', composer: 'Alice', visibility: 'private' });
    id = created.data.score.id;
    slug = created.data.score.slug;
    expect((await alice.call('GET', '/scores')).data.scores).toHaveLength(1);
    const got = await alice.call('GET', `/scores/${id}`);
    expect(got.data.score.data.measures).toHaveLength(score.measures.length);
    const renamed = await alice.call('PUT', `/scores/${id}`, { data: { ...score, title: 'Renamed' } });
    expect(renamed.data.score.title).toBe('Renamed');
    expect((await alice.call('POST', '/scores', { data: { hello: 'world' } })).status).toBe(422);
  });

  it('keeps earlier versions and refuses to overwrite a newer save', async () => {
    const versions = await alice.call('GET', `/scores/${id}/versions`);
    expect(versions.data.versions).toHaveLength(1); // the state before the rename
    const old = await alice.call('GET', `/scores/${id}/versions/${versions.data.versions[0].id}`);
    expect(old.data.version.data.title).toBe('Song for Bob');
    expect((await bob.call('GET', `/scores/${id}/versions`)).status).toBe(404);

    const meta = (await alice.call('GET', `/scores/${id}`)).data.score;
    const data = { ...meta.data, composer: 'Alice B.' };
    const first = await alice.call('PUT', `/scores/${id}`, { data, base_revision: meta.revision });
    expect(first.data.score.revision).toBe(meta.revision + 1);
    // a second tab still based on the old revision
    const stale = await alice.call('PUT', `/scores/${id}`, { data: { ...data, composer: 'Other tab' }, base_revision: meta.revision });
    expect(stale.status).toBe(409);
    const forced = await alice.call('PUT', `/scores/${id}`, { data: { ...data, composer: 'Other tab' }, base_revision: meta.revision, force: true });
    expect(forced.status).toBe(200);
    // the 5-minute throttle keeps only one entry for these quick saves
    expect((await alice.call('GET', `/scores/${id}/versions`)).data.versions).toHaveLength(1);
  });

  it('keeps scores private to their owner', async () => {
    expect((await bob.call('GET', `/scores/${id}`)).status).toBe(404);
    expect((await bob.call('DELETE', `/scores/${id}`)).status).toBe(404);
    expect((await visitor.call('GET', `/public/${slug}`)).status).toBe(404);
    expect((await visitor.call('GET', '/scores')).status).toBe(401);
  });

  it('shares by link (unlisted) and publicly (listed + searchable)', async () => {
    await alice.call('PUT', `/scores/${id}`, { visibility: 'unlisted' });
    const shared = await visitor.call('GET', `/public/${slug}`);
    expect(shared.status).toBe(200);
    expect(shared.data.score).toMatchObject({ title: 'Renamed', author: 'Alice' });
    expect((await visitor.call('GET', '/public')).data.scores).toHaveLength(0);
    await alice.call('PUT', `/scores/${id}`, { visibility: 'public' });
    expect((await visitor.call('GET', '/public')).data.scores).toHaveLength(1);
    expect((await visitor.call('GET', '/public?q=renam')).data.scores).toHaveLength(1);
    expect((await visitor.call('GET', '/public?q=nothing%25')).data.scores).toHaveLength(0);
    expect((await alice.call('PUT', `/scores/${id}`, { visibility: 'everyone' })).status).toBe(422);
  });

  it('duplicates and deletes', async () => {
    const copy = await alice.call('POST', `/scores/${id}/duplicate`, {});
    expect(copy.data.score.title).toBe('Renamed (copy)');
    expect(copy.data.score.visibility).toBe('private');
    expect((await alice.call('DELETE', `/scores/${copy.data.score.id}`)).status).toBe(200);
    expect((await alice.call('GET', '/scores')).data.scores).toHaveLength(1);
  });

  it('signs out and back in; throttles password guessing', async () => {
    await alice.call('POST', '/auth/logout', {});
    expect((await alice.call('GET', '/scores')).status).toBe(401);
    expect((await alice.call('POST', '/auth/login', { email: 'alice@example.com', password: 'wrong-pass' })).status).toBe(401);
    expect((await alice.call('POST', '/auth/login', { email: 'alice@example.com', password: 'secret123' })).status).toBe(200);
    expect((await alice.call('GET', '/scores')).data.scores).toHaveLength(1);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await visitor.call('POST', '/auth/login', { email: 'x@example.com', password: 'nope-nope' })).status;
    }
    expect(last).toBe(429);
  });
});
