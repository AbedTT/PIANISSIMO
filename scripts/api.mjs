// Start the PHP API for development: php -S localhost:8000 with the project root as docroot.
// Uses `php` from PATH, or XAMPP's php.exe on Windows. Vite proxies /server/* to it.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.env.PHP_BINARY, 'php', 'C:/xampp/php/php.exe', '/Applications/XAMPP/bin/php', '/opt/lampp/bin/php'];
const php = candidates.find((c) => c && (existsSync(c) || spawnSync(c, ['-v']).status === 0));
if (!php) {
  console.error('PHP 8.1+ not found. Install PHP or set PHP_BINARY=/path/to/php');
  process.exit(1);
}
const port = process.env.API_PORT ?? '8000';
console.log(`Pianissimo API: http://localhost:${port}/server/api/index.php/health  (${php})`);
// development email: written to a file instead of being sent, with links to the dev server,
// so "Forgot your password?" and the confirmation link can be tried locally
const env = { ...process.env };
if (!env.PIANISSIMO_MAIL_FROM && !env.PIANISSIMO_SMTP_HOST) {
  env.PIANISSIMO_MAIL_FROM = 'Pianissimo (dev) <dev@localhost>';
  env.PIANISSIMO_MAIL_LOG ??= resolve(root, 'server/data/dev-mail.log');
  env.PIANISSIMO_SITE_URL ??= `http://localhost:${process.env.WEB_PORT ?? 5173}/`;
  console.log(`Emails are written to ${env.PIANISSIMO_MAIL_LOG}`);
}
spawn(php, ['-S', `localhost:${port}`, '-t', root], { stdio: 'inherit', cwd: root, env });
