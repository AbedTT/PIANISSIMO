// End-to-end browser tests with no extra dependencies: drives headless Chrome over the
// Chrome DevTools Protocol (Node's built-in WebSocket) against the production build.
//
//   npm run build && npm run e2e
//
// Starts `vite preview` and, when PHP is available, a throw-away PHP API (SQLite in a temp
// folder). Set CHROME_PATH if Chrome or Chromium is not found automatically.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_PORT = Number(process.env.E2E_PORT ?? 4180);
const API_PORT = Number(process.env.API_PORT ?? 8010);
const RT_PORT = Number(process.env.E2E_REALTIME_PORT ?? 8011);
const RT_SECRET = `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const ADMIN_EMAIL = `admin-${Date.now()}@example.com`;
const BASE = `http://localhost:${WEB_PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'pianissimo-e2e-'));
const MAIL_LOG = join(tmp, 'mail.log');
/** The last link of this kind emailed to this address. */
const emailedLink = (to, kind) => {
  const log = existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, 'utf8') : '';
  const mail = log.split('-----').filter((m) => m.includes(`To: ${to}`) && m.includes(`#${kind}=`)).pop();
  return mail?.match(new RegExp(`https?://\\S+#${kind}=[0-9a-f]{64}`))?.[0] ?? null;
};
const children = [];

// ------------------------------------------------------------------ processes
const which = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' }).stdout?.split(/\r?\n/)[0]?.trim();
function findChrome() {
  const paths = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return paths.find((p) => p && existsSync(p)) ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(which).find(Boolean);
}
function findPhp() {
  return [process.env.PHP_BINARY, 'php', 'C:/xampp/php/php.exe'].find((c) => c && (existsSync(c) || spawnSync(c, ['-v']).status === 0));
}

async function waitForDown(url, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${url} is still up`);
}

async function waitForHttp(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${url} did not come up`);
}

function cleanup() {
  for (const c of children) c.kill();
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows may hold a file briefly */
  }
}

/**
 * A WAV file Chrome plays as its (fake) microphone: a voice-like C5 for 1 s, then 0.5 s of
 * silence, looping. Used by the tuner and microphone-recording tests.
 */
function fakeMicWav(path) {
  const rate = 44100;
  const n = Math.round(rate * 1.5);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    if (t < 1) {
      const env = Math.min(1, t / 0.02, (1 - t) / 0.02);
      [1, 0.5, 0.25].forEach((a, k) => (v += a * Math.sin(2 * Math.PI * 523.25 * (k + 1) * t)));
      v *= 0.25 * env;
    }
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([head, data]));
  return path;
}

// ------------------------------------------------------------------ a tiny CDP client
class Browser {
  static async launch(path) {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${join(tmp, 'chrome')}`,
      '--window-size=1280,900',
      '--lang=en-US',
      // a WAV file instead of a real microphone, and no permission prompt
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeMicWav(join(tmp, 'mic.wav'))}`,
      '--autoplay-policy=no-user-gesture-required',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ];
    const proc = spawn(path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(proc);
    const wsUrl = await new Promise((ok, fail) => {
      let err = '';
      const timer = setTimeout(() => fail(new Error(`Chrome did not start:\n${err}`)), 20000);
      proc.stderr.on('data', (d) => {
        err += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
        if (m) {
          clearTimeout(timer);
          ok(m[1]);
        }
      });
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, fail) => {
      ws.onopen = ok;
      ws.onerror = fail;
    });
    return new Browser(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      const p = msg.id && this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.fail(new Error(`${p.method}: ${msg.error.message}`));
        else p.ok(msg.result);
      } else for (const l of this.listeners) l(msg);
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail, method }));
  }

  once(method, sessionId, ms = 20000) {
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        this.listeners.delete(l);
        fail(new Error(`timed out waiting for ${method}`));
      }, ms);
      const l = (msg) => {
        if (msg.method === method && msg.sessionId === sessionId) {
          clearTimeout(timer);
          this.listeners.delete(l);
          ok(msg.params);
        }
      };
      this.listeners.add(l);
    });
  }

  async newPage() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable'); // Content-Security-Policy violations arrive as log entries
    return page;
  }

  close() {
    return this.send('Browser.close').catch(() => {});
  }
}

const KEYS = {
  Space: [' ', 32],
  Enter: ['Enter', 13],
  Escape: ['Escape', 27],
  Backspace: ['Backspace', 8],
  Delete: ['Delete', 46],
  ArrowLeft: ['ArrowLeft', 37],
  ArrowRight: ['ArrowRight', 39],
  ArrowUp: ['ArrowUp', 38],
  ArrowDown: ['ArrowDown', 40],
  Slash: ['/', 191],
  Home: ['Home', 36],
  End: ['End', 35],
};

class Page {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.errors = [];
    /** Text typed into the next prompt() (confirm() and alert() are accepted). */
    this.promptText = '';
    browser.listeners.add((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Page.javascriptDialogOpening') {
        void browser.send('Page.handleJavaScriptDialog', { accept: true, promptText: this.promptText }, sessionId);
      }
      if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      // anything the security policy blocked is a failure: the page would be broken in production
      if (msg.method === 'Log.entryAdded' && /Content Security Policy/i.test(msg.params.entry.text)) this.errors.push(msg.params.entry.text);
    });
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  async goto(path) {
    const loaded = this.browser.once('Page.loadEventFired', this.sessionId);
    await this.send('Page.navigate', { url: BASE + path });
    await loaded;
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async waitFor(expression, what = expression, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
      const v = await this.eval(expression).catch(() => undefined);
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Press a key like "C", "3", "Space", "Ctrl+Z", "Ctrl+Shift+KeyP". */
  async press(combo) {
    const parts = combo.split('+');
    const name = parts.pop();
    const mods = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };
    const modifiers = parts.reduce((m, p) => m | mods[p], 0);
    let key;
    let code;
    let keyCode;
    if (KEYS[name]) {
      [key, keyCode] = KEYS[name];
      code = name;
    } else if (/^[A-Za-z]$/.test(name) || /^Key[A-Z]$/.test(name)) {
      const ch = name.slice(-1);
      key = modifiers & 8 ? ch.toUpperCase() : ch.toLowerCase();
      code = `Key${ch.toUpperCase()}`;
      keyCode = ch.toUpperCase().charCodeAt(0);
    } else if (/^\d$/.test(name)) {
      key = name;
      code = `Digit${name}`;
      keyCode = name.charCodeAt(0);
    } else throw new Error(`unknown key ${name}`);
    const text = !(modifiers & 3) && key.length === 1 ? key : undefined;
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, modifiers, windowsVirtualKeyCode: keyCode, text });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: keyCode });
  }

  async typeText(text) {
    await this.send('Input.insertText', { text });
  }

  /** Wait for two animation frames (the editor batches redraws per frame). */
  frames() {
    return this.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  }

  close() {
    return this.browser.send('Target.closeTarget', { targetId: this.targetId });
  }
}

// ------------------------------------------------------------------ tests
const tests = [];
const test = (name, fn, opts = {}) => tests.push({ name, fn, ...opts });
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Pitched notes in the editor's score (read from its autosave, which is written on every change). */
const noteheads = `JSON.parse(localStorage.getItem('pianissimo:autosave')).measures.flatMap((m) => m.staves.flat()).filter((e) => e.pitches.length).length`;
/** Wait until fonts are in and the redraw that follows has happened. */
const settled = async (page) => {
  await page.eval('document.fonts.ready.then(() => true)');
  await page.frames();
};

test('website: home page shows the live demo and switches language', async (page) => {
  await page.goto('/index.html');
  await page.waitFor(`document.querySelector('#demoScore svg .vf-notehead')`, 'demo score drawn');
  await page.eval(`(() => { const s = document.getElementById('siteLang'); s.value = 'fr'; s.dispatchEvent(new Event('change')); })()`);
  const h1 = await page.eval(`document.querySelector('h1').textContent`);
  assert(h1.includes('Écrivez'), `French heading expected, got "${h1}"`);
  assert((await page.eval(`document.documentElement.lang`)) === 'fr', 'html lang should be fr');
  await page.eval(`(() => { const s = document.getElementById('siteLang'); s.value = 'en'; s.dispatchEvent(new Event('change')); })()`);
  assert((await page.eval(`document.querySelector('h1').textContent`)).startsWith('Write sheet music'), 'back to English');
});

test('website: the guide lists shortcuts generated from the editor', async (page) => {
  await page.goto('/guide.html');
  const rows = await page.waitFor(`document.querySelectorAll('#shortcutTables tr').length > 40 && document.querySelectorAll('#shortcutTables tr').length`, 'shortcut tables');
  assert(rows > 40, `expected many shortcut rows, got ${rows}`);
});

test('editor: type notes, change length, undo and redo', async (page) => {
  await page.goto('/app.html?template=blank-piano');
  await page.waitFor(`document.querySelector('#score svg .vf-stave')`, 'score drawn');
  await settled(page);
  assert((await page.eval(noteheads)) === 0, 'a blank score has no notes');
  for (const k of ['C', 'D', 'E', 'F']) await page.press(k);
  await page.frames();
  assert((await page.eval(noteheads)) === 4, `4 notes after typing C D E F, got ${await page.eval(noteheads)}`);
  await page.press('Ctrl+Z');
  await page.frames();
  assert((await page.eval(noteheads)) === 3, 'undo removes the last note');
  await page.press('Ctrl+Y');
  await page.frames();
  assert((await page.eval(noteheads)) === 4, 'redo brings it back');
  await page.press('ArrowLeft');
  await page.frames();
  const status = await page.eval(`document.getElementById('status').textContent.replace(/\\s+/g, ' ')`);
  assert(/At cursor F\d/.test(status), `status bar should show the F under the cursor: "${status}"`);
});

test('editor: an edit redraws only the system it touches', async (page) => {
  await page.goto('/app.html?template=waltz');
  await page.waitFor(`document.querySelectorAll('#score g.vf-system').length > 1`, 'several systems');
  await settled(page);
  await page.eval(`(() => { const g = [...document.querySelectorAll('#score g.vf-system')]; g.forEach((x, k) => (x.dataset.mark = k)); return g.length; })()`);
  // the cursor starts on the first note of bar 1; moving its pitch keeps the rhythm, so no bar moves to another line
  await page.press('ArrowUp');
  await page.frames();
  const marks = await page.eval(`[...document.querySelectorAll('#score g.vf-system')].map((g) => g.dataset.mark ?? 'new')`);
  assert(marks[0] === 'new', `the first system is redrawn (${marks})`);
  assert(marks.slice(1).every((m, k) => m === String(k + 1)), `the other systems are reused (${marks})`);
});

test('editor: command search and the German shortcut sheet', async (page) => {
  await page.goto('/app.html?template=blank-piano');
  await page.waitFor(`document.querySelector('#score svg')`);
  await page.press('Ctrl+Shift+P');
  await page.waitFor(`!document.getElementById('searchModal').hidden`, 'search opens');
  await page.typeText('tie');
  await page.eval(`document.getElementById('searchInput').dispatchEvent(new Event('input'))`);
  const hits = await page.eval(`document.getElementById('searchList').textContent`);
  assert(hits.includes('Tie to next note'), `search should find "Tie to next note": ${hits.slice(0, 120)}`);
  await page.press('Escape');
  await page.eval(`(() => { const s = document.getElementById('langSelect'); s.value = 'de'; s.dispatchEvent(new Event('change')); })()`);
  await page.eval(`document.getElementById('score').focus()`);
  await page.press('Shift+Slash');
  await page.waitFor(`!document.getElementById('helpModal').hidden`, 'shortcut sheet opens');
  const help = await page.eval(`document.getElementById('helpGrid').textContent`);
  assert(help.includes('Rückgängig') && help.includes('Noten schreiben'), 'shortcut sheet in German');
  await page.eval(`(() => { const s = document.getElementById('langSelect'); s.value = 'en'; s.dispatchEvent(new Event('change')); })()`);
});

test(
  'cloud: sign up, share publicly, open the link signed out and find it on Explore',
  async (page, browser) => {
    await page.goto('/app.html?template=lead-sheet');
    await page.waitFor(`document.querySelector('#score svg')`);
    const title = `E2E song ${Date.now()}`;
    await page.eval(`(() => { const t = document.getElementById('title'); t.value = ${JSON.stringify(title)}; t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change')); })()`);
    await page.eval(`document.querySelector('[data-cmd=share]').click()`);
    await page.waitFor(`!document.getElementById('authModal').hidden`, 'sign-in dialog');
    await page.eval(`document.querySelector('[data-auth=register]').click()`);
    await page.eval(`(() => {
      const f = document.getElementById('authForm');
      f.elements.name.value = 'E2E Tester';
      f.elements.email.value = 'e2e-${Date.now()}@example.com';
      f.elements.password.value = 'correct horse battery';
      f.requestSubmit();
    })()`);
    await page.waitFor(`!document.getElementById('shareModal').hidden`, 'share dialog after sign-up');
    await page.eval(`document.querySelector('#shareModal input[value=public]').click()`);
    const link = await page.waitFor(`!document.getElementById('shareLinkRow').hidden && document.getElementById('shareLink').value`, 'share link');
    assert(link.includes('view.html?s='), `share link: ${link}`);
    const embed = await page.eval(`document.getElementById('shareEmbed').value`);
    assert(embed.startsWith('<iframe') && embed.includes('embed.html?s='), `embed code: ${embed}`);

    // a visitor who is not signed in: a separate browser context has no cookies
    const { browserContextId } = await browser.send('Target.createBrowserContext');
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const visitor = new Page(browser, sessionId, targetId);
    await visitor.send('Page.enable');
    await visitor.send('Runtime.enable');
    await visitor.goto(link.slice(link.indexOf('/view.html')));
    await visitor.waitFor(`document.querySelector('svg .vf-notehead')`, 'shared score drawn for a visitor');
    const shown = await visitor.eval(`document.body.textContent`);
    assert(shown.includes(title), 'the viewer shows the title');
    await visitor.goto('/explore.html');
    await visitor.waitFor(`document.getElementById('exploreGallery').textContent.includes(${JSON.stringify(title)})`, 'listed on Explore');

    // the embed code works inside another page
    await visitor.goto('/about.html');
    await visitor.eval(`(() => { const d = document.createElement('div'); d.innerHTML = ${JSON.stringify(embed)}; document.body.append(d); return true; })()`);
    await visitor.waitFor(
      `(() => { const doc = document.querySelector('iframe')?.contentDocument; return !!doc?.querySelector('svg .vf-notehead') && doc.getElementById('eTitle').textContent; })()`,
      'embedded player drawn',
    );
    const embedTitle = await visitor.eval(`document.querySelector('iframe').contentDocument.getElementById('eTitle').textContent`);
    assert(embedTitle === title, `embedded title: ${embedTitle}`);
    assert(!(await visitor.eval(`document.querySelector('iframe').contentDocument.getElementById('ePlay').disabled`)), 'play button enabled');
    await browser.send('Target.disposeBrowserContext', { browserContextId });
  },
  { needsApi: true },
);

/** Call the API from inside a page (its cookies, with the CSRF token). */
const apiIn = (page, method, path, body) =>
  page.eval(`(async () => {
    const base = '/server/api/index.php';
    const me = await (await fetch(base + '/auth/me')).json();
    const res = await fetch(base + ${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf },
      body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
    });
    return { status: res.status, data: await res.json() };
  })()`);

async function contextPage(browser) {
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const p = new Page(browser, sessionId, targetId);
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  return { page: p, dispose: () => browser.send('Target.disposeBrowserContext', { browserContextId }) };
}

test(
  'live: two people edit the same score at once and see each other',
  async (alice, browser) => {
    const stamp = Date.now();
    const bobCtx = await contextPage(browser);
    const bob = bobCtx.page;
    try {
      // accounts: Alice owns a score and invites Bob
      await alice.goto('/app.html?template=blank-piano');
      await alice.waitFor(`document.querySelector('#score svg')`);
      assert((await apiIn(alice, 'POST', '/auth/register', { name: 'Alice', email: `alice-${stamp}@example.com`, password: 'correct horse battery' })).status === 201, 'Alice signs up');
      await bob.goto('/index.html');
      assert((await apiIn(bob, 'POST', '/auth/register', { name: 'Bob', email: `bob-${stamp}@example.com`, password: 'correct horse battery' })).status === 201, 'Bob signs up');
      const data = await alice.eval(`JSON.parse(localStorage.getItem('pianissimo:autosave'))`);
      data.title = `Duet ${stamp}`;
      const created = await apiIn(alice, 'POST', '/scores', { data });
      const id = created.data.score.id;
      const invited = await apiIn(alice, 'POST', `/scores/${id}/editors`, { email: `bob-${stamp}@example.com` });
      assert(invited.status === 200, `invite: ${JSON.stringify(invited.data)}`);

      // both open it from their library (the editor reconnects to the library copy on load)
      for (const p of [alice, bob]) {
        // as after opening it from the library: the editor holds the saved score and is linked to it
        await p.eval(`localStorage.setItem('pianissimo:cloudId', '${id}'); localStorage.setItem('pianissimo:autosave', ${JSON.stringify(JSON.stringify(created.data.score.data ?? data))}); true`);
        await p.goto('/app.html');
        await p.waitFor(`document.querySelector('#score svg')`);
      }
      for (const p of [alice, bob]) {
        await p.waitFor(`!document.getElementById('liveStatus').hidden && document.querySelectorAll('#liveStatus .peer-chip').length === 1`, 'both see one other person live');
      }
      const status = await bob.eval(`document.getElementById('cloudStatus').textContent`);

      // Alice types; Bob sees the notes without reloading
      await alice.eval(`document.getElementById('score').focus()`);
      for (const k of ['C', 'D', 'E']) await alice.press(k);
      await bob.waitFor(`${noteheads} === 3`, "Alice's notes appear for Bob");
      // Bob writes in bar 2 at the same time as Alice adds a note in bar 1
      await bob.eval(`document.getElementById('score').focus()`);
      await bob.press('Ctrl+ArrowRight');
      await bob.press('G');
      await alice.press('F');
      await alice.waitFor(`${noteheads} === 5`, 'both edits reach Alice');
      await bob.waitFor(`${noteheads} === 5`, 'both edits reach Bob');
      assert(
        (await alice.eval(`localStorage.getItem('pianissimo:autosave')`)) === (await bob.eval(`localStorage.getItem('pianissimo:autosave')`)),
        'the two copies are identical',
      );
      // Alice sees where Bob is
      await alice.waitFor(`document.querySelector('.peer-cursor span')?.textContent === 'Bob'`, "Bob's cursor shown to Alice");
      // the leader (Alice, first in) saves; the library ends up with all five notes
      await alice.waitFor(`document.getElementById('cloudStatus').textContent.includes('Saved')`, 'Alice saved', 15000);
      const saved = await apiIn(bob, 'GET', `/scores/${id}`);
      const pitched = saved.data.score.data.measures.flatMap((m) => m.staves.flat()).filter((e) => e.pitches.length).length;
      assert(pitched === 5, `library copy has the 5 notes (${pitched}); Bob's status was "${status}"`);
      // undo is personal: Alice's undo removes her F, not Bob's G
      await alice.press('Ctrl+Z');
      await bob.waitFor(`${noteheads} === 4`, "Alice's undo reaches Bob");
      const bobBar2 = await bob.eval(`JSON.parse(localStorage.getItem('pianissimo:autosave')).measures[1].staves[0].filter((e) => e.pitches.length).length`);
      assert(bobBar2 === 1, "Bob's note in bar 2 is still there");
    } finally {
      await bob.close().catch(() => {});
      await bobCtx.dispose();
    }
  },
  { needsApi: true },
);

test(
  'teaching: a class, an assignment, a student hands in and gets feedback',
  async (teacher, browser) => {
    const stamp = Date.now();
    const studentCtx = await contextPage(browser);
    const student = studentCtx.page;
    const visible = (id) => `!document.getElementById('${id}')?.hidden`;
    try {
      await teacher.goto('/index.html');
      assert((await apiIn(teacher, 'POST', '/auth/register', { name: 'Ms Lee', email: `lee-${stamp}@example.com`, password: 'correct horse battery' })).status === 201, 'teacher signs up');
      await student.goto('/index.html');
      assert((await apiIn(student, 'POST', '/auth/register', { name: 'Sam', email: `sam-${stamp}@example.com`, password: 'correct horse battery' })).status === 201, 'student signs up');

      // the teacher creates a class and sets the score she is editing as an assignment
      await teacher.goto('/app.html?template=scale');
      await teacher.waitFor(`document.querySelector('#score svg') && !document.getElementById('accountMenu').hidden`, 'teacher signed in');
      await teacher.eval(`document.getElementById('score').focus()`);
      await teacher.press('Ctrl+Alt+J');
      await teacher.waitFor(`document.querySelector('#classCreate')`, 'classes dialog');
      await teacher.eval(`(() => { const f = document.getElementById('classCreate'); f.elements.name.value = 'Theory ${stamp}'; f.requestSubmit(); })()`);
      await teacher.waitFor(`document.querySelector('#assignForm')`, 'class page');
      await teacher.eval(`document.querySelector('#assignForm').elements.due.value = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)`);
      const link = await teacher.waitFor(`document.querySelector('.join-box input')?.value`, 'join link');
      await teacher.eval(`(() => { const f = document.getElementById('assignForm'); f.elements.instructions.value = 'Add the missing notes.'; f.elements.rubric.value = 'Right notes\\nNeat rhythm'; f.requestSubmit(); })()`);
      await teacher.waitFor(`document.querySelector('.assignment-list')?.textContent.includes('C major scale')`, 'assignment listed');

      // the student follows the link, starts, writes something and hands it in
      await student.goto(link.slice(link.indexOf('/app.html')));
      await student.waitFor(`document.querySelector('.assignment [data-act=start]')`, 'student sees the assignment');
      await student.eval(`document.querySelector('.assignment [data-act=start]').click()`);
      await student.waitFor(`${visible('assignmentBanner')} && document.getElementById('assignmentBanner').textContent.includes('Add the missing notes.')`, 'banner over the copy');
      await student.eval(`document.getElementById('score').focus()`);
      await student.press('End');
      await student.press('G');
      await student.eval(`document.querySelector('#assignmentBanner [data-act=handin]').click()`);
      await student.waitFor(`document.getElementById('assignmentBanner').textContent.includes('handed in')`, 'handed in', 30000);

      // the teacher sees it and gives it back with feedback
      await teacher.eval(`document.querySelector('[data-act=work]').click()`);
      await teacher.waitFor(`document.querySelector('.work-table')?.textContent.includes('handed in')`, 'work shows as handed in');
      await teacher.eval(`document.querySelector('[data-return]').click()`);
      await teacher.eval(`(() => {
        const f = document.querySelector('.giveback-form');
        f.elements.feedback.value = 'Great scale, Sam!';
        f.elements.grade.value = '9/10';
        f.elements.mark0.value = '4';
        f.requestSubmit();
      })()`);
      await teacher.waitFor(`document.querySelector('.work-table')?.textContent.includes('returned')`, 'given back');

      // the student sees the feedback on the copy
      await student.goto('/app.html');
      await student.waitFor(`document.getElementById('assignmentBanner').textContent.includes('Great scale, Sam!')`, 'feedback on the banner');
      const result = await student.eval(`document.getElementById('assignmentBanner').textContent.replace(/\\s+/g, ' ')`);
      assert(result.includes('Grade: 9/10') && result.includes('Right notes: 4/4'), `grade and marks on the banner: ${result}`);
      // the agenda lists the due date
      await student.eval(`document.getElementById('score').focus()`);
      await student.press('Ctrl+Alt+J');
      await student.waitFor(`document.querySelector('.agenda-item')?.textContent.includes('C major scale')`, 'due date in the agenda');
    } finally {
      await student.close().catch(() => {});
      await studentCtx.dispose();
    }
  },
  { needsApi: true },
);

test(
  'community: like, comment, profile, Explore by likes and remix into the editor',
  async (alice, browser) => {
    const stamp = Date.now();
    const bobCtx = await contextPage(browser);
    const bob = bobCtx.page;
    try {
      await alice.goto('/app.html?template=waltz');
      await alice.waitFor(`document.querySelector('#score svg')`);
      await apiIn(alice, 'POST', '/auth/register', { name: `Alice ${stamp}`, email: `alice-c-${stamp}@example.com`, password: 'correct horse battery' });
      const data = await alice.eval(`JSON.parse(localStorage.getItem('pianissimo:autosave'))`);
      data.title = `Waltz ${stamp}`;
      const created = (await apiIn(alice, 'POST', '/scores', { data })).data.score;
      await apiIn(alice, 'PUT', `/scores/${created.id}`, { visibility: 'public' });

      // a visitor sees the page, no comment box but a sign-in hint
      await bob.goto(`/view.html?s=${created.slug}`);
      await bob.waitFor(`!document.getElementById('socialBar').hidden && !document.getElementById('vCommentHint').hidden`, 'signed-out view');
      await apiIn(bob, 'POST', '/auth/register', { name: 'Bob', email: `bob-c-${stamp}@example.com`, password: 'correct horse battery' });
      await bob.goto(`/view.html?s=${created.slug}`);
      await bob.waitFor(`!document.getElementById('vComments').hidden && !document.getElementById('vCommentForm').hidden`, 'comment box for a member');
      await bob.eval(`document.getElementById('vLike').click()`);
      await bob.waitFor(`document.getElementById('vLikes').textContent === '1' && document.getElementById('vLike').classList.contains('on')`, 'liked');
      await bob.eval(`(() => { const f = document.getElementById('vCommentForm'); f.elements.text.value = 'Lovely waltz!'; f.requestSubmit(); })()`);
      await bob.waitFor(`document.getElementById('vCommentList').textContent.includes('Lovely waltz!')`, 'comment posted');

      // the author's profile and Explore sorted by likes
      const profile = await bob.eval(`document.getElementById('vAuthor').getAttribute('href')`);
      await bob.goto(`/${profile}`);
      await bob.waitFor(`document.getElementById('profileGallery').textContent.includes('Waltz ${stamp}')`, 'profile lists the score');
      assert((await bob.eval(`document.getElementById('profileName').textContent`)) === `Alice ${stamp}`, 'profile name');
      await bob.goto('/explore.html');
      await bob.eval(`(() => { const s = document.getElementById('exploreSort'); s.value = 'likes'; s.dispatchEvent(new Event('change')); })()`);
      await bob.waitFor(`document.querySelector('#exploreGallery .score-card')?.textContent.includes('Waltz ${stamp}')`, 'most liked first');

      // remix: a copy in Bob's library, open in his editor
      await bob.goto(`/view.html?s=${created.slug}`);
      await bob.waitFor(`!document.getElementById('socialBar').hidden && !document.getElementById('vComments').hidden`);
      await bob.eval(`document.getElementById('vRemix').click()`);
      await bob.waitFor(`location.pathname.endsWith('app.html') && document.getElementById('title')?.value === 'Waltz ${stamp} (remix)'`, 'remix open in the editor', 20000);
    } finally {
      await bob.close().catch(() => {});
      await bobCtx.dispose();
    }
  },
  { needsApi: true },
);

test(
  'notifications and moderation: the bell, and an admin removing a reported comment',
  async (alice, browser) => {
    const stamp = Date.now();
    const bobCtx = await contextPage(browser);
    const bob = bobCtx.page;
    try {
      await alice.goto('/index.html');
      await apiIn(alice, 'POST', '/auth/register', { name: 'Alice', email: ADMIN_EMAIL, password: 'correct horse battery' });
      await bob.goto('/index.html');
      await apiIn(bob, 'POST', '/auth/register', { name: 'Bob', email: `bob-n-${stamp}@example.com`, password: 'correct horse battery' });
      await bob.goto('/app.html?template=blank-piano');
      await bob.waitFor(`!document.getElementById('bell').hidden`, 'the bell for a signed-in person');
      assert(await bob.eval(`document.getElementById('bellCount').hidden`), 'no notifications yet');

      // Alice invites Bob: his bell lights up (on focus, without waiting for the minute)
      const data = await bob.eval(`JSON.parse(localStorage.getItem('pianissimo:autosave'))`);
      data.title = `Bell ${stamp}`;
      const created = (await apiIn(alice, 'POST', '/scores', { data })).data.score;
      await apiIn(alice, 'POST', `/scores/${created.id}/editors`, { email: `bob-n-${stamp}@example.com` });
      await bob.eval(`document.dispatchEvent(new Event('visibilitychange'))`);
      await bob.waitFor(`document.getElementById('bellCount').textContent === '1' && !document.getElementById('bellCount').hidden`, 'one new notification');
      await bob.eval(`document.getElementById('bellBtn').click()`);
      await bob.waitFor(`document.querySelector('#bellPanel li.unread')?.textContent.includes('Alice invited you to edit')`, 'listed');
      await bob.eval(`document.querySelector('#bellPanel li button').click()`);
      await bob.waitFor(`document.getElementById('title').value === 'Bell ${stamp}'`, 'the notification opens the score');
      await bob.waitFor(`document.getElementById('bellCount').hidden`, 'and it is read');

      // a reported comment, reviewed by the admin
      await apiIn(alice, 'PUT', `/scores/${created.id}`, { visibility: 'public' });
      const posted = await apiIn(bob, 'POST', `/public/${created.slug}/comments`, { text: `spam ${stamp}` });
      await apiIn(alice, 'POST', `/public/comments/${posted.data.comments[0].id}/report`, {});
      await alice.goto('/admin.html');
      await alice.waitFor(`document.querySelector('.report-table')?.textContent.includes('spam ${stamp}')`, 'admin sees the report');
      await alice.eval(`document.querySelector('.report-table [data-act=remove]').click()`);
      await alice.waitFor(`!document.querySelector('.report-table')?.textContent.includes('spam ${stamp}')`, 'removed');
      // a crash in someone's browser reaches the admins' error list (and only that one is expected)
      await alice.eval(`setTimeout(() => { throw new TypeError('E2E crash ${stamp}'); }), true`);
      for (let i = 0; i < 50; i++) {
        const { data } = await apiIn(alice, 'GET', '/admin/errors');
        if (data.errors?.some((e) => e.message.includes(`E2E crash ${stamp}`))) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      alice.errors = alice.errors.filter((e) => !e.includes('E2E crash'));
      await alice.goto('/admin.html');
      await alice.waitFor(`document.getElementById('adminErrors').textContent.includes('TypeError: E2E crash ${stamp}')`, 'admin sees the crash report');
      assert(await alice.eval(`document.getElementById('adminErrors').textContent.includes('admin.html')`), 'with the page it happened on');
      const left = await apiIn(bob, 'GET', `/public/${created.slug}/comments`);
      assert(left.data.comments.length === 0, 'the comment is gone');
      await bob.goto('/admin.html');
      await bob.waitFor(`document.getElementById('adminReports').textContent.includes('for site admins')`, 'others are turned away');
    } finally {
      await bob.close().catch(() => {});
      await bobCtx.dispose();
    }
  },
  { needsApi: true },
);

test(
  'scanning: a photo of sheet music opens in the editor',
  async (page) => {
    const stamp = Date.now();
    await page.goto('/index.html');
    await apiIn(page, 'POST', '/auth/register', { name: 'Scanner', email: `scan-${stamp}@example.com`, password: 'correct horse battery' });
    await page.goto('/app.html?template=blank-piano');
    await page.waitFor(`document.querySelector('#score svg') && !document.getElementById('accountMenu').hidden`, 'signed in');
    // a 1×1 PNG as the "photo"
    const png = join(tmp, 'page.png');
    writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooser = page.browser.once('Page.fileChooserOpened', page.sessionId);
    await page.eval(`document.getElementById('score').focus()`);
    await page.press('Ctrl+Alt+O');
    const { backendNodeId } = await chooser;
    await page.send('DOM.setFileInputFiles', { files: [png], backendNodeId });
    await page.waitFor(`document.getElementById('title').value === 'Scanned page'`, 'the recognised score is open', 20000);
    const steps = await page.eval(`JSON.parse(localStorage.getItem('pianissimo:autosave')).measures[0].staves[0].map((e) => e.pitches[0]?.step).join('')`);
    assert(steps === 'CDEF', `recognised notes: ${steps}`);
  },
  { needsApi: true },
);

test(
  'account: forgot the password, reset it from the emailed link; confirm the email',
  async (page) => {
    const email = `forgetful-${Date.now()}@example.com`;
    await page.goto('/app.html');
    await page.waitFor(`document.querySelector('#score svg')`);
    await page.eval(`document.getElementById('signInBtn').click()`);
    await page.eval(`document.querySelector('[data-auth=register]').click()`);
    await page.eval(`(() => {
      const f = document.getElementById('authForm');
      f.elements.name.value = 'Forgetful';
      f.elements.email.value = ${JSON.stringify(email)};
      f.elements.password.value = 'first password';
      f.requestSubmit();
    })()`);
    await page.waitFor(`document.getElementById('authModal').hidden && !document.getElementById('accountMenu').hidden`, 'signed up');
    assert(!(await page.eval(`document.getElementById('verifyEmailBtn').hidden`)), 'offers to confirm the email');
    // the confirmation link from the welcome email
    const verify = emailedLink(email, 'verify');
    assert(verify?.startsWith(`${BASE}/app.html#verify=`), `confirmation link: ${verify}`);
    // a new query string makes it a real page load (a changed #hash alone would not reload)
    await page.goto(verify.slice(BASE.length).replace('#', '?n=1#'));
    await page.waitFor(`document.getElementById('toast').textContent.includes('confirmed')`, 'email confirmed');
    assert(await page.eval(`document.getElementById('verifyEmailBtn').hidden && location.hash === ''`), 'confirmed, and the token left the address bar');
    await page.eval(`document.getElementById('signOutBtn').click()`);
    await page.waitFor(`!document.getElementById('signInBtn').hidden`, 'signed out');

    // forgot: ask for a link
    await page.eval(`document.getElementById('signInBtn').click()`);
    await page.eval(`document.getElementById('authForgot').click()`);
    assert(await page.eval(`document.getElementById('authPasswordRow').hidden && !document.getElementById('authEmailRow').hidden`), 'only the email is asked');
    await page.eval(`(() => { const f = document.getElementById('authForm'); f.elements.email.value = ${JSON.stringify(email)}; f.requestSubmit(); })()`);
    await page.waitFor(`!document.getElementById('authDone').hidden`, 'link sent message');
    const reset = emailedLink(email, 'reset');
    assert(reset, 'a reset link was emailed');

    // open it: choose a new password and be signed in
    await page.goto(reset.slice(BASE.length).replace('#', '?n=2#'));
    await page.waitFor(`!document.getElementById('authModal').hidden && !document.getElementById('authPasswordRow').hidden && document.getElementById('authEmailRow').hidden`, 'new password form');
    assert(await page.eval(`location.hash === ''`), 'the token left the address bar');
    await page.eval(`(() => { const f = document.getElementById('authForm'); f.elements.password.value = 'second password'; f.requestSubmit(); })()`);
    await page.waitFor(`document.getElementById('authModal').hidden && !document.getElementById('accountMenu').hidden`, 'signed in with the new password');

    // change it again from the account menu
    await page.eval(`document.getElementById('changePasswordBtn').click()`);
    await page.eval(`(() => { const f = document.getElementById('authForm'); f.elements.current.value = 'wrong one!'; f.elements.password.value = 'third password'; f.requestSubmit(); })()`);
    await page.waitFor(`!document.getElementById('authError').hidden`, 'wrong current password refused');
    await page.eval(`(() => { const f = document.getElementById('authForm'); f.elements.current.value = 'second password'; f.requestSubmit(); })()`);
    await page.waitFor(`document.getElementById('authModal').hidden`, 'password changed');
  },
  { needsApi: true },
);

test('notation: drum kit, tablature and chord diagram templates', async (page) => {
  await page.goto('/app.html?template=guitar-song');
  await page.waitFor(`document.querySelectorAll('#score .vf-tabnote').length >= 12`, 'tab notes drawn');
  await page.goto('/app.html?template=rock');
  await page.waitFor(`document.querySelectorAll('#score .vf-stavenote').length > 40`, 'drum and guitar notes drawn');
  await settled(page);
  await page.press('Alt+ArrowDown'); // to the drum staff
  await page.frames();
  const status = await page.eval(`document.getElementById('status').textContent.replace(/\\s+/g, ' ')`);
  assert(/Hi-hat \+ Kick|Kick \+ Hi-hat/.test(status), `status names the drums: "${status}"`);
});

test('helpers: mixer, chord suggestions, left hand, ranges and score checks', async (page) => {
  const saved = `JSON.parse(localStorage.getItem('pianissimo:autosave'))`;
  await page.goto('/app.html?template=lead-sheet');
  await page.waitFor(`document.querySelectorAll('#mixer .mix-row').length === 2`, 'mixer: the part and the accompaniment');
  await page.eval(`document.querySelector('#mixer [data-act=mute]').click()`);
  await page.frames();
  assert(await page.eval(`${saved}.staves[0].mute === true`), 'mute is saved with the score');
  await settled(page);
  await page.eval(`document.getElementById('score').focus()`);
  await page.press('Ctrl+Alt+K');
  const menu = await page.waitFor(`document.getElementById('cmdMenu')?.textContent`, 'chord suggestions');
  assert(/^\s*C\s/.test(menu.replace(/✓/g, '')), `C is suggested first for bar 1: ${menu}`);
  await page.eval(`document.querySelector('#cmdMenu button').click()`);

  // a piano piece: melody only, then chords for every bar, then the left hand from them
  await page.goto('/app.html?template=blank-piano');
  await settled(page);
  await page.eval(`document.getElementById('score').focus()`);
  for (const k of ['C', 'E', 'G', 'E', 'F', 'A', 'C', 'A']) await page.press(k);
  await page.frames();
  await page.press('Ctrl+Shift+P');
  await page.typeText('every bar');
  await page.eval(`document.getElementById('searchInput').dispatchEvent(new Event('input'))`);
  await page.press('Enter');
  await page.frames();
  const chords = await page.eval(`${saved}.measures.slice(0, 2).map((m) => m.staves[0][0].harmony)`);
  assert(chords.join(' ') === 'C F', `chords for bars 1 and 2: ${chords}`);
  await page.press('Alt+ArrowDown');
  await page.press('Ctrl+Alt+L');
  await page.frames();
  const bass = await page.eval(`${saved}.measures[0].staves[1].filter((e) => e.pitches.length).length`);
  assert(bass >= 3, `the left hand has notes in bar 1 (${bass})`);

  // ranges: a violin note far too low shows red, and the check lists it
  await page.goto('/app.html?template=quartet');
  await settled(page);
  await page.eval(`document.getElementById('score').focus()`);
  await page.press('C');
  for (let k = 0; k < 3; k++) await page.press('Ctrl+ArrowDown');
  await page.press('ArrowLeft');
  await page.frames();
  await page.waitFor(`document.getElementById('status').textContent.includes('too low for Violin')`, 'range warning in the status bar');
  assert(await page.eval(`!!document.querySelector('#score [fill="#e03131"]')`), 'the note is drawn in red');
  await page.press('Ctrl+Alt+C');
  await page.waitFor(`!document.getElementById('checksModal').hidden`, 'check dialog');
  const listed = await page.eval(`document.getElementById('checksList').textContent`);
  assert(listed.includes('too low for Violin') && listed.includes('has no notes yet'), `checks: ${listed.slice(0, 200)}`);
});

test('microphone: the tuner and a recording hear a sung C5', async (page) => {
  await page.goto('/app.html?template=blank-piano');
  await page.waitFor(`document.querySelector('#score svg')`);
  await settled(page);
  await page.eval(`document.getElementById('score').focus()`);
  await page.press('Ctrl+Alt+U');
  await page.waitFor(`document.getElementById('tunerNote').textContent === 'C5'`, 'the tuner shows C5', 10000);
  await page.press('Ctrl+Alt+U');
  await page.waitFor(`document.getElementById('tuner').hidden`, 'tuner off');
  await page.press('Ctrl+Alt+R'); // count-in (once the piano samples have downloaded), then listen
  await page.waitFor(`document.getElementById('toast').textContent.startsWith('Listening')`, 'listening after the count-in', 60000);
  await new Promise((r) => setTimeout(r, 5000));
  await page.press('Space'); // stop
  await page.frames();
  const heard = await page.eval(`JSON.parse(localStorage.getItem('pianissimo:autosave')).measures.flatMap((m) => m.staves[0]).filter((e) => e.pitches.length).map((e) => e.pitches.map((p) => p.step + p.alter + p.octave).join('+'))`);
  assert(heard.length >= 1, 'something was written');
  assert(heard.every((p) => p === 'C05'), `only C5 was sung: ${heard.join(' ')}`);
});

test('practice: wait mode without a MIDI keyboard listens through the microphone', async (page) => {
  await page.goto('/app.html?template=blank-piano');
  await settled(page);
  await page.eval(`document.getElementById('score').focus()`);
  for (const k of ['C', 'C', 'C']) await page.press(k); // the fake microphone sings C5 every 1.5 s
  await page.press('Home');
  await page.press('Ctrl+Alt+W');
  await page.waitFor(`document.querySelector('.practice-hint')?.textContent.includes('1/3')`, 'wait mode starts at the first note', 8000);
  await page.waitFor(`document.querySelector('.practice-hint')?.textContent.includes('3/3')`, 'each sung C moves it on', 12000);
  await page.waitFor(`!document.querySelector('.practice-hint') && document.body.textContent.includes('Well played')`, 'the end', 8000);
});

test('embed: an unknown or private score shows a message', async (page) => {
  await page.goto('/embed.html?s=does-not-exist');
  const msg = await page.waitFor(`document.querySelector('.msg')?.textContent`, 'message');
  assert(/no longer shared|Could not load/.test(msg), `message: ${msg}`);
});

test('editing: drag to select, copy and paste from the toolbar, fold the panel, notes at top and bottom', async (page) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto('/app.html?template=blank-piano');
  await settled(page);
  await page.eval(`document.getElementById('score').focus()`);
  for (const k of ['C', 'D', 'E', 'F']) await page.press(k);
  await page.frames();
  // drag from the first note to the third with the mouse
  const pts = JSON.parse(
    await page.eval(`JSON.stringify((() => {
      // the first three notes of the treble staff (the bass staff's rest comes later in the page)
      const rects = [...document.querySelectorAll('#score .vf-stavenote')].map((n) => n.getBoundingClientRect());
      const top = Math.min(...rects.map((r) => r.top));
      return rects.filter((r) => r.top < top + 60).sort((p, q) => p.left - q.left).slice(0, 3).map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
    })())`),
  );
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[1].x, y: pts[1].y, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[2].x, y: pts[2].y, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts[2].x, y: pts[2].y, button: 'left', buttons: 0, clickCount: 1 });
  await page.waitFor(`document.querySelectorAll('#selection > *').length > 0`, 'a selection after dragging');
  await page.eval(`document.querySelector('[data-command-id=copy]').click(), true`);
  await page.waitFor(`document.getElementById('toast').textContent.includes('Copied 3')`, 'copied three notes');
  await page.press('Ctrl+ArrowRight'); // bar 2
  await page.eval(`document.querySelector('[data-command-id=paste]').click(), true`);
  await page.frames();
  const bar2 = await page.eval(`JSON.parse(localStorage.getItem('pianissimo:autosave')).measures[1].staves[0].filter((e) => e.pitches.length).map((e) => e.pitches[0].step).join('')`);
  assert(bar2 === 'CDE', `pasted into bar 2: ${bar2}`);

  // the settings button folds the side panel away and the sheet gets wider
  const before = await page.eval(`document.getElementById('sheetScroll').clientWidth`);
  await page.eval(`document.getElementById('panelBtn').click(), true`);
  await page.waitFor(`getComputedStyle(document.getElementById('side')).display === 'none'`, 'panel folded');
  const after = await page.eval(`document.getElementById('sheetScroll').clientWidth`);
  assert(after > before + 200, `the sheet widened: ${before} -> ${after}`);
  await page.eval(`document.getElementById('panelBtn').click(), true`);
  await page.waitFor(`getComputedStyle(document.getElementById('side')).display !== 'none'`, 'panel back');

  // the on-screen keyboard shows several octaves on a wide screen
  await page.press('Shift+KeyK').catch(() => {});
  const whites = await page.eval(`document.querySelectorAll('.pk-white').length`);
  assert(whites >= 28, `at least four octaves of keys: ${whites}`);

  // the note at the top left and the footer are kept with the score
  await page.eval(`(() => { const h = document.getElementById('headerNote'); h.value = 'Tune: EPIPHANE'; h.dispatchEvent(new Event('change')); const f = document.getElementById('footerNote'); f.value = 'Based on Isaiah 9:6'; f.dispatchEvent(new Event('change')); return true; })()`);
  const saved = await page.eval(`(() => { const s = JSON.parse(localStorage.getItem('pianissimo:autosave')); return s.headerNote + ' | ' + s.footerNote; })()`);
  assert(saved === 'Tune: EPIPHANE | Based on Isaiah 9:6', `saved notes: ${saved}`);
});

test('chords: pick one note of a chord and change it alone', async (page) => {
  await page.goto('/app.html?template=blank-piano');
  await settled(page);
  await page.eval(`document.getElementById('score').focus()`);
  await page.press('C');
  await page.press('Shift+KeyE'); // C5 with E5 above: a chord
  await page.press('ArrowLeft');
  const chord = () => page.eval(`JSON.parse(localStorage.getItem('pianissimo:autosave')).measures[0].staves[0][0].pitches.map((p) => p.step + p.octave).sort().join(' ')`);
  assert((await chord()) === 'C5 E5', `the chord: ${await chord()}`);
  await page.press('Alt+ArrowDown'); // picks the top note, E5
  await page.waitFor(`document.querySelector('.chord-pick')?.textContent.includes('E5')`, 'the top note is picked');
  await page.press('F'); // only that note becomes F
  await page.frames();
  assert((await chord()) === 'C5 F5', `only the picked note changed: ${await chord()}`);
  await page.press('ArrowUp'); // and moves alone
  await page.frames();
  assert((await chord()) === 'C5 G5', `moved alone: ${await chord()}`);
  await page.press('Escape');
  await page.press('ArrowUp'); // the whole chord again
  await page.frames();
  assert((await chord()) === 'A5 D5', `whole chord moved: ${await chord()}`);
});

// keep last: it stops the web server
test('offline: the installed app reloads and keeps working without the server', async (page, browser, ctx) => {
  await page.goto('/app.html?template=blank-piano');
  await page.waitFor(`navigator.serviceWorker.ready.then((r) => !!r.active)`, 'service worker active');
  // reload once so the page is controlled by the worker (as on any later visit)
  await page.goto('/app.html?template=blank-piano');
  await page.waitFor(`!!navigator.serviceWorker.controller`, 'page controlled by the service worker');
  const precached = await page.eval(`caches.keys().then((k) => Promise.all(k.filter((n) => n.startsWith('pianissimo-shell-')).map((n) => caches.open(n).then((c) => c.keys())))).then((l) => l.flat().length)`);
  assert(precached > 20, `app shell precached (${precached} files)`);
  ctx.stopWebServer();
  await waitForDown(`${BASE}/app.html`);
  await page.goto('/app.html?template=waltz');
  await page.waitFor(`document.querySelectorAll('#score svg .vf-stave').length > 4`, 'score drawn offline');
  await settled(page);
  const before = await page.eval(noteheads);
  await page.press('Escape');
  await page.press('ArrowRight');
  await page.press('Delete');
  await page.frames();
  assert((await page.eval(noteheads)) === before - 1, 'editing works offline');
  await page.goto('/index.html');
  await page.waitFor(`document.querySelector('#demoScore svg .vf-notehead')`, 'website works offline too');
});

test('phones: every page fits a 320px screen; settings and the ⋯ menu open as sheets', async (page) => {
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const width of [320, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 2, mobile: true });
    for (const path of ['/index.html', '/guide.html', '/explore.html', '/about.html', '/app.html?template=lead-sheet', '/app.html?template=blank-piano']) {
      await page.goto(path);
      await settled(page);
      const [scroll, inner] = await page.eval('[document.documentElement.scrollWidth, innerWidth]');
      assert(scroll === width && inner === width, `${path} at ${width}px is ${scroll}px wide (viewport ${inner})`);
    }
  }
  // the editor's top bar is one row; file actions moved into the ⋯ sheet
  assert((await page.eval(`document.querySelector('.topbar').getBoundingClientRect().height`)) < 70, 'top bar wraps');
  assert(await page.eval(`getComputedStyle(document.querySelector('.file-actions')).display === 'none'`), 'file buttons still shown');
  await page.eval(`document.getElementById('panelBtn').click(), true`);
  await page.waitFor(`(() => { const r = document.getElementById('side').getBoundingClientRect(); return r.top < innerHeight - 100 && r.width === innerWidth; })()`, 'settings sheet slides up');
  await page.eval(`document.getElementById('sideDone').click(), true`);
  assert(!(await page.eval(`document.getElementById('side').classList.contains('open')`)), 'Done closes the settings sheet');
  await page.eval(`document.getElementById('moreBtn').click(), true`);
  assert(await page.eval(`!document.getElementById('moreModal').hidden && document.querySelectorAll('#moreList [data-more]').length >= 15`), 'the ⋯ sheet lists the commands');
  await page.eval(`document.querySelector('#moreList [data-more=help]').click(), true`);
  assert(await page.eval(`!document.getElementById('helpModal').hidden && document.getElementById('moreModal').hidden`), 'a ⋯ item runs its command');
  // the on-screen keyboard shows one octave of wide keys
  assert((await page.eval(`document.querySelectorAll('.pk-white').length`)) === 7, 'one octave on a phone');
});

// ------------------------------------------------------------------ run
async function main() {
  if (!existsSync(join(root, 'dist', 'app.html'))) throw new Error('No build found: run `npm run build` first');
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome/Chromium not found: set CHROME_PATH');
  const php = findPhp();
  if (php) {
    children.push(
      spawn(php, ['-S', `localhost:${API_PORT}`, '-t', root], {
        cwd: root,
        env: {
          ...process.env,
          PIANISSIMO_DB: join(tmp, 'e2e.sqlite'),
          PIANISSIMO_REALTIME_URL: `ws://localhost:${RT_PORT}`,
          PIANISSIMO_REALTIME_SECRET: RT_SECRET,
          PIANISSIMO_ADMINS: ADMIN_EMAIL,
          // emails (password reset, confirmation) are written to a file the tests read
          PIANISSIMO_MAIL_FROM: 'Pianissimo <music@example.com>',
          PIANISSIMO_MAIL_LOG: MAIL_LOG,
          PIANISSIMO_SITE_URL: `${BASE}/`,
          // a stand-in for Audiveris (writes a fixed C D E F score)
          PIANISSIMO_OMR_COMMAND: `"${process.execPath}" "${join(root, 'scripts/fake-omr.mjs')}" {in} {out}`,
        },
        stdio: 'ignore',
      }),
      spawn(process.execPath, [join(root, 'realtime/server.mjs')], {
        env: { ...process.env, PORT: String(RT_PORT), PIANISSIMO_REALTIME_SECRET: RT_SECRET },
        stdio: 'ignore',
      }),
    );
    await waitForHttp(`http://localhost:${API_PORT}/server/api/index.php/health`);
    await waitForHttp(`http://localhost:${RT_PORT}/health`);
  }
  const web = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: root,
    env: { ...process.env, API_PORT: String(API_PORT) },
    stdio: 'ignore',
  });
  children.push(web);
  const ctx = { stopWebServer: () => web.kill() };
  await waitForHttp(`${BASE}/app.html`);
  const browser = await Browser.launch(chrome);

  let failed = 0;
  for (const t of tests) {
    // E2E_ONLY=teaching runs only the tests whose name contains that text
    if (process.env.E2E_ONLY && !t.name.includes(process.env.E2E_ONLY)) continue;
    if (t.needsApi && !php) {
      console.log(`  - ${t.name} (skipped: PHP not found)`);
      continue;
    }
    const page = await browser.newPage();
    const started = Date.now();
    try {
      await t.fn(page, browser, ctx);
      if (page.errors.length) throw new Error(`uncaught page errors:\n${page.errors.join('\n')}`);
      console.log(`  ✓ ${t.name} (${Date.now() - started} ms)`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${t.name}\n    ${String(err.message ?? err).replace(/\n/g, '\n    ')}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  await browser.close();
  console.log(failed ? `\n${failed} of ${tests.length} end-to-end tests failed` : `\nAll ${tests.length} end-to-end tests passed`);
  return failed;
}

main()
  .then((failed) => {
    cleanup();
    process.exit(failed ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    cleanup();
    process.exit(1);
  });
