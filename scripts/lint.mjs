// Project lint: rules that type-checking does not cover, with no dependencies.
//
//   npm run lint      (type-checks the app and the tests first)
//   node scripts/lint.mjs
//
// Checks every file git knows about (tracked or new, not ignored). Prints each problem as
// file:line  rule  message, and exits with 1 when there is any. To allow one line on purpose,
// put `lint-ignore <rule>` in a comment on it.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .stdout.split('\n')
  .map((f) => f.trim())
  .filter((f) => f && !f.startsWith('node_modules/') && !f.startsWith('dist/') && !f.startsWith('release/'));

const TEXT = new Set(['.ts', '.mjs', '.js', '.php', '.css', '.html', '.md', '.yml', '.json', '.sh', '.py', '.cs', '.webmanifest', '.htaccess']);
const CODE = new Set(['.ts', '.mjs', '.js', '.php', '.css', '.html', '.cs', '.py', '.sh']);
const isTest = (f) => /\.test\.ts$/.test(f);

const problems = [];
const report = (file, line, rule, message) => problems.push({ file, line, rule, message });

// ------------------------------------------------------------------ translations of toast messages
// Every fixed message shown with toast(…) must be in MESSAGE_ROWS or match MESSAGE_PATTERNS
// (src/ui/i18n-messages.ts), or people using the editor in French, Spanish or German see English.
const messagesSource = readFileSync(join(root, 'src/ui/i18n-messages.ts'), 'utf8');
const jsString = (quoted) => {
  try {
    return quoted.startsWith("'") ? JSON.parse(`"${quoted.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) : JSON.parse(quoted);
  } catch {
    return null;
  }
};
const knownMessages = new Set(
  [...messagesSource.matchAll(/^\s*\[('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),/gm)].map((m) => jsString(m[1])).filter(Boolean),
);
const messagePatterns = [...messagesSource.matchAll(/\{\s*re:\s*\/((?:[^/\\\n]|\\.)+)\/([a-z]*)\s*,/g)].map((m) => new RegExp(m[1], m[2]));
const translated = (text) => knownMessages.has(text) || messagePatterns.some((re) => re.test(text));

// ------------------------------------------------------------------ rules per line
const rules = [
  { id: 'no-debugger', test: (l, f) => /\.(ts|mjs|js)$/.test(f) && /^\s*debugger\s*;?\s*$/.test(l), message: 'remove the debugger statement' },
  { id: 'no-console-log', test: (l, f) => f.startsWith('src/') && !isTest(f) && /console\.log\(/.test(l), message: 'console.log in app code (use console.warn/error for real problems)' },
  { id: 'no-only', test: (l, f) => (isTest(f) || f === 'scripts/e2e.mjs') && /\b(it|describe|test)\.only\(/.test(l), message: '.only would skip the other tests' },
  {
    id: 'no-eval',
    // (a method that happens to be called eval, like the e2e page helper, is fine)
    test: (l, f) => /\.(ts|mjs|js)$/.test(f) && !/^\s*(async\s+)?eval\s*\([^)]*\)\s*\{/.test(l) && (/(^|[^.\w])eval\(/.test(l) || /new Function\(/.test(l)),
    message: 'eval / new Function run text as code (and the security policy blocks them)',
  },
  {
    id: 'blank-noopener',
    test: (l, f) => /\.(ts|html)$/.test(f) && /target=["']?_blank/.test(l) && !/rel=["'][^"']*noopener/.test(l),
    message: 'target="_blank" needs rel="noopener" (or the opened page can reach this one)',
  },
  { id: 'php-debug-output', test: (l, f) => f.endsWith('.php') && /\b(var_dump|print_r|var_export)\s*\(/.test(l), message: 'debug output in server code' },
  { id: 'php-request', test: (l, f) => f.endsWith('.php') && /\$_REQUEST\b/.test(l), message: 'use $_GET or the JSON body, not $_REQUEST' },
  {
    id: 'php-sql-input',
    test: (l, f) => f.endsWith('.php') && /->(query|exec|prepare)\(/.test(l) && /\$_(GET|POST|COOKIE|SERVER|FILES)\b|\$in\[/.test(l),
    message: 'request input inside SQL text: pass it as a ? parameter',
  },
  { id: 'private-key', test: (l) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(l), message: 'a private key must never be committed' },
  { id: 'conflict-marker', test: (l, f) => !f.endsWith('.md') && /^(<{7}|>{7})( |$)/.test(l), message: 'merge conflict marker' },
  { id: 'trailing-space', test: (l, f) => !f.endsWith('.md') && /[ \t]+$/.test(l), message: 'trailing whitespace' },
  { id: 'tab', test: (l, f) => CODE.has(extname(f)) && !f.endsWith('.sh') && /\t/.test(l), message: 'tab character (indent with spaces)' },
  {
    id: 'untranslated-toast',
    test: (l, f) => {
      if (!f.startsWith('src/') || isTest(f)) return false;
      const m = /\btoast\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\)/.exec(l);
      if (!m) return false;
      const text = jsString(m[1]);
      return text !== null && !translated(text);
    },
    message: 'toast message has no translation: add it to MESSAGE_ROWS in src/ui/i18n-messages.ts',
  },
];

for (const file of files) {
  const ext = extname(file) || (file.endsWith('.htaccess') ? '.htaccess' : '');
  if (!TEXT.has(ext)) continue;
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    continue; // deleted but not yet staged
  }
  if (text.length && !text.endsWith('\n')) report(file, text.split('\n').length, 'final-newline', 'the file should end with a newline');
  if (file.endsWith('.php') && file.startsWith('server/') && !/declare\(strict_types=1\);/.test(text) && text.includes('<?php')) {
    report(file, 1, 'php-strict-types', 'add declare(strict_types=1);');
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of rules) {
      if (rule.test(line, file) && !line.includes(`lint-ignore ${rule.id}`)) report(file, i + 1, rule.id, rule.message);
    }
  });
}

// PHP syntax (php -l), when PHP is installed
const php = [process.env.PHP_BINARY, 'php', 'C:/xampp/php/php.exe'].find((c) => c && spawnSync(c, ['-v']).status === 0);
if (php) {
  for (const file of files.filter((f) => f.endsWith('.php'))) {
    const r = spawnSync(php, ['-l', join(root, file)], { encoding: 'utf8' });
    if (r.status !== 0) report(file, Number(/on line (\d+)/.exec(r.stdout + r.stderr)?.[1] ?? 1), 'php-syntax', (r.stdout + r.stderr).trim().split('\n')[0]);
  }
}

for (const p of problems) console.log(`${p.file}:${p.line}  ${p.rule}  ${p.message}`);
const checked = files.filter((f) => TEXT.has(extname(f)) || f.endsWith('.htaccess')).length;
console.log(problems.length ? `\n${problems.length} problem(s) in ${new Set(problems.map((p) => p.file)).size} file(s)` : `Lint: ${checked} files, no problems${php ? '' : ' (PHP not found: php -l skipped)'}`);
process.exit(problems.length ? 1 : 0);
