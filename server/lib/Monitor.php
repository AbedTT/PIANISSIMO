<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * Error reports: crashes in people's browsers (sent by src/monitor/errors.ts) and unexpected
 * exceptions in the API. Reports with the same message and place are grouped into one row
 * with a count, so admins see what breaks and how often (admin.html).
 *
 * Nothing personal is stored: the message, the stack trace (file names and lines), the page
 * (without its query or #part), the app version and the browser name. Never score content.
 * With `alert_webhook` set, the first report of each new error is also posted there
 * (Slack, Discord, Teams, or any URL that takes JSON).
 */
final class Monitor
{
    private const KEEP = 1000;
    private const PER_HOUR = 30;

    public function __construct(private PDO $db, private array $config)
    {
    }

    /** A report from a browser; throttled per address. */
    public function reportClient(array $in): void
    {
        if (empty($this->config['error_reports'] ?? true)) {
            return;
        }
        $who = 'err:' . Http::clientIp();
        $since = gmdate('Y-m-d\TH:i:s\Z', time() - 3600);
        $st = $this->db->prepare("SELECT COUNT(*) FROM auth_attempts WHERE ip = ? AND action = 'error' AND created_at > ?");
        $st->execute([$who, $since]);
        if ((int) $st->fetchColumn() >= self::PER_HOUR) {
            return; // quietly: a page in a crash loop must not fill the table
        }
        $this->db->prepare("INSERT INTO auth_attempts (ip, action, created_at) VALUES (?, 'error', ?)")->execute([$who, Http::now()]);
        $message = trim((string) ($in['message'] ?? ''));
        if ($message === '') {
            throw new HttpError(422, 'An error report needs a message.');
        }
        $this->record(
            'client',
            $message,
            (string) ($in['stack'] ?? ''),
            (string) ($in['page'] ?? ''),
            (string) ($in['version'] ?? ''),
            self::browser((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')),
        );
    }

    /** An unexpected exception in the API. Never throws: the request is failing already. */
    public function reportServer(\Throwable $e): void
    {
        try {
            $route = ($_SERVER['REQUEST_METHOD'] ?? '') . ' ' . preg_replace('/\d+/', '{id}', (string) ($_SERVER['PATH_INFO'] ?? ''));
            $where = basename($e->getFile()) . ':' . $e->getLine();
            $this->record('server', get_class($e) . ': ' . $e->getMessage(), $where . "\n" . $e->getTraceAsString(), $route, '', 'PHP ' . PHP_VERSION);
        } catch (\Throwable) {
            // the database itself may be what failed; the PHP error log has it anyway
        }
    }

    /** Grouped reports, the most recent first. */
    public function list(): array
    {
        $st = $this->db->query('SELECT id, source, message, stack, page, version, browser, count, first_seen, last_seen FROM error_reports ORDER BY last_seen DESC LIMIT 200');
        return array_map(fn ($r) => ['id' => (int) $r['id'], 'count' => (int) $r['count']] + $r, $st->fetchAll());
    }

    /** Mark one error (or, with null, all) as dealt with: removed until it happens again. */
    public function clear(?int $id): void
    {
        if ($id === null) {
            $this->db->exec('DELETE FROM error_reports');
            return;
        }
        $this->db->prepare('DELETE FROM error_reports WHERE id = ?')->execute([$id]);
    }

    private function record(string $source, string $message, string $stack, string $page, string $version, string $browser): void
    {
        $message = mb_substr(self::scrub($message), 0, 500);
        $stack = mb_substr(self::scrub($stack), 0, 4000);
        $page = mb_substr(preg_replace('/[?#].*$/s', '', $page) ?? '', 0, 200);
        $version = mb_substr(preg_replace('/[^0-9A-Za-z.+-]/', '', $version) ?? '', 0, 20);
        // the same message (numbers aside) at the same first place in the code is the same error
        $firstFrame = '';
        foreach (preg_split('/\R/', $stack) ?: [] as $line) {
            if (preg_match('/[\w.-]+\.(?:js|ts|php|mjs):\d+/', $line, $m)) {
                $firstFrame = $m[0];
                break;
            }
        }
        $fingerprint = hash('sha256', $source . '|' . preg_replace('/\d+/', '#', $message) . '|' . $firstFrame);
        $now = Http::now();
        $up = $this->db->prepare('UPDATE error_reports SET count = count + 1, last_seen = ?, version = ?, browser = ?, page = ? WHERE fingerprint = ?');
        $up->execute([$now, $version, $browser, $page, $fingerprint]);
        if ($up->rowCount() > 0) {
            return;
        }
        $this->db->prepare('INSERT INTO error_reports (fingerprint, source, message, stack, page, version, browser, count, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
            ->execute([$fingerprint, $source, $message, $stack, $page, $version, $browser, $now, $now]);
        // keep the table bounded
        $old = $this->db->query('SELECT id FROM error_reports ORDER BY last_seen DESC LIMIT 1000 OFFSET ' . self::KEEP)->fetchAll(PDO::FETCH_COLUMN);
        if ($old) {
            $this->db->exec('DELETE FROM error_reports WHERE id IN (' . implode(',', array_map('intval', $old)) . ')');
        }
        $this->alert($source, $message, $page, $version);
    }

    /** Post a new error to a chat webhook (first occurrence only; failures are ignored). */
    private function alert(string $source, string $message, string $page, string $version): void
    {
        $url = trim((string) ($this->config['alert_webhook'] ?? ''));
        if (!preg_match('#^https://#i', $url)) {
            return;
        }
        $text = "Pianissimo: new $source error" . ($version !== '' ? " in $version" : '') . ($page !== '' ? " on $page" : '') . "\n$message";
        // `text` for Slack and Teams, `content` for Discord
        $body = json_encode(['text' => $text, 'content' => mb_substr($text, 0, 1900)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        @file_get_contents($url, false, stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $body,
            'timeout' => 3,
            'ignore_errors' => true,
        ]]));
    }

    /** Remove things that may identify someone: email addresses, query strings, long tokens. */
    private static function scrub(string $text): string
    {
        $text = preg_replace('/[\w.+-]+@[\w-]+\.[\w.-]+/', '<email>', $text) ?? '';
        $text = preg_replace('/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/', '$1', $text) ?? '';
        return preg_replace('/\b[0-9a-f]{32,}\b/i', '<token>', $text) ?? '';
    }

    /** "Chrome 131", "Firefox 133", "Safari 18"… (not the whole user agent). */
    private static function browser(string $ua): string
    {
        foreach (['Edg' => 'Edge', 'OPR' => 'Opera', 'Firefox' => 'Firefox', 'Chrome' => 'Chrome', 'Version' => 'Safari'] as $token => $name) {
            if (preg_match('#' . $token . '/(\d+)#', $ua, $m)) {
                return "$name {$m[1]}" . (preg_match('/Mobile|Android|iPhone|iPad/', $ua) ? ' (mobile)' : '');
            }
        }
        return 'other';
    }
}
