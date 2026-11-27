<?php
/**
 * Back up the database. Run it daily from cron, for example:
 *
 *   30 3 * * *  php /var/www/pianissimo/server/cron/backup.php
 *
 * Writes server/data/backups/pianissimo-<date>-<time>.jsonl.gz and keeps the newest 14.
 * Options: --dir=/somewhere/else  --keep=30
 *
 * The same file restores into SQLite or MySQL/MariaDB (see restore.php). Copy the backups to
 * another machine or to cloud storage too: a backup on the same disk does not survive the disk.
 */
declare(strict_types=1);

namespace Pianissimo;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

require __DIR__ . '/../lib/Http.php';
require __DIR__ . '/../lib/Db.php';
require __DIR__ . '/../lib/Backup.php';

$opts = getopt('', ['dir:', 'keep:']);
$config = require __DIR__ . '/../config.php';
$dir = (string) ($opts['dir'] ?? ($config['backup_dir'] ?? '') ?: __DIR__ . '/../data/backups');
$keep = (int) ($opts['keep'] ?? ($config['backup_keep'] ?? 14));
if (!is_dir($dir) && !mkdir($dir, 0770, true)) {
    fwrite(STDERR, "Pianissimo: cannot create $dir\n");
    exit(1);
}

$file = rtrim($dir, '/\\') . '/pianissimo-' . gmdate('Ymd-His') . '.jsonl.gz';
try {
    $counts = (new Backup(Db::get($config)))->dump($file);
} catch (\Throwable $e) {
    fwrite(STDERR, 'Pianissimo: backup failed: ' . $e->getMessage() . "\n");
    exit(1);
}
$gone = Backup::prune($dir, $keep);
fwrite(STDOUT, sprintf(
    "Pianissimo: backed up %d accounts, %d scores (%s, %.1f MB)%s\n",
    $counts['users'],
    $counts['scores'],
    basename($file),
    filesize($file) / 1048576,
    $gone ? ", removed $gone old backup(s)" : '',
));
