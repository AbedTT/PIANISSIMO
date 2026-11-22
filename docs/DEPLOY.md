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

## 4. Production checklist

- [ ] HTTPS only. The session cookie is marked `Secure` when the request is HTTPS.
- [ ] `PIANISSIMO_DEBUG` is **not** set, so error messages stay generic.
- [ ] `server/data/` cannot be downloaded. Check that requesting `/server/data/pianissimo.sqlite` returns 403 or 404.
- [ ] The database is backed up. For SQLite, copy `server/data/pianissimo.sqlite` while the site is quiet, or use `sqlite3 .backup`.
- [ ] `max_score_bytes`, `max_scores_per_user` and `auth_attempts_per_15min` in `config.local.php` suit your traffic.
- [ ] Sound samples load from `tonejs.github.io` and `gleitz.github.io`. If your Content-Security-Policy restricts `connect-src` or `media-src`, allow those hosts or self-host the samples.

## 5. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request. It:

1. installs dependencies with `npm ci`;
2. runs `php -l` on every server file;
3. type-checks the code;
4. runs the unit tests and the PHP API integration test (which starts `php -S` with a temporary SQLite database);
5. builds the app and keeps `dist/` as a downloadable artifact for 7 days.

Browser end-to-end tests (Playwright) are not part of CI yet. See `docs/ROADMAP.md`.
