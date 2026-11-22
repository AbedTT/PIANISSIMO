<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/** PDO connection with an automatic, idempotent schema migration (SQLite or MySQL). */
final class Db
{
    private static ?PDO $pdo = null;

    public static function get(array $config): PDO
    {
        if (self::$pdo) {
            return self::$pdo;
        }
        $dsn = $config['db_dsn'];
        if (str_starts_with($dsn, 'sqlite:')) {
            $file = substr($dsn, 7);
            if (!is_dir(dirname($file))) {
                mkdir(dirname($file), 0770, true);
            }
        }
        $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 3000');
        }
        self::migrate($pdo, $driver);
        return self::$pdo = $pdo;
    }

    private static function migrate(PDO $pdo, string $driver): void
    {
        $id = $driver === 'mysql' ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        $fk = $driver === 'mysql' ? 'INT UNSIGNED' : 'INTEGER';
        $text = $driver === 'mysql' ? 'LONGTEXT' : 'TEXT';
        $str = fn (int $n) => $driver === 'mysql' ? "VARCHAR($n)" : 'TEXT';
        $engine = $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';

        $pdo->exec("CREATE TABLE IF NOT EXISTS users (
            id $id,
            email {$str(254)} NOT NULL UNIQUE,
            name {$str(60)} NOT NULL,
            password_hash {$str(255)} NOT NULL,
            created_at {$str(25)} NOT NULL
        )$engine");

        $pdo->exec("CREATE TABLE IF NOT EXISTS scores (
            id $id,
            user_id $fk NOT NULL,
            title {$str(200)} NOT NULL,
            composer {$str(200)} NOT NULL DEFAULT '',
            data $text NOT NULL,
            visibility {$str(10)} NOT NULL DEFAULT 'private',
            slug {$str(16)} NOT NULL UNIQUE,
            created_at {$str(25)} NOT NULL,
            updated_at {$str(25)} NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");

        // earlier versions of a score (version history), newest kept, oldest pruned
        $pdo->exec("CREATE TABLE IF NOT EXISTS score_versions (
            id $id,
            score_id $fk NOT NULL,
            title {$str(200)} NOT NULL,
            data $text NOT NULL,
            created_at {$str(25)} NOT NULL,
            FOREIGN KEY (score_id) REFERENCES scores(id) ON DELETE CASCADE
        )$engine");

        // revision counter for conflict detection (added after the first release)
        try {
            $pdo->exec('ALTER TABLE scores ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
        } catch (\PDOException) {
            // column already exists
        }

        $pdo->exec("CREATE TABLE IF NOT EXISTS auth_attempts (
            id $id,
            ip {$str(45)} NOT NULL,
            action {$str(20)} NOT NULL,
            created_at {$str(25)} NOT NULL
        )$engine");

        // indexes (CREATE INDEX IF NOT EXISTS is SQLite-only; MySQL ignores duplicates via try/catch)
        foreach ([
            'CREATE INDEX idx_scores_user ON scores(user_id)',
            'CREATE INDEX idx_scores_public ON scores(visibility, updated_at)',
            'CREATE INDEX idx_attempts ON auth_attempts(ip, action, created_at)',
            'CREATE INDEX idx_versions_score ON score_versions(score_id, created_at)',
        ] as $sql) {
            try {
                $pdo->exec($driver === 'sqlite' ? str_replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS', $sql) : $sql);
            } catch (\PDOException) {
                // index already exists (MySQL)
            }
        }
    }
}
