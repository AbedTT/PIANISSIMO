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
spawn(php, ['-S', `localhost:${port}`, '-t', root], { stdio: 'inherit', cwd: root });
