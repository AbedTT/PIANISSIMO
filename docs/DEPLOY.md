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

To use a different API location, set it before the app scripts load. For example, add this to the `<head>` of each HTML page in `dist/`:

```html
<script>window.PIANISSIMO_API = 'https://api.example.com/api/index.php';</script>
```

If the API is on a different origin, it must also send CORS headers that allow credentials. The simplest setup is to serve both from one origin.

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

The tables are created and upgraded automatically on the first request, including the version-history table and the `revision` column added in Phase 14.

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

## 5. Notifications by email and admins (optional)

Add these to `server/config.local.php`, or set the environment variables:

| Setting | Environment variable | What it does |
|---|---|---|
| `mail_from` | `PIANISSIMO_MAIL_FROM` | Sender address. Leave it empty and no email is sent; notifications then stay in the app (🔔). Sending uses PHP's `mail()`, so the server needs a working mail setup (sendmail, or an SMTP relay configured in `php.ini`) |
| `site_url` | `PIANISSIMO_SITE_URL` | Address of the site (e.g. `https://music.example.com/`), so links in emails work |
| `admins` | `PIANISSIMO_ADMINS` | Account emails, separated by commas, that may open `admin.html` and review reported comments and scores |

### Daily email summaries

People can choose a daily summary instead of one email per event. Run the digest once a day:

```cron
15 7 * * *  php /var/www/pianissimo/server/cron/digest.php
```

It needs `mail_from`, and refuses to run from the web (`server/cron/` is also blocked by `.htaccess`). For development, set `mail_log` (`PIANISSIMO_MAIL_LOG`) to a file path: emails are written there instead of being sent.

## 6. Scanning sheet music (optional)

Install [Audiveris](https://github.com/Audiveris/audiveris) (open source, needs Java) on the server. Then set `omr_command` (`PIANISSIMO_OMR_COMMAND`):

```php
'omr_command' => '/opt/audiveris/bin/Audiveris -batch -export -output {out} {in}',
'omr_timeout' => 180, // seconds
```

`{in}` is replaced by the uploaded file, `{out}` by a fresh folder; any `.mxl`/`.musicxml` written into it is returned. Allow uploads of 10 MB in `php.ini` (`upload_max_filesize = 10M`, `post_max_size = 12M`). Without `omr_command`, the editor's *Scan sheet music* command says scanning is not set up.

## 7. Production checklist

- [ ] HTTPS only. The session cookie is marked `Secure` when the request is HTTPS.
- [ ] `PIANISSIMO_DEBUG` is **not** set, so error messages stay generic.
- [ ] `server/data/` cannot be downloaded. Check that requesting `/server/data/pianissimo.sqlite` returns 403 or 404.
- [ ] The database is backed up. For SQLite, copy `server/data/pianissimo.sqlite` while the site is quiet, or use `sqlite3 .backup`.
- [ ] `max_score_bytes`, `max_scores_per_user` and `auth_attempts_per_15min` in `config.local.php` suit your traffic.
- [ ] Sound samples load from `tonejs.github.io` and `gleitz.github.io`. If your Content-Security-Policy restricts `connect-src` or `media-src`, allow those hosts or self-host the samples.
- [ ] Serve `sw.js` (in `dist/`) with `Cache-Control: no-cache`, so a new build's service worker is picked up straight away. Browsers already re-check it at least once a day.
- [ ] If you send email: `mail_from` is an address your domain may send from (SPF/DKIM), and `site_url` is set.
- [ ] At least one admin is listed in `admins`, so reports get reviewed.
- [ ] If people may choose daily email summaries: `server/cron/digest.php` runs once a day.
- [ ] **Privacy and Terms reviewed by you** (and translated versions checked): add your name, contact details and governing law. The texts shipped are drafts that describe the software, not legal advice.
- [ ] If you run live co-editing: the secret is long and random, the same on both sides, never committed; the service is only reachable through your HTTPS proxy; `ALLOWED_ORIGINS` is set.

## 8. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request. It:

1. installs dependencies with `npm ci`;
2. runs `php -l` on every server file;
3. type-checks the code;
4. runs the unit tests and the PHP API integration test, which starts `php -S` with a temporary SQLite database and the realtime service;
5. builds the app;
6. runs the end-to-end browser tests (`npm run e2e`):
   - headless Chrome, driven over the DevTools protocol by `scripts/e2e.mjs`, with no extra dependencies;
   - against the build, a throw-away PHP API and the realtime service;
   - covers the website, editing, sharing, two people co-editing live, the embed and offline use;
7. keeps `dist/` as a downloadable artifact for 7 days.
