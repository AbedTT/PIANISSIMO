/**
 * The PHP mailer's SMTP client (server/lib/Mail.php) against a small fake SMTP server.
 * Skipped when PHP is missing.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].find(
  (c) => c && (existsSync(c) || spawnSync(c, ['-v']).status === 0),
);

interface Session {
  lines: string[];
  data: string;
}

/** A fake SMTP server. `features` are announced after EHLO; `reject` makes RCPT fail. */
function smtpServer(opts: { features: string[]; reject?: boolean }, sessions: Session[]): Server {
  return createServer((sock: Socket) => {
    const session: Session = { lines: [], data: '' };
    sessions.push(session);
    let inData = false;
    let auth = '';
    let buffer = '';
    const say = (s: string) => sock.write(s + '\r\n');
    sock.on('error', () => {}); // a client may hang up abruptly
    say('220 fake.test ESMTP');
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            say('250 queued');
          } else session.data += line + '\n';
          continue;
        }
        session.lines.push(line);
        const cmd = line.split(' ')[0].toUpperCase();
        if (auth === 'user') {
          auth = 'pass';
          say('334 UGFzc3dvcmQ6');
        } else if (auth === 'pass') {
          auth = '';
          say('235 ok');
        } else if (cmd === 'EHLO') {
          const all = ['fake.test', ...opts.features];
          all.forEach((f, k) => say(`250${k === all.length - 1 ? ' ' : '-'}${f}`));
        } else if (cmd === 'AUTH' && line.split(' ')[1] === 'PLAIN') say('235 ok');
        else if (cmd === 'AUTH') {
          auth = 'user';
          say('334 VXNlcm5hbWU6');
        } else if (cmd === 'MAIL') say('250 ok');
        else if (cmd === 'RCPT') say(opts.reject ? '550 no such user' : '250 ok');
        else if (cmd === 'DATA') {
          inData = true;
          say('354 go ahead');
        } else if (cmd === 'QUIT') {
          say('221 bye');
          sock.end();
        } else say('502 not implemented');
      }
    });
  });
}

let dir = '';
let runs = 0;

/**
 * Run Mailer::send in PHP with this configuration; resolves to [ok, lastError]. Asynchronous,
 * so the fake servers in this process can answer meanwhile.
 */
function send(config: Record<string, unknown>, to = 'erin@example.com'): Promise<[boolean, string]> {
  const script = join(dir, `send${++runs}.php`);
  writeFileSync(
    script,
    `<?php
require ${JSON.stringify(resolve(__dirname, '../../server/lib/Mail.php'))};
$m = new Pianissimo\\Mailer(json_decode(${JSON.stringify(JSON.stringify(config))}, true));
$ok = $m->send(${JSON.stringify(to)}, 'Ünïcode subject', ".hidden dot line\\nSecond line: café");
echo json_encode([$ok, $m->lastError]);`,
  );
  return new Promise((ok, fail) => {
    const child = spawn(php!, ['-d', 'log_errors=0', '-d', 'display_errors=0', script]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', fail);
    child.on('close', () => {
      try {
        ok(JSON.parse(out));
      } catch {
        fail(new Error('PHP said: ' + out));
      }
    });
  });
}

describe.skipIf(!php)('sending email over SMTP', () => {
  const sessions: Session[] = [];
  let plain: Server;
  let login: Server;
  let refusing: Server;
  const port = (s: Server) => (s.address() as { port: number }).port;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pianissimo-mail-'));
    plain = smtpServer({ features: ['AUTH PLAIN LOGIN', '8BITMIME'] }, sessions);
    login = smtpServer({ features: ['AUTH LOGIN'] }, sessions);
    refusing = smtpServer({ features: [], reject: true }, sessions);
    await Promise.all([plain, login, refusing].map((s) => new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok))));
  });

  afterAll(() => {
    for (const s of [plain, login, refusing]) s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const base = { mail_from: 'Pianissimo <music@example.com>', smtp_host: '127.0.0.1', smtp_secure: 'none' };

  it('delivers a UTF-8 message with AUTH PLAIN, dot-stuffing and the right envelope', async () => {
    const n = sessions.length;
    expect(await send({ ...base, smtp_port: port(plain), smtp_user: 'me', smtp_pass: 'secret' })).toEqual([true, '']);
    const s = sessions[n];
    expect(s.lines).toContain(`AUTH PLAIN ${Buffer.from('\0me\0secret').toString('base64')}`);
    expect(s.lines).toContain('MAIL FROM:<music@example.com>');
    expect(s.lines).toContain('RCPT TO:<erin@example.com>');
    expect(s.data).toContain('From: Pianissimo <music@example.com>');
    expect(s.data).toContain(`Subject: =?UTF-8?B?${Buffer.from('Ünïcode subject').toString('base64')}?=`);
    expect(s.data).toMatch(/Message-ID: <[0-9a-f]{32}@example\.com>/);
    const body = s.data.split('\n\n').slice(1).join('').replace(/\s/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('.hidden dot line\nSecond line: café');
  });

  it('logs in with AUTH LOGIN when PLAIN is not offered', async () => {
    const n = sessions.length;
    expect((await send({ ...base, smtp_port: port(login), smtp_user: 'me', smtp_pass: 'secret' }))[0]).toBe(true);
    expect(sessions[n].lines.slice(1, 4)).toEqual(['AUTH LOGIN', Buffer.from('me').toString('base64'), Buffer.from('secret').toString('base64')]);
  });

  it('reports a refused recipient, a missing STARTTLS and a bad address without throwing', async () => {
    const [ok, err] = await send({ ...base, smtp_port: port(refusing) });
    expect(ok).toBe(false);
    expect(err).toContain('550 no such user');
    const [ok2, err2] = await send({ ...base, smtp_port: port(plain), smtp_secure: 'tls' });
    expect(ok2).toBe(false);
    expect(err2).toContain('STARTTLS');
    expect(await send({ ...base, smtp_port: port(plain) }, 'x@y.z\r\nBcc: evil@example.com')).toEqual([false, 'bad recipient address']);
    expect(await send({ smtp_host: '127.0.0.1' })).toEqual([false, '']); // no sender set: email is off
  });
});
