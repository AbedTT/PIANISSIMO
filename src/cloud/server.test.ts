/**
 * Integration test for the PHP API: starts `php -S` on a throw-away SQLite database
 * and drives it like the browser does (cookies + CSRF header). Skipped when PHP is missing.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newScore } from '../model/score';

const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].find(
  (c) => c && (existsSync(c) || spawnSync(c, ['-v']).status === 0),
);
const PORT = 8123;
const BASE = `http://localhost:${PORT}/server/api/index.php`;
const RT_PORT = 8124;
const RT_SECRET = 'test-secret-0123456789abcdef';
let MAIL_LOG = '';

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

/**
 * The test database: a throw-away SQLite file, or with TEST_DB_DSN=mysql:host=…;dbname=… the
 * same tests on MySQL/MariaDB (an empty database).
 */
const dbEnv = (): Record<string, string> =>
  process.env.TEST_DB_DSN
    ? { PIANISSIMO_DB_DSN: process.env.TEST_DB_DSN, PIANISSIMO_DB_USER: process.env.TEST_DB_USER ?? 'root', PIANISSIMO_DB_PASS: process.env.TEST_DB_PASS ?? '' }
    : { PIANISSIMO_DB: join(dir, 'test.sqlite') };

let server: ChildProcess | undefined;
let realtime: ChildProcess | undefined;
let dir = '';

describe.skipIf(!php)('PHP API', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pianissimo-'));
    server = spawn(php!, ['-S', `localhost:${PORT}`, '-t', resolve(__dirname, '../..')], {
      env: {
        ...process.env,
        ...dbEnv(),
        PIANISSIMO_REALTIME_URL: `ws://localhost:${RT_PORT}`,
        PIANISSIMO_REALTIME_SECRET: RT_SECRET,
        PIANISSIMO_DEBUG: '1',
        PIANISSIMO_ADMINS: 'alice@example.com',
        PIANISSIMO_MAIL_FROM: 'music@example.com',
        // a stand-in for Audiveris that writes a fixed score
        PIANISSIMO_OMR_COMMAND: `"${process.execPath}" "${resolve(__dirname, '../../scripts/fake-omr.mjs')}" {in} {out}`,
        PIANISSIMO_SITE_URL: 'https://music.example.com/',
        PIANISSIMO_MAIL_LOG: (MAIL_LOG = join(dir, 'mail.log')),
      },
      stdio: 'ignore',
    });
    realtime = spawn(process.execPath, [resolve(__dirname, '../../realtime/server.mjs')], {
      env: { ...process.env, PORT: String(RT_PORT), PIANISSIMO_REALTIME_SECRET: RT_SECRET },
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
    realtime?.kill();
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

  it('invites editors, who can open and save but not delete or change sharing', async () => {
    const own = await alice.call('POST', '/scores', { data: newScore({ title: 'Duet' }) });
    const duet = own.data.score.id;
    expect((await bob.call('GET', `/scores/${duet}`)).status).toBe(404);
    expect((await bob.call('POST', `/scores/${duet}/editors`, { email: 'bob@example.com' })).status).toBe(404);
    expect((await alice.call('POST', `/scores/${duet}/editors`, { email: 'nobody@example.com' })).status).toBe(404);
    expect((await alice.call('POST', `/scores/${duet}/editors`, { email: 'alice@example.com' })).status).toBe(422);
    const added = await alice.call('POST', `/scores/${duet}/editors`, { email: 'BOB@example.com' });
    expect(added.data.editors.map((e: { name: string; role: string }) => `${e.name}:${e.role}`)).toEqual(['Alice:owner', 'Bob:editor']);

    // Bob sees it in his library, opens it and saves
    const list = (await bob.call('GET', '/scores')).data.scores;
    expect(list.find((x: { id: number }) => x.id === duet)).toMatchObject({ role: 'editor', owner: 'Alice' });
    const opened = (await bob.call('GET', `/scores/${duet}`)).data.score;
    expect(opened.role).toBe('editor');
    const saved = await bob.call('PUT', `/scores/${duet}`, { data: { ...opened.data, composer: 'Alice & Bob' }, base_revision: opened.revision });
    expect(saved.status).toBe(200);
    expect((await alice.call('GET', `/scores/${duet}`)).data.score.composer).toBe('Alice & Bob');
    expect((await bob.call('GET', `/scores/${duet}/versions`)).status).toBe(200);

    // but only the owner deletes, shares or manages editors
    expect((await bob.call('PUT', `/scores/${duet}`, { visibility: 'public' })).status).toBe(403);
    expect((await bob.call('DELETE', `/scores/${duet}`)).status).toBe(404);
    expect((await bob.call('POST', `/scores/${duet}/editors`, { email: 'alice@example.com' })).status).toBe(404);
    const bobId = added.data.editors[1].id;
    // Bob leaves; then he no longer has access
    expect((await bob.call('DELETE', `/scores/${duet}/editors/${bobId}`)).status).toBe(200);
    expect((await bob.call('GET', `/scores/${duet}`)).status).toBe(404);
    await alice.call('POST', `/scores/${duet}/editors`, { email: 'bob@example.com' });
    expect((await bob.call('GET', `/scores/${duet}`)).status).toBe(200);
    await alice.call('DELETE', `/scores/${duet}`);
  });

  it('issues signed realtime tickets that the live service accepts', async () => {
    const own = await alice.call('POST', '/scores', { data: newScore({ title: 'Live', measures: 2 }) });
    const live = own.data.score.id;
    await alice.call('POST', `/scores/${live}/editors`, { email: 'bob@example.com' });
    const ta = (await alice.call('POST', `/scores/${live}/realtime`, {})).data;
    const tb = (await bob.call('POST', `/scores/${live}/realtime`, {})).data;
    expect(ta.url).toBe(`ws://localhost:${RT_PORT}`);
    expect(ta.token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect((await visitor.call('POST', `/scores/${live}/realtime`, {})).status).toBe(401);

    // wait for the service, then two people join the same room
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://localhost:${RT_PORT}/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const open = (token: string) =>
      new Promise<{ ws: WebSocket; inbox: Record<string, unknown>[] }>((ok, fail) => {
        const ws = new WebSocket(`${ta.url}?token=${encodeURIComponent(token)}`);
        const inbox: Record<string, unknown>[] = [];
        ws.onmessage = (e) => inbox.push(JSON.parse(String(e.data)));
        ws.onopen = () => ok({ ws, inbox });
        ws.onerror = () => fail(new Error('could not connect'));
      });
    const until = async (inbox: Record<string, unknown>[], t: string) => {
      for (let i = 0; i < 50 && !inbox.some((m) => m.t === t); i++) await new Promise((r) => setTimeout(r, 40));
      return inbox.find((m) => m.t === t)!;
    };
    const a = await open(ta.token);
    const welcomeA = await until(a.inbox, 'welcome');
    expect(welcomeA).toMatchObject({ doc: null, leader: welcomeA.id });
    const doc = (await alice.call('GET', `/scores/${live}`)).data.score.data;
    a.ws.send(JSON.stringify({ t: 'seed', doc }));
    const b = await open(tb.token);
    const welcomeB = await until(b.inbox, 'welcome');
    expect((welcomeB.doc as { title: string }).title).toBe('Live');
    expect(welcomeB.leader).toBe(welcomeA.id);
    expect(await until(a.inbox, 'join')).toMatchObject({ peer: { name: 'Bob' } });

    // a bar edit from Bob reaches Alice (and is confirmed to Bob); a stale one is refused
    const bar = { ...doc.measures[1], rehearsal: 'B' };
    b.ws.send(JSON.stringify({ t: 'op', op: { k: 'bars', n: 2, bars: { 1: bar } } }));
    expect(await until(a.inbox, 'op')).toMatchObject({ seq: 1, from: welcomeB.id, op: { bars: { 1: { rehearsal: 'B' } } } });
    expect(await until(b.inbox, 'op')).toMatchObject({ seq: 1 });
    b.ws.send(JSON.stringify({ t: 'op', op: { k: 'bars', n: 7, bars: { 0: bar } } }));
    expect(await until(b.inbox, 'reject')).toBeTruthy();

    // a forged ticket is turned away
    const forged = ta.token.replace(/\.[\w-]+$/, '.AAAA');
    await expect(open(forged)).rejects.toThrow();
    a.ws.close();
    expect(await until(b.inbox, 'leader')).toMatchObject({ id: welcomeB.id });
    b.ws.close();
    await alice.call('DELETE', `/scores/${live}`);
  });

  it('teaching: classes, assignments, submissions and feedback', async () => {
    const carol = new Client();
    await carol.call('GET', '/auth/me');
    await carol.call('POST', '/auth/register', { name: 'Carol', email: 'carol@example.com', password: 'secret123' });
    // Alice teaches; Bob joins with the code
    const made = await alice.call('POST', '/classes', { name: 'Year 9 music' });
    expect(made.status).toBe(201);
    const cls = made.data.class;
    expect(cls.join_code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await bob.call('POST', '/classes/join', { code: 'NOPE1234' })).status).toBe(404);
    const joined = await bob.call('POST', '/classes/join', { code: cls.join_code.toLowerCase() });
    expect(joined.data.class).toMatchObject({ name: 'Year 9 music', role: 'student', teacher: 'Alice' });
    expect(joined.data.class.join_code).toBeUndefined(); // students do not see the code
    const lists = [await alice.call('GET', '/classes'), await bob.call('GET', '/classes')];
    expect(lists.map((l) => l.data.error ?? l.data.classes.map((c: { role: string }) => c.role).join())).toEqual(['teacher', 'student']);
    expect((await carol.call('GET', `/classes/${cls.id}`)).status).toBe(404);

    // an assignment from one of Alice's scores
    const tmpl = await alice.call('POST', '/scores', { data: newScore({ title: 'Scale task', measures: 2 }) });
    expect((await bob.call('POST', `/classes/${cls.id}/assignments`, { title: 'x', score_id: tmpl.data.score.id })).status).toBe(403);
    const set = await alice.call('POST', `/classes/${cls.id}/assignments`, {
      title: 'Write a C major scale',
      instructions: 'Eighth notes, up and down.',
      due_at: '2030-01-31',
      score_id: tmpl.data.score.id,
      rubric: ['Right notes', 'Neat rhythm', '  '],
    });
    expect(set.status).toBe(201);
    const task = set.data.class.assignments[0];
    expect(task.counts).toEqual({ working: 0, submitted: 0, returned: 0 });
    expect(task.rubric).toEqual(['Right notes', 'Neat rhythm']);

    // Bob starts: his own copy, which Alice can open
    const started = await bob.call('POST', `/assignments/${task.id}/start`, {});
    const sub = started.data.submission;
    expect(sub.status).toBe('working');
    expect((await bob.call('POST', `/assignments/${task.id}/start`, {})).data.submission.id).toBe(sub.id); // once only
    const copy = (await bob.call('GET', `/scores/${sub.score_id}`)).data.score;
    expect(copy).toMatchObject({ title: 'Write a C major scale · Bob', role: 'owner' });
    expect((await alice.call('GET', `/scores/${sub.score_id}`)).data.score.role).toBe('editor');
    const banner = (await bob.call('GET', `/scores/${sub.score_id}/assignment`)).data.assignment;
    expect(banner).toMatchObject({ title: 'Write a C major scale', class: 'Year 9 music', mine: true, submission: { status: 'working' } });
    expect((await bob.call('GET', `/scores/${tmpl.data.score.id}/assignment`)).status).toBe(404); // not his

    // hand in, review, give back
    expect((await bob.call('POST', `/assignments/${task.id}/submit`, {})).data.submission.status).toBe('submitted');
    expect((await bob.call('GET', `/assignments/${task.id}/submissions`)).status).toBe(403);
    const work = (await alice.call('GET', `/assignments/${task.id}/submissions`)).data.submissions;
    expect(work).toEqual([expect.objectContaining({ student: expect.objectContaining({ name: 'Bob' }), status: 'submitted', score_id: sub.score_id })]);
    expect((await bob.call('POST', `/submissions/${sub.id}/return`, { feedback: 'A+' })).status).toBe(404);
    // the calendar: due dates with each side's view
    expect((await bob.call('GET', '/calendar')).data.calendar).toEqual([
      expect.objectContaining({ title: 'Write a C major scale', role: 'student', status: 'submitted', class: 'Year 9 music' }),
    ]);
    expect((await alice.call('GET', '/calendar')).data.calendar[0]).toMatchObject({ role: 'teacher', done: 1, total: 1 });
    const back = await alice.call('POST', `/submissions/${sub.id}/return`, { feedback: 'Lovely, watch bar 2.', grade: ' 9/10 ', marks: [4, 9, 2] });
    expect(back.data.submission).toMatchObject({ status: 'returned', feedback: 'Lovely, watch bar 2.', grade: '9/10', marks: [4, 4] });
    const bobView = (await bob.call('GET', `/classes/${cls.id}`)).data.class;
    expect(bobView.assignments[0].submission).toMatchObject({ status: 'returned', feedback: 'Lovely, watch bar 2.', grade: '9/10' });
    expect((await bob.call('GET', `/scores/${sub.score_id}/assignment`)).data.assignment).toMatchObject({ rubric: ['Right notes', 'Neat rhythm'], submission: { marks: [4, 4] } });
    expect((await alice.call('GET', `/classes/${cls.id}`)).data.class.members.map((m: { name: string }) => m.name)).toEqual(['Bob']);

    // the class goes; Bob keeps his own score
    expect((await bob.call('DELETE', `/classes/${cls.id}`)).status).toBe(403);
    expect((await alice.call('DELETE', `/classes/${cls.id}`)).status).toBe(200);
    expect((await bob.call('GET', `/scores/${sub.score_id}`)).status).toBe(200);
    await bob.call('DELETE', `/scores/${sub.score_id}`);
    await alice.call('DELETE', `/scores/${tmpl.data.score.id}`);
  });

  it('community: profiles, likes, remixes, comments and reports', async () => {
    const pub = await alice.call('POST', '/scores', { data: newScore({ title: 'Nocturne' }) });
    const { id: nid, slug: nslug } = pub.data.score;
    // not shared yet: nothing to like
    expect((await bob.call('POST', `/public/${nslug}/like`, {})).status).toBe(404);
    await alice.call('PUT', `/scores/${nid}`, { visibility: 'public' });

    // likes (signed in only), shown on the page and in lists
    expect((await visitor.call('POST', `/public/${nslug}/like`, {})).status).toBe(401);
    expect((await bob.call('POST', `/public/${nslug}/like`, {})).data).toMatchObject({ liked: true, likes: 1 });
    expect((await bob.call('GET', `/public/${nslug}`)).data.score).toMatchObject({ likes: 1, liked: true, author: 'Alice' });
    expect((await visitor.call('GET', `/public/${nslug}`)).data.score).toMatchObject({ likes: 1, liked: false });
    expect((await visitor.call('GET', `/public/${nslug}`)).data.score.id).toBeUndefined();
    const top = (await visitor.call('GET', '/public?sort=likes')).data.scores[0];
    expect(top).toMatchObject({ title: 'Nocturne', likes: 1 });
    expect((await bob.call('POST', `/public/${nslug}/like`, {})).data).toMatchObject({ liked: false, likes: 0 });

    // profile
    const profile = (await visitor.call('GET', `/people/${top.author_id}`)).data.profile;
    expect(profile.user.name).toBe('Alice');
    expect(profile.scores.map((x: { title: string }) => x.title)).toContain('Nocturne');
    expect((await visitor.call('GET', '/people/99999')).status).toBe(404);

    // remix: a copy in Bob's library that credits the original once shared
    const remix = (await bob.call('POST', `/public/${nslug}/remix`, {})).data.score;
    expect(remix.title).toBe('Nocturne (remix)');
    await bob.call('PUT', `/scores/${remix.id}`, { visibility: 'unlisted' });
    expect((await visitor.call('GET', `/public/${remix.slug}`)).data.score.remix_of).toMatchObject({ slug: nslug, title: 'Nocturne', author: 'Alice' });

    // comments: anyone reads, members post; author or owner deletes
    expect((await visitor.call('POST', `/public/${nslug}/comments`, { text: 'hi' })).status).toBe(401);
    expect((await bob.call('POST', `/public/${nslug}/comments`, { text: '  ' })).status).toBe(422);
    const posted = (await bob.call('POST', `/public/${nslug}/comments`, { text: 'Beautiful bass line!' })).data.comments;
    expect(posted).toEqual([expect.objectContaining({ text: 'Beautiful bass line!', author: expect.objectContaining({ name: 'Bob' }), can_delete: true })]);
    const seen = (await visitor.call('GET', `/public/${nslug}/comments`)).data.comments;
    expect(seen[0].can_delete).toBe(false);
    expect((await alice.call('GET', `/public/${nslug}/comments`)).data.comments[0].can_delete).toBe(true); // the owner

    // three reports hide a comment; a score's reports take it off Explore
    const cid = seen[0].id;
    const reporters = [alice, bob];
    const carol = new Client();
    await carol.call('GET', '/auth/me');
    await carol.call('POST', '/auth/login', { email: 'carol@example.com', password: 'secret123' });
    reporters.push(carol);
    for (const r of reporters) await r.call('POST', `/public/comments/${cid}/report`, {});
    expect((await visitor.call('GET', `/public/${nslug}/comments`)).data.comments).toEqual([]);
    for (const r of reporters) await r.call('POST', `/public/${nslug}/report`, {});
    expect((await visitor.call('GET', '/public')).data.scores.map((x: { title: string }) => x.title)).not.toContain('Nocturne');
    expect((await visitor.call('GET', `/public/${nslug}`)).status).toBe(200); // the link itself still works

    // deleting
    const again = (await bob.call('POST', `/public/${nslug}/comments`, { text: 'Second thought' })).data.comments;
    const mine = again.find((c: { text: string }) => c.text === 'Second thought').id;
    expect((await carol.call('DELETE', `/public/comments/${mine}`)).status).toBe(404);
    expect((await alice.call('DELETE', `/public/comments/${mine}`)).status).toBe(200);
    await bob.call('DELETE', `/scores/${remix.id}`);
    await alice.call('DELETE', `/scores/${nid}`);
  });

  it('notifications for invites, assignments, hand-ins, feedback and comments; admins review reports', async () => {
    // everything earlier in this file left notifications behind: start from a clean slate
    for (const c of [alice, bob]) await c.call('POST', '/notifications/read', {});
    const own = await alice.call('POST', '/scores', { data: newScore({ title: 'Etude' }) });
    const eid = own.data.score.id;
    await alice.call('POST', `/scores/${eid}/editors`, { email: 'bob@example.com' });
    let bobs = (await bob.call('GET', '/notifications')).data;
    expect(bobs.unread).toBe(1);
    expect(bobs.notifications[0]).toMatchObject({ kind: 'invite', text: 'Alice invited you to edit “Etude”', link: `app.html?open=${eid}`, read: false });
    expect(bobs.email).toEqual({ available: true, mode: 'each' }); // the test server has a sender set

    // class flow: new assignment → Bob; handed in → Alice; given back → Bob
    const cls = (await alice.call('POST', '/classes', { name: 'Choir' })).data.class;
    await bob.call('POST', '/classes/join', { code: cls.join_code });
    const task = (await alice.call('POST', `/classes/${cls.id}/assignments`, { title: 'Harmonise', score_id: eid })).data.class.assignments[0];
    const sub = (await bob.call('POST', `/assignments/${task.id}/start`, {})).data.submission;
    await bob.call('POST', `/assignments/${task.id}/submit`, {});
    await alice.call('POST', `/submissions/${sub.id}/return`, { feedback: 'ok' });
    bobs = (await bob.call('GET', '/notifications')).data;
    const unread = bobs.notifications.filter((n: { read: boolean }) => !n.read);
    expect(unread.map((n: { kind: string }) => n.kind)).toEqual(['returned', 'assignment', 'invite']);
    expect(unread[1]).toMatchObject({ text: 'New assignment in Choir: Harmonise', link: `app.html?class=${cls.id}` });
    const alices = (await alice.call('GET', '/notifications')).data.notifications;
    expect(alices[0]).toMatchObject({ kind: 'handed-in', text: 'Bob handed in “Harmonise”' });

    // comments on a shared score tell its owner (not when the owner comments)
    await alice.call('PUT', `/scores/${eid}`, { visibility: 'public' });
    await alice.call('POST', `/public/${own.data.score.slug}/comments`, { text: 'note to self' });
    await bob.call('POST', `/public/${own.data.score.slug}/comments`, { text: 'Nice étude' });
    expect((await alice.call('GET', '/notifications')).data.notifications[0]).toMatchObject({ kind: 'comment', text: 'Bob commented on “Etude”' });

    // read state and the email switch
    await bob.call('POST', '/notifications/read', { ids: [bobs.notifications[0].id] });
    expect((await bob.call('GET', '/notifications')).data.unread).toBe(2);
    await bob.call('POST', '/notifications/read', {});
    expect((await bob.call('GET', '/notifications')).data.unread).toBe(0);
    await bob.call('POST', '/notifications/email', { on: false }); // the older form still works
    expect((await bob.call('GET', '/notifications')).data.email.mode).toBe('off');
    expect((await visitor.call('GET', '/notifications')).status).toBe(401);

    // moderation: only admins; restore, dismiss, remove
    expect((await alice.call('GET', '/auth/me')).data.user.admin).toBe(true);
    expect((await bob.call('GET', '/auth/me')).data.user.admin).toBeUndefined();
    const comment = (await bob.call('GET', `/public/${own.data.score.slug}/comments`)).data.comments.find((c: { text: string }) => c.text === 'Nice étude');
    await bob.call('POST', `/public/comments/${comment.id}/report`, {});
    expect((await bob.call('GET', '/admin/reports')).status).toBe(403);
    const reports = (await alice.call('GET', '/admin/reports')).data.reports;
    expect(reports.find((r: { kind: string; id: number }) => r.kind === 'comment' && r.id === comment.id)).toMatchObject({ reports: 1, hidden: false, text: 'Nice étude', author: 'Bob' });
    await alice.call('POST', `/admin/reports/comment/${comment.id}`, { action: 'dismiss' });
    expect((await alice.call('GET', '/admin/reports')).data.reports.some((r: { id: number; kind: string }) => r.kind === 'comment' && r.id === comment.id)).toBe(false);
    await bob.call('POST', `/public/${own.data.score.slug}/report`, {});
    await alice.call('POST', `/admin/reports/score/${eid}`, { action: 'remove' });
    expect((await visitor.call('GET', `/public/${own.data.score.slug}`)).status).toBe(404); // taken down: private now
    expect((await alice.call('POST', `/admin/reports/score/${eid}`, { action: 'explode' })).status).toBe(422);
    await alice.call('DELETE', `/classes/${cls.id}`);
    await bob.call('DELETE', `/scores/${sub.score_id}`);
    await alice.call('DELETE', `/scores/${eid}`);
  });

  it('emails in each person’s language, one per event or as a daily digest', async () => {
    const mails = () => (existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, 'utf8') : '');
    const before = mails().length;
    // Bob reads French and wants each email
    expect((await bob.call('POST', '/account/language', { lang: 'xx' })).status).toBe(422);
    await bob.call('POST', '/account/language', { lang: 'fr' });
    await bob.call('POST', '/notifications/email', { mode: 'each' });
    const own = (await alice.call('POST', '/scores', { data: newScore({ title: 'Valse' }) })).data.score;
    await alice.call('POST', `/scores/${own.id}/editors`, { email: 'bob@example.com' });
    const fresh = mails().slice(before);
    expect(fresh).toContain('To: bob@example.com');
    expect(fresh).toContain('Alice vous invite à modifier « Valse »');
    expect(fresh).toContain(`Ouvrir: https://music.example.com/app.html?open=${own.id}`);
    // the bell keeps the English text (the editor translates it)
    expect((await bob.call('GET', '/notifications')).data.notifications[0].text).toBe('Alice invited you to edit “Valse”');

    // daily digest: nothing is sent at the time; the cron script sends one summary
    await bob.call('POST', '/notifications/email', { mode: 'daily' });
    const mark = mails().length;
    await alice.call('PUT', `/scores/${own.id}`, { visibility: 'public' });
    await alice.call('POST', `/scores/${own.id}/editors`, { email: 'bob@example.com' }); // already an editor: no new notice
    const cls = (await alice.call('POST', '/classes', { name: 'Solfège' })).data.class;
    await bob.call('POST', '/classes/join', { code: cls.join_code });
    await alice.call('POST', `/classes/${cls.id}/assignments`, { title: 'Gammes', score_id: own.id });
    await bob.call('POST', `/public/${own.slug}/comments`, { text: 'bravo' }); // Bob's own comment: Alice is told, not Bob
    // nothing went to Bob straight away (Alice, on each-event emails, did get the comment notice)
    expect(mails().slice(mark)).not.toContain('To: bob@example.com');
    expect(mails().slice(mark)).toContain('Bob commented on “Valse”');
    const run = spawnSync(php!, [resolve(__dirname, '../../server/cron/digest.php')], {
      env: { ...process.env, ...dbEnv(), PIANISSIMO_MAIL_FROM: 'music@example.com', PIANISSIMO_MAIL_LOG: MAIL_LOG, PIANISSIMO_SITE_URL: 'https://music.example.com/' },
      encoding: 'utf8',
    });
    expect(run.stdout).toMatch(/digest\(s\) sent/);
    const digest = mails().slice(mark).split('-----').find((m) => m.includes('To: bob@example.com'))!;
    expect(digest).toContain('Subject: Pianissimo: 1 nouvelle notification');
    expect(digest).toContain('Nouveau devoir dans Solfège : Gammes');
    // a second run the same day has nothing new
    const again = mails().length;
    spawnSync(php!, [resolve(__dirname, '../../server/cron/digest.php')], {
      env: { ...process.env, ...dbEnv(), PIANISSIMO_MAIL_FROM: 'music@example.com', PIANISSIMO_MAIL_LOG: MAIL_LOG },
    });
    expect(mails().length).toBe(again);
    await bob.call('POST', '/notifications/email', { mode: 'off' });
    await bob.call('POST', '/account/language', { lang: 'en' });
    await alice.call('DELETE', `/classes/${cls.id}`);
    await alice.call('DELETE', `/scores/${own.id}`);
  });

  it('scans sheet music with the engine on the server, checking the upload', async () => {
    expect((await visitor.call('GET', '/omr')).data.available).toBe(true);
    // a 1×1 PNG (any image will do: the stand-in engine always "recognises" C D E F)
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const upload = async (who: Client, bytes: Uint8Array, name: string, type: string) => {
      const form = new FormData();
      form.append('file', new Blob([bytes as BlobPart], { type }), name);
      const res = await fetch(`${BASE}/omr`, { method: 'POST', headers: { Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: form });
      const data = await res.json();
      if (data.csrf) who.csrf = data.csrf;
      return { status: res.status, data };
    };
    await alice.call('GET', '/auth/me');
    const ok = await upload(alice, png, 'page.png', 'image/png');
    expect(ok.status).toBe(200);
    expect(ok.data.result.format).toBe('musicxml');
    const xml = atob(ok.data.result.data);
    expect(xml).toContain('<work-title>Scanned page</work-title>');
    // the content decides, not the name: a text file called .png is refused
    expect((await upload(alice, new TextEncoder().encode('not music'), 'fake.png', 'image/png')).status).toBe(415);
    await visitor.call('GET', '/auth/me');
    expect((await upload(visitor, png, 'page.png', 'image/png')).status).toBe(401);
  });

  it('people can download their data and delete their account', async () => {
    const dave = new Client();
    await dave.call('GET', '/auth/me');
    await dave.call('POST', '/auth/register', { name: 'Dave', email: 'dave@example.com', password: 'secret123' });
    const mine = (await dave.call('POST', '/scores', { data: newScore({ title: 'Dave tune' }) })).data.score;
    await dave.call('PUT', `/scores/${mine.id}`, { visibility: 'public' });
    await bob.call('POST', `/public/${mine.slug}/like`, {});
    await dave.call('POST', `/public/${mine.slug}/comments`, { text: 'my own note' });

    const exp = (await dave.call('GET', '/account/export')).data.data;
    expect(exp.account).toMatchObject({ name: 'Dave', email: 'dave@example.com' });
    expect(exp.account.password_hash).toBeUndefined(); // never handed out
    expect(exp.scores[0]).toMatchObject({ title: 'Dave tune', data: expect.objectContaining({ title: 'Dave tune' }) });
    expect(exp.comments[0].text).toBe('my own note');
    expect((await visitor.call('GET', '/account/export')).status).toBe(401);

    expect((await dave.call('POST', '/account/delete', { password: 'wrong-one' })).status).toBe(403);
    expect((await dave.call('POST', '/account/delete', { password: 'secret123' })).status).toBe(200);
    expect((await dave.call('GET', '/auth/me')).data.user).toBeNull();
    expect((await dave.call('POST', '/auth/login', { email: 'dave@example.com', password: 'secret123' })).status).toBe(401);
    // everything went with it: the shared score, its likes and the comment
    expect((await visitor.call('GET', `/public/${mine.slug}`)).status).toBe(404);
  });

  it('confirms the email, resets a forgotten password and changes it; other devices are signed out', async () => {
    const mails = () => (existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, 'utf8') : '');
    const lastLink = (to: string, kind: 'reset' | 'verify') => {
      const mail = mails().split('-----').filter((m) => m.includes(`To: ${to}`) && m.includes(`#${kind}=`)).pop();
      return mail?.match(new RegExp(`(https://\\S+)#${kind}=([0-9a-f]{64})`)) ?? null;
    };
    const erin = new Client();
    const phone = new Client(); // Erin's second device
    await erin.call('GET', '/auth/me');
    const me = (await erin.call('POST', '/auth/register', { name: 'Erin', email: 'erin@example.com', password: 'first-pass' })).data.user;
    expect(me.verified).toBe(false);
    expect((await erin.call('GET', '/auth/me')).data.mail).toBe(true);

    // a confirmation link came with the new account; it works once
    const v = lastLink('erin@example.com', 'verify')!;
    expect(v[1]).toBe('https://music.example.com/app.html');
    expect((await visitor.call('POST', '/auth/verify', { token: 'f'.repeat(64) })).status).toBe(400);
    expect((await visitor.call('POST', '/auth/verify', { token: v[2] })).status).toBe(200);
    expect((await erin.call('GET', '/auth/me')).data.user.verified).toBe(true);
    expect((await visitor.call('POST', '/auth/verify', { token: v[2] })).status).toBe(400);
    expect((await erin.call('POST', '/account/verify', {})).data.sent).toBe(false); // nothing left to confirm

    await phone.call('GET', '/auth/me');
    await phone.call('POST', '/auth/login', { email: 'erin@example.com', password: 'first-pass' });
    expect((await phone.call('GET', '/auth/me')).data.user.name).toBe('Erin');

    // forgot: the same answer whether or not the address has an account
    const before = mails().length;
    expect((await visitor.call('POST', '/auth/forgot', { email: 'nobody-here@example.com' })).status).toBe(200);
    expect(mails().length).toBe(before);
    expect((await visitor.call('POST', '/auth/forgot', { email: 'ERIN@example.com' })).status).toBe(200);
    const r = lastLink('erin@example.com', 'reset')!;
    expect(mails().slice(before)).toContain('Subject: Choose a new Pianissimo password');

    const reset = new Client();
    await reset.call('GET', '/auth/me');
    expect((await reset.call('POST', '/auth/reset', { token: r[2], password: 'short' })).status).toBe(422);
    expect((await reset.call('POST', '/auth/reset', { token: 'nope', password: 'second-pass' })).status).toBe(400);
    const done = await reset.call('POST', '/auth/reset', { token: r[2], password: 'second-pass' });
    expect(done.status).toBe(200);
    expect(done.data.user.name).toBe('Erin'); // signed in on this device
    expect((await reset.call('POST', '/auth/reset', { token: r[2], password: 'third-pass' })).status).toBe(400); // used up
    // both older sessions ended
    expect((await erin.call('GET', '/auth/me')).data.user).toBeNull();
    expect((await phone.call('GET', '/scores')).status).toBe(401);
    expect((await erin.call('POST', '/auth/login', { email: 'erin@example.com', password: 'first-pass' })).status).toBe(401);

    // change the password while signed in: needs the current one, keeps this session
    expect((await reset.call('POST', '/account/password', { current: 'wrong-one', password: 'third-pass' })).status).toBe(403);
    expect((await reset.call('POST', '/account/password', { current: 'second-pass', password: 'third-pass' })).status).toBe(200);
    expect((await reset.call('GET', '/auth/me')).data.user.name).toBe('Erin');
    expect((await erin.call('POST', '/auth/login', { email: 'erin@example.com', password: 'third-pass' })).status).toBe(200);
    expect((await visitor.call('POST', '/account/password', { current: 'x', password: 'yyyyyyyy' })).status).toBe(401);
  });

  it('collects error reports, grouped and without personal details, for admins only', async () => {
    const crash = (message: string, stack: string) =>
      visitor.call('POST', '/errors', { message, stack, page: 'app.html?x=1#reset=abc', version: '0.3.0' });
    expect((await crash('TypeError: score is undefined (bar 12)', 'at render (assets/renderer-a1.js:10:5)')).status).toBe(200);
    expect((await crash('TypeError: score is undefined (bar 31)', 'at render (assets/renderer-a1.js:10:5)')).status).toBe(200); // same error
    await crash('Error: mail for erin@example.com failed', 'at send (assets/app-b2.js:3:1)\n  token 0123456789abcdef0123456789abcdef');
    expect((await visitor.call('POST', '/errors', { message: '' })).status).toBe(422);

    expect((await visitor.call('GET', '/admin/errors')).status).toBe(401);
    expect((await bob.call('GET', '/admin/errors')).status).toBe(403);
    const { errors } = (await alice.call('GET', '/admin/errors')).data;
    const render = errors.find((e: { message: string }) => e.message.startsWith('TypeError: score'));
    expect(render).toMatchObject({ source: 'client', count: 2, page: 'app.html', version: '0.3.0' });
    const mail = errors.find((e: { message: string }) => e.message.includes('mail for'));
    expect(mail.message).toBe('Error: mail for <email> failed');
    expect(mail.stack).toContain('<token>');

    expect((await alice.call('DELETE', `/admin/errors/${render.id}`)).status).toBe(200);
    expect((await alice.call('GET', '/admin/errors')).data.errors.some((e: { id: number }) => e.id === render.id)).toBe(false);
    expect((await alice.call('DELETE', '/admin/errors')).status).toBe(200);
    expect((await alice.call('GET', '/admin/errors')).data.errors).toHaveLength(0);
  });

  it('backs up the database and restores it into an empty one (also how a site moves to MySQL)', () => {
    const cron = (script: string, args: string[], env: Record<string, string>) =>
      spawnSync(php!, [resolve(__dirname, `../../server/cron/${script}`), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
    const backups = join(dir, 'backups');
    const made = cron('backup.php', [`--dir=${backups}`, '--keep=2'], dbEnv());
    expect(made.stdout).toMatch(/backed up \d+ accounts, \d+ scores/);
    const file = join(backups, readdirSync(backups)[0]);

    // into a fresh SQLite database
    const copy = { PIANISSIMO_DB: join(dir, 'restored.sqlite') };
    const restored = cron('restore.php', [file], copy);
    expect(restored.status).toBe(0);
    const [, users, scores] = /restored (\d+) accounts, (\d+) scores/.exec(restored.stdout)!;
    expect(Number(users)).toBeGreaterThan(3);
    expect(Number(scores)).toBeGreaterThan(0);
    // the copy holds the same rows: a backup of it matches line for line
    const again = cron('backup.php', [`--dir=${join(dir, 'backups2')}`], copy);
    expect(again.stdout).toContain(`backed up ${users} accounts, ${scores} scores`);
    // a database that has accounts is not overwritten by accident
    const refused = cron('restore.php', [file], copy);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('already has accounts');
    expect(cron('restore.php', [file, '--replace'], copy).status).toBe(0);
    // old backups beyond --keep are removed
    cron('backup.php', [`--dir=${backups}`, '--keep=2'], dbEnv());
    cron('backup.php', [`--dir=${backups}`, '--keep=2'], dbEnv());
    expect(readdirSync(backups).filter((f) => f.endsWith('.jsonl.gz')).length).toBeLessThanOrEqual(2);
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
    // counted per account: someone else at the same address (a classroom) still gets in
    const classmate = new Client();
    await classmate.call('GET', '/auth/me');
    expect((await classmate.call('POST', '/auth/login', { email: 'bob@example.com', password: 'secret123' })).status).toBe(200);
  });
});
