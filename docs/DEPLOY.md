# Deploying Pianissimo

Pianissimo has two pieces:

| Piece | What it is | Needs |
| --- | --- | --- |
| Front end | Static files built by Vite into `dist/` (editor, viewer and public pages) | Any static web server |
| API | PHP in `server/` (accounts, library, sharing, version history) | PHP 8.2+ with `pdo_sqlite` or `pdo_mysql`, `mbstring` |

The editor works without the API: scores are kept in the browser and can be saved as files.
Accounts, the cloud library, sharing links, Explore and version history need the API.

## 1. Build

```bash
npm ci
npm run build        # type-check + production build into dist/
```

## 2. Choose a layout

The front end looks for the API at `../server/api/index.php`, relative to the page.
This works without configuration if `dist/` and `server/` are siblings:

```
/var/www/pianissimo/
├── dist/      ← web pages (https://example.com/pianissimo/dist/)
└── server/    ← PHP API  (https://example.com/pianissimo/server/api/index.php)
```

To use a different API location, set it before the app scripts load. The pages' security policy blocks inline scripts, so put the setting in a file, e.g. `dist/config.js`:

```js
window.PIANISSIMO_API = 'https://api.example.com/api/index.php';
```

and load it in the `<head>` of each HTML page in `dist/`, before the other scripts: `<script src="config.js"></script>`.

If the API is on a different origin, it must also send CORS headers that allow credentials, and its origin must be added to `connect-src` in the security policy (section 5). The simplest setup is to serve both from one origin.

### XAMPP (local or a small server)

1. Copy the project to `C:\xampp\htdocs\Pianissimo` and run `npm run build`.
2. Start Apache.
3. Open http://localhost/Pianissimo/dist/.

The `.htaccess` files deny web access to `server/lib` and `server/data`. PHP files such as `config.local.php` are executed, not served, so they print nothing.

### Nginx + PHP-FPM

Apache honours the `.htaccess` files; Nginx does not. With Nginx, block those paths yourself:

```nginx
location ~ ^/pianissimo/server/(lib|data)/ { deny all; }
location ~ ^/pianissimo/server/api/index\.php(/|$) {
    fastcgi_split_path_info ^(.+\.php)(/.*)$;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_param PATH_INFO $fastcgi_path_info;
    fastcgi_pass unix:/run/php/php8.2-fpm.sock;
}
```

## 3. Database

**SQLite (default).** No setup is needed. The database file is created at `server/data/pianissimo.sqlite` on first use. The web server user must be able to write to `server/data/`.

**MySQL / MariaDB.** Create a database and a user, then create `server/config.local.php`. This file is git-ignored and must never be committed.

```php
<?php return [
  'db_dsn'  => 'mysql:host=127.0.0.1;dbname=pianissimo;charset=utf8mb4',
  'db_user' => 'pianissimo',
  'db_pass' => 'a-long-random-password',
];
```

You can also give the connection in the environment: `PIANISSIMO_DB_DSN`, `PIANISSIMO_DB_USER`, `PIANISSIMO_DB_PASS`.

The tables are created and upgraded automatically on the first request, including the version-history table and the `revision` column added in Phase 14.

**Which one?** SQLite is fine for one server and a few hundred active people: it handles many readers and one writer at a time, and saves are small. Move to MySQL/MariaDB when you expect many people saving at once, want the database on its own machine, or run more than one web server. The automatic tests run on both (MySQL 8 in CI, MariaDB 10.4 checked too).

### Backups

```cron
30 3 * * *  php /var/www/pianissimo/server/cron/backup.php
```

This writes `server/data/backups/pianissimo-<date>-<time>.jsonl.gz` every night and keeps the newest 14 (`--keep=30`, `--dir=/backups/pianissimo`, or `backup_keep` / `backup_dir` in the config). The file holds every row of every table and works the same for SQLite and MySQL. **Copy the backups off the server too** (rsync, rclone to cloud storage, your host's snapshots): a backup on the same disk does not survive the disk.

To restore, into a fresh, empty database (the tables are created automatically):

```bash
php server/cron/restore.php server/data/backups/pianissimo-20261127-033000.jsonl.gz
```

It refuses a database that already has accounts, unless you add `--replace` (which deletes everything in it first). It is all or nothing: if anything fails, nothing changes. Try a restore now and then, into a scratch database, to know your backups work.

### Moving from SQLite to MySQL

1. Put the site in maintenance (or pick a quiet moment) and run `php server/cron/backup.php`.
2. Create the MySQL database and user, and add them to `server/config.local.php` (above).
3. Run `php server/cron/restore.php <that backup file>`.
4. Open the site and sign in; everything is there, with the same links. Keep the SQLite file until you are sure.

## 4. Live co-editing (optional)

Without this service everything still works: saving is conflict-safe and editors see each other's saves within 20 s. With it, people editing the same score see each other's notes and cursors as they type.

1. Pick a long random secret (32+ characters) and give it to **both** sides:
   - PHP: `realtime_secret` in `server/config.local.php`, or the `PIANISSIMO_REALTIME_SECRET` environment variable.
   - The service: `PIANISSIMO_REALTIME_SECRET`.
2. Tell PHP where browsers reach the service. Set `realtime_url`, for example `wss://music.example.com/live`, or `PIANISSIMO_REALTIME_URL`.
3. Run the service (Node 18+, no dependencies): `PORT=8090 PIANISSIMO_REALTIME_SECRET=… node realtime/server.mjs`. Keep it running with systemd, pm2 or a container. Set `ALLOWED_ORIGINS=https://music.example.com` to refuse other sites.
4. Proxy WebSockets to it over HTTPS. With Nginx:

```nginx
location /live {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
}
```

How it works:
- The PHP API gives signed-in owners and editors a one-hour ticket (`POST /scores/{id}/realtime`), signed with the shared secret. The service checks the signature, so it needs no database.
- Each open score is a room. The first person in is the *leader* and the only one who saves to the library, so collaborators never get conflict dialogs from each other. If the leader leaves, the next person takes over.
- One service process holds the rooms in memory. Run a single instance, or route each score to the same instance.

## 5. Security headers

Every page carries a Content-Security-Policy in a `<meta>` tag, added at build time (`CSP` in `vite.config.ts`). It allows scripts, styles and fonts only from your site, instrument samples from `tonejs.github.io` and `gleitz.github.io`, and WebSocket connections for live co-editing. The API sends its own strict headers.

A few protections only work as HTTP headers. `dist/.htaccess` (copied from `public/.htaccess`) sets them on Apache with `mod_headers` (on in XAMPP):

| Header | Why |
|---|---|
| `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` | Other sites cannot show the editor in a hidden frame and trick people into clicking (clickjacking). `embed.html` stays embeddable |
| `Strict-Transport-Security` | Browsers keep using HTTPS (sent on HTTPS only) |
| `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` | No content-type guessing; other sites see only your domain in the referrer |
| `Permissions-Policy` | Only the microphone (tuner, recording) and MIDI are available, and only to your pages |
| `Cache-Control` | Pages and `sw.js` are re-checked on every visit; files in `assets/` (named by content hash) are cached for a year |

With Nginx, add the same to the server block of the pages:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), geolocation=(), payment=(), usb=(), microphone=(self), midi=(self)" always;
add_header Strict-Transport-Security "max-age=31536000" always;
add_header Content-Security-Policy "frame-ancestors 'self'" always;
add_header X-Frame-Options "SAMEORIGIN" always;
location = /pianissimo/dist/embed.html {
    add_header Content-Security-Policy "frame-ancestors *" always;
}
location ~ ^/pianissimo/dist/(.*\.html|sw\.js)$ { add_header Cache-Control "no-cache"; }
location ^~ /pianissimo/dist/assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
```

Nginx drops the server-level `add_header` lines inside a `location` that has its own, so repeat the others there if you want them on those files too.

Check a deployment with `curl -I https://music.example.com/pianissimo/dist/app.html`, or with a scanner such as securityheaders.com.

## 6. Email, accounts and admins

Email lets people **reset a forgotten password**, confirms their address when they sign up, and sends copies of notifications. Without it, people who forget their password cannot get back in, so set it up before opening sign-ups to the public.

Use a mail service (Postmark, Amazon SES, SendGrid, Mailgun, Brevo or your host's SMTP relay) over SMTP. PHP's `mail()` is used only when no `smtp_host` is set, and its messages often end up in spam.

| Setting | Environment variable | What it does |
|---|---|---|
| `mail_from` | `PIANISSIMO_MAIL_FROM` | Sender, e.g. `Pianissimo <music@example.com>`. Empty = no email at all: notifications stay in the app (🔔) and passwords cannot be reset |
| `site_url` | `PIANISSIMO_SITE_URL` | Address of the pages, e.g. `https://music.example.com/pianissimo/dist/`. **Required** for reset and confirmation links (they are never built from the request, so a forged `Host` header cannot redirect them) |
| `smtp_host` | `PIANISSIMO_SMTP_HOST` | The mail service's SMTP server, e.g. `smtp.postmarkapp.com` |
| `smtp_port` | `PIANISSIMO_SMTP_PORT` | Default 587 (465 with `ssl`) |
| `smtp_secure` | `PIANISSIMO_SMTP_SECURE` | `tls` (STARTTLS, the default), `ssl` (TLS from the start) or `none` (only for a relay on the same machine) |
| `smtp_user`, `smtp_pass` | `PIANISSIMO_SMTP_USER`, `PIANISSIMO_SMTP_PASS` | Login (the service's API key or SMTP credentials). Keep them in `config.local.php` or the environment, never in git |
| `require_verified_email` | `PIANISSIMO_REQUIRE_VERIFIED_EMAIL` | `1` = only people who confirmed their address may comment or list scores publicly (against spam accounts). Off by default |
| `admins` | `PIANISSIMO_ADMINS` | Account emails, separated by commas, that may open `admin.html` and review reported comments and scores |

How the account emails work:
- **Forgot your password?** in the sign-in dialog sends a link that works once, for one hour. The answer is the same whether or not an account uses the address. At most 3 links per account and hour.
- Opening the link (`app.html#reset=…`) asks for a new password and signs in. The token is in the `#` part, so it is never sent to a server or in a referrer, and it is removed from the address bar at once. Only its SHA-256 is stored.
- Setting a new password, or changing it from the account menu (**Change password…**, which asks for the current one), signs the account out on every other device.
- New accounts get a link to confirm their address (valid 7 days). Until then the account menu offers **✉ Confirm my email** to send a new one.
- Failed attempts are limited per account (`auth_attempts_per_15min`, default 10) and per IP address (`auth_attempts_per_ip_15min`, 50; new accounts `registrations_per_ip_15min`, 30), so a classroom behind one address can still sign up together.

Failures to send are written to the PHP error log (`[pianissimo] email not sent: …`) and never break the request. Your sending domain needs SPF and DKIM records from your mail service, or messages will be marked as spam.

### Daily email summaries

People can choose a daily summary instead of one email per event. Run the digest once a day:

```cron
15 7 * * *  php /var/www/pianissimo/server/cron/digest.php
```

It needs `mail_from`, and refuses to run from the web (`server/cron/` is also blocked by `.htaccess`). For development, set `mail_log` (`PIANISSIMO_MAIL_LOG`) to a file path: emails are written there instead of being sent.

## 7. Error reports

When something breaks in someone's browser (an uncaught error) or in the API (an unexpected exception), a short report is stored on your server. Site admins (`admins`) see them on **admin.html → Errors**, grouped (the same error 500 times is one line with a count), with the page, version and browser, and mark them **Fixed** when done.

Reports contain the error message, file names and line numbers, the page name, the Pianissimo version and the browser's name. Email addresses, long tokens and query strings are removed before anything is stored, and score content is never sent. Each browser sends at most 5 per page and each address 30 per hour; at most 1,000 groups are kept.

| Setting | Environment variable | What it does |
|---|---|---|
| `error_reports` | `PIANISSIMO_ERROR_REPORTS` | `0` turns browser reports off |
| `alert_webhook` | `PIANISSIMO_ALERT_WEBHOOK` | An `https://` webhook (Slack, Discord, Microsoft Teams…): the first report of each new error is posted there, so you hear about problems straight away |

The PHP error log still gets the full details of server errors.

## 8. Behind a proxy, CDN or load balancer

When Cloudflare, a load balancer or a reverse proxy (Nginx in front of Apache, a container platform) sits in front of the site, every request seems to come from the proxy. Tell Pianissimo which addresses are your proxies:

| Setting | Environment variable | What it does |
|---|---|---|
| `trusted_proxies` | `PIANISSIMO_TRUSTED_PROXIES` | Addresses or CIDR ranges of your proxies, e.g. `127.0.0.1, 10.0.0.0/8`, or Cloudflare's published ranges |
| `client_ip_header` | `PIANISSIMO_CLIENT_IP_HEADER` | The header with the visitor's address: `X-Forwarded-For` (default), or `CF-Connecting-IP` with Cloudflare |

Then the visitor's own address is used for the sign-in limits (instead of everyone sharing the proxy's), and `X-Forwarded-Proto: https` from the proxy marks the session cookie `Secure` and sends HSTS. Forwarded headers from any other machine are ignored, so visitors cannot fake their address. Without proxies, leave this empty.

## 9. Scanning sheet music (optional)

Install [Audiveris](https://github.com/Audiveris/audiveris) (open source, needs Java) on the server. Then set `omr_command` (`PIANISSIMO_OMR_COMMAND`):

```php
'omr_command' => '/opt/audiveris/bin/Audiveris -batch -export -output {out} {in}',
'omr_timeout' => 180, // seconds
```

`{in}` is replaced by the uploaded file, `{out}` by a fresh folder; any `.mxl`/`.musicxml` written into it is returned. Allow uploads of 10 MB in `php.ini` (`upload_max_filesize = 10M`, `post_max_size = 12M`). Without `omr_command`, the editor's *Scan sheet music* command says scanning is not set up.

## 10. Production checklist

- [ ] HTTPS only. The session cookie is marked `Secure` when the request is HTTPS.
- [ ] The security headers arrive (section 5): `curl -I` an HTML page and look for `X-Frame-Options` and `Strict-Transport-Security`.
- [ ] Email works (section 6): `mail_from`, `site_url` and `smtp_*` are set; **Forgot your password?** delivers a link to a real inbox, not to spam.
- [ ] `PIANISSIMO_DEBUG` is **not** set, so error messages stay generic.
- [ ] `server/data/` cannot be downloaded. Check that requesting `/server/data/pianissimo.sqlite` returns 403 or 404.
- [ ] `server/cron/backup.php` runs every night, the backups are copied off the server, and you have tried a restore (section 3).
- [ ] Behind a proxy or CDN: `trusted_proxies` is set (section 8). Check that signing in from two networks is limited separately.
- [ ] Someone looks at **admin.html → Errors** regularly, or `alert_webhook` posts new errors to your team's chat (section 7).
- [ ] `max_score_bytes`, `max_scores_per_user` and the `auth_attempts_*` / `registrations_per_ip_15min` limits in `config.local.php` suit your traffic.
- [ ] Sound samples load from `tonejs.github.io` and `gleitz.github.io`; the built-in policy allows them. If you add a stricter policy of your own, allow those hosts in `connect-src` and `media-src`, or self-host the samples.
- [ ] Serve `sw.js` (in `dist/`) with `Cache-Control: no-cache`, so a new build's service worker is picked up straight away. Browsers already re-check it at least once a day.
- [ ] `mail_from` is an address your domain may send from (SPF/DKIM).
- [ ] At least one admin is listed in `admins`, so reports get reviewed.
- [ ] If people may choose daily email summaries: `server/cron/digest.php` runs once a day.
- [ ] **Privacy and Terms reviewed by you** (and translated versions checked): add your name, contact details and governing law. The texts shipped are drafts that describe the software, not legal advice.
- [ ] If you run live co-editing: the secret is long and random, the same on both sides, never committed; the service is only reachable through your HTTPS proxy; `ALLOWED_ORIGINS` is set.

## 11. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request. It:

1. installs dependencies with `npm ci`;
2. runs `npm run lint`: type-checks the app and the tests (strict settings), then `scripts/lint.mjs`, which checks project rules — no `eval`, no `debugger` or `.only`, `rel="noopener"` on new-tab links, every toast message translated, PHP with strict types and no request input inside SQL text, no private keys, tidy whitespace — and runs `php -l` on every server file;
3. checks that the Node scripts parse;
4. runs the unit tests and the PHP API integration test, which starts `php -S` with a temporary SQLite database and the realtime service;
5. builds the app;
6. runs the end-to-end browser tests (`npm run e2e`):
   - headless Chrome, driven over the DevTools protocol by `scripts/e2e.mjs`, with no extra dependencies;
   - against the build, a throw-away PHP API and the realtime service;
   - covers the website, editing, sharing, two people co-editing live, the embed and offline use;
7. keeps `dist/` as a downloadable artifact for 7 days.

A second job runs the API tests (including backup and restore) against MySQL 8. Locally: `TEST_DB_DSN='mysql:host=127.0.0.1;dbname=pianissimo_test' TEST_DB_USER=root npx vitest run src/cloud/server.test.ts`, with an empty database.
