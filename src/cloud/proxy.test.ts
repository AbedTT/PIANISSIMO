/**
 * Visitor address and HTTPS behind trusted proxies (server/lib/Http.php), run in PHP.
 * Skipped when PHP is missing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].find(
  (c) => c && (existsSync(c) || spawnSync(c, ['-v']).status === 0),
);

/** Http::clientIp() and isHttps() for these settings and request headers. */
function ask(config: Record<string, unknown>, server: Record<string, string>): { ip: string; https: boolean } {
  const code = `
require ${JSON.stringify(resolve(__dirname, '../../server/lib/Http.php'))};
$in = json_decode(stream_get_contents(STDIN), true);
$_SERVER = $in['server'];
Pianissimo\\Http::configure($in['config']);
echo json_encode(['ip' => Pianissimo\\Http::clientIp(), 'https' => Pianissimo\\Http::isHttps()]);`;
  const r = spawnSync(php!, ['-r', code], { input: JSON.stringify({ config, server }), encoding: 'utf8' });
  return JSON.parse(r.stdout);
}

describe.skipIf(!php)('behind a proxy', () => {
  const lb = { trusted_proxies: ['10.0.0.0/8', '::1'] };

  it('ignores forwarding headers when no proxy is trusted (anyone could send them)', () => {
    expect(ask({}, { REMOTE_ADDR: '203.0.113.7', HTTP_X_FORWARDED_FOR: '1.2.3.4', HTTP_X_FORWARDED_PROTO: 'https' })).toEqual({ ip: '203.0.113.7', https: false });
  });

  it('takes the visitor from X-Forwarded-For, past our own proxies only', () => {
    expect(ask(lb, { REMOTE_ADDR: '10.1.2.3', HTTP_X_FORWARDED_FOR: '198.51.100.9, 10.0.0.5' }).ip).toBe('198.51.100.9');
    // a visitor who sends their own X-Forwarded-For cannot pick an address: the proxy appended the real one
    expect(ask(lb, { REMOTE_ADDR: '10.1.2.3', HTTP_X_FORWARDED_FOR: '6.6.6.6, 198.51.100.9' }).ip).toBe('198.51.100.9');
    // the header from a machine that is not our proxy counts for nothing
    expect(ask(lb, { REMOTE_ADDR: '203.0.113.7', HTTP_X_FORWARDED_FOR: '198.51.100.9' }).ip).toBe('203.0.113.7');
    expect(ask(lb, { REMOTE_ADDR: '::1', HTTP_X_FORWARDED_FOR: '2001:db8::42' }).ip).toBe('2001:db8::42');
    expect(ask(lb, { REMOTE_ADDR: '10.1.2.3', HTTP_X_FORWARDED_FOR: 'garbage' }).ip).toBe('10.1.2.3');
  });

  it('reads another header when told to (Cloudflare)', () => {
    const cf = { trusted_proxies: ['173.245.48.0/20'], client_ip_header: 'CF-Connecting-IP' };
    expect(ask(cf, { REMOTE_ADDR: '173.245.48.10', HTTP_CF_CONNECTING_IP: '198.51.100.9', HTTP_X_FORWARDED_FOR: '6.6.6.6' }).ip).toBe('198.51.100.9');
    expect(ask(cf, { REMOTE_ADDR: '173.245.64.1', HTTP_CF_CONNECTING_IP: '198.51.100.9' }).ip).toBe('173.245.64.1'); // outside the /20
  });

  it('knows the visitor used HTTPS when the trusted proxy says so', () => {
    expect(ask(lb, { REMOTE_ADDR: '10.1.2.3', HTTP_X_FORWARDED_PROTO: 'https' }).https).toBe(true);
    expect(ask(lb, { REMOTE_ADDR: '203.0.113.7', HTTP_X_FORWARDED_PROTO: 'https' }).https).toBe(false);
    expect(ask({}, { REMOTE_ADDR: '203.0.113.7', HTTPS: 'on' }).https).toBe(true);
  });
});
