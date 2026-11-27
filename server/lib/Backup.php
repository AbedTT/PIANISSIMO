<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * Backups that work the same on SQLite and MySQL/MariaDB: every row of every table, one JSON
 * object per line, gzip-compressed. Because the format does not depend on the database, a
 * backup taken on SQLite restores into MySQL: that is how a site moves to MySQL.
 *
 * Rows are read and written one at a time, so large libraries do not need much memory.
 * Sign-in attempt counters are not kept (they expire within the hour anyway).
 */
final class Backup
{
    /** Every table, parents before children (the order foreign keys need). */
    public const TABLES = [
        'users', 'scores', 'score_versions', 'score_likes', 'public_comments', 'reports', 'score_editors',
        'classes', 'class_members', 'assignments', 'submissions', 'notifications', 'account_tokens', 'error_reports',
    ];
    private const FORMAT = 'pianissimo-backup';

    public function __construct(private PDO $db)
    {
    }

    /** Write a backup to `$file` (.jsonl.gz); returns the number of rows per table. */
    public function dump(string $file): array
    {
        $part = "$file.part";
        $gz = gzopen($part, 'wb6');
        if ($gz === false) {
            throw new \RuntimeException("cannot write $part");
        }
        $counts = [];
        try {
            gzwrite($gz, json_encode(['format' => self::FORMAT, 'version' => 1, 'created' => Http::now(), 'driver' => $this->driver()]) . "\n");
            foreach (self::TABLES as $table) {
                $counts[$table] = 0;
                // link tables (likes, editors, members) have no id of their own
                $order = in_array('id', $this->columns($table), true) ? ' ORDER BY id' : '';
                $st = $this->db->query("SELECT * FROM $table$order");
                while (($row = $st->fetch(PDO::FETCH_ASSOC)) !== false) {
                    gzwrite($gz, json_encode(['t' => $table, 'r' => $row], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) . "\n");
                    $counts[$table]++;
                }
            }
        } finally {
            gzclose($gz);
        }
        if (!rename($part, $file)) {
            throw new \RuntimeException("cannot rename $part");
        }
        return $counts;
    }

    /**
     * Load a backup into this database. It must be empty (a fresh install), unless `$replace`
     * is set: then everything in it is deleted first. All or nothing: one transaction.
     */
    public function restore(string $file, bool $replace = false): array
    {
        $gz = gzopen($file, 'rb');
        if ($gz === false) {
            throw new \RuntimeException("cannot read $file");
        }
        $head = json_decode((string) gzgets($gz), true);
        if (($head['format'] ?? '') !== self::FORMAT) {
            gzclose($gz);
            throw new \RuntimeException("$file is not a Pianissimo backup");
        }
        if (!$replace && (int) $this->db->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
            gzclose($gz);
            throw new \RuntimeException('this database already has accounts: restore into an empty one, or pass --replace to delete everything in it first');
        }
        $mysql = $this->driver() === 'mysql';
        // rows arrive in parent-first order, but a table may refer to itself or to a later one
        $this->db->exec($mysql ? 'SET FOREIGN_KEY_CHECKS = 0' : 'PRAGMA foreign_keys = OFF');
        $counts = array_fill_keys(self::TABLES, 0);
        $columns = [];
        $inserts = [];
        $this->db->beginTransaction();
        try {
            if ($replace) {
                foreach (array_reverse(self::TABLES) as $table) {
                    $this->db->exec("DELETE FROM $table");
                }
            }
            while (($line = gzgets($gz)) !== false) {
                if (trim($line) === '') {
                    continue;
                }
                $item = json_decode($line, true);
                $table = $item['t'] ?? '';
                if (!in_array($table, self::TABLES, true) || !is_array($item['r'] ?? null)) {
                    throw new \RuntimeException('unexpected line in the backup: ' . substr($line, 0, 80));
                }
                // only the columns this version of the database has (older backups lack newer ones)
                $columns[$table] ??= $this->columns($table);
                $row = array_intersect_key($item['r'], array_flip($columns[$table]));
                $key = $table . ':' . implode(',', array_keys($row));
                $inserts[$key] ??= $this->db->prepare(
                    "INSERT INTO $table (" . implode(', ', array_keys($row)) . ') VALUES (' . implode(', ', array_fill(0, count($row), '?')) . ')',
                );
                $inserts[$key]->execute(array_values($row));
                $counts[$table]++;
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        } finally {
            gzclose($gz);
            $this->db->exec($mysql ? 'SET FOREIGN_KEY_CHECKS = 1' : 'PRAGMA foreign_keys = ON');
        }
        return $counts;
    }

    /** Delete the oldest backups in a folder, keeping the newest `$keep`. Returns how many went. */
    public static function prune(string $dir, int $keep): int
    {
        $files = glob(rtrim($dir, '/\\') . '/pianissimo-*.jsonl.gz') ?: [];
        rsort($files); // the names start with the date, so newest first
        $gone = 0;
        foreach (array_slice($files, max(1, $keep)) as $old) {
            $gone += @unlink($old) ? 1 : 0;
        }
        return $gone;
    }

    private function driver(): string
    {
        return (string) $this->db->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    /** @return string[] */
    private function columns(string $table): array
    {
        $st = $this->db->query("SELECT * FROM $table WHERE 1 = 0");
        $out = [];
        for ($i = 0; $i < $st->columnCount(); $i++) {
            $out[] = $st->getColumnMeta($i)['name'];
        }
        return $out;
    }
}
