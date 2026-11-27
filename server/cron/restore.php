<?php
/**
 * Restore a backup made by backup.php into the database in the config:
 *
 *   php server/cron/restore.php server/data/backups/pianissimo-20261127-033000.jsonl.gz
 *
 * The database must be empty (a fresh install: the tables are created automatically), unless
 * you add --replace, which deletes everything in it first. All or nothing.
 *
 * Moving from SQLite to MySQL/MariaDB: run backup.php, point the config at MySQL
 * (db_dsn, db_user, db_pass in config.local.php), then run this with the backup file.
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

$args = array_values(array_filter(array_slice($argv, 1), fn ($a) => $a !== '--replace'));
$replace = in_array('--replace', $argv, true);
if (count($args) !== 1 || !is_file($args[0])) {
    fwrite(STDERR, "Usage: php server/cron/restore.php <backup.jsonl.gz> [--replace]\n");
    exit(1);
}

$config = require __DIR__ . '/../config.php';
try {
    $counts = (new Backup(Db::get($config)))->restore($args[0], $replace);
} catch (\Throwable $e) {
    fwrite(STDERR, 'Pianissimo: restore failed, nothing was changed: ' . $e->getMessage() . "\n");
    exit(1);
}
fwrite(STDOUT, sprintf("Pianissimo: restored %d accounts, %d scores and %d other rows\n", $counts['users'], $counts['scores'], array_sum($counts) - $counts['users'] - $counts['scores']));
