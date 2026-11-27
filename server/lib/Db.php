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

        // community (Phase 23): remixes and hidden-after-reports flags
        foreach (['ALTER TABLE scores ADD COLUMN remix_of INTEGER NULL', 'ALTER TABLE scores ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0'] as $alter) {
            try {
                $pdo->exec($alter);
            } catch (\PDOException) {
                // column already exists
            }
        }
        $pdo->exec("CREATE TABLE IF NOT EXISTS score_likes (
            score_id $fk NOT NULL,
            user_id $fk NOT NULL,
            created_at {$str(25)} NOT NULL,
            PRIMARY KEY (score_id, user_id),
            FOREIGN KEY (score_id) REFERENCES scores(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");
        $pdo->exec("CREATE TABLE IF NOT EXISTS public_comments (
            id $id,
            score_id $fk NOT NULL,
            user_id $fk NOT NULL,
            text $text NOT NULL,
            hidden INTEGER NOT NULL DEFAULT 0,
            created_at {$str(25)} NOT NULL,
            FOREIGN KEY (score_id) REFERENCES scores(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");
        $pdo->exec("CREATE TABLE IF NOT EXISTS reports (
            kind {$str(10)} NOT NULL,
            target_id $fk NOT NULL,
            user_id $fk NOT NULL,
            created_at {$str(25)} NOT NULL,
            PRIMARY KEY (kind, target_id, user_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");

        // people the owner invited to edit a score with them
        $pdo->exec("CREATE TABLE IF NOT EXISTS score_editors (
            score_id $fk NOT NULL,
            user_id $fk NOT NULL,
            created_at {$str(25)} NOT NULL,
            PRIMARY KEY (score_id, user_id),
            FOREIGN KEY (score_id) REFERENCES scores(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");

        // teaching: classes, their students, assignments and the students' work
        $pdo->exec("CREATE TABLE IF NOT EXISTS classes (
            id $id,
            owner_id $fk NOT NULL,
            name {$str(80)} NOT NULL,
            join_code {$str(12)} NOT NULL UNIQUE,
            created_at {$str(25)} NOT NULL,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");
        $pdo->exec("CREATE TABLE IF NOT EXISTS class_members (
            class_id $fk NOT NULL,
            user_id $fk NOT NULL,
            joined_at {$str(25)} NOT NULL,
            PRIMARY KEY (class_id, user_id),
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");
        $pdo->exec("CREATE TABLE IF NOT EXISTS assignments (
            id $id,
            class_id $fk NOT NULL,
            title {$str(120)} NOT NULL,
            instructions $text NOT NULL,
            data $text NOT NULL,
            due_at {$str(25)} NULL,
            created_at {$str(25)} NOT NULL,
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
        )$engine");
        $pdo->exec("CREATE TABLE IF NOT EXISTS submissions (
            id $id,
            assignment_id $fk NOT NULL,
            user_id $fk NOT NULL,
            score_id $fk NOT NULL,
            status {$str(12)} NOT NULL DEFAULT 'working',
            feedback $text NULL,
            submitted_at {$str(25)} NULL,
            returned_at {$str(25)} NULL,
            UNIQUE (assignment_id, user_id),
            FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (score_id) REFERENCES scores(id) ON DELETE CASCADE
        )$engine");

        // notifications (Phase 26)
        $pdo->exec("CREATE TABLE IF NOT EXISTS notifications (
            id $id,
            user_id $fk NOT NULL,
            kind {$str(20)} NOT NULL,
            text {$str(300)} NOT NULL,
            link {$str(300)} NOT NULL,
            created_at {$str(25)} NOT NULL,
            read_at {$str(25)} NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");
        foreach ([
            'ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1',
            // email language and daily digests
            "ALTER TABLE users ADD COLUMN lang VARCHAR(5) NOT NULL DEFAULT 'en'",
            // the last notification a daily digest included (ids, not times: no gaps or repeats)
            'ALTER TABLE users ADD COLUMN digest_last_id INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE notifications ADD COLUMN params TEXT NULL',
        ] as $alter) {
            try {
                $pdo->exec($alter);
            } catch (\PDOException) {
                // column already exists
            }
        }

        // marking (Phase 25): criteria on assignments, grades and marks on submissions
        foreach ([
            'ALTER TABLE assignments ADD COLUMN rubric TEXT NULL',
            'ALTER TABLE submissions ADD COLUMN grade VARCHAR(20) NULL',
            'ALTER TABLE submissions ADD COLUMN marks TEXT NULL',
        ] as $alter) {
            try {
                $pdo->exec($alter);
            } catch (\PDOException) {
                // column already exists
            }
        }

        // account recovery (Phase 32): confirmed email, and a counter that a password change
        // raises so every older session of that account is signed out
        foreach ([
            'ALTER TABLE users ADD COLUMN email_verified_at VARCHAR(25) NULL',
            'ALTER TABLE users ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0',
        ] as $alter) {
            try {
                $pdo->exec($alter);
            } catch (\PDOException) {
                // column already exists
            }
        }
        // one-time links sent by email; only a hash of the token is stored
        $pdo->exec("CREATE TABLE IF NOT EXISTS account_tokens (
            id $id,
            user_id $fk NOT NULL,
            purpose {$str(10)} NOT NULL,
            token_hash {$str(64)} NOT NULL UNIQUE,
            created_at {$str(25)} NOT NULL,
            expires_at {$str(25)} NOT NULL,
            used_at {$str(25)} NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$engine");

        // error reports from browsers and the API, grouped (Phase 33)
        $pdo->exec("CREATE TABLE IF NOT EXISTS error_reports (
            id $id,
            fingerprint {$str(64)} NOT NULL UNIQUE,
            source {$str(10)} NOT NULL,
            message {$str(500)} NOT NULL,
            stack $text NOT NULL,
            page {$str(200)} NOT NULL DEFAULT '',
            version {$str(20)} NOT NULL DEFAULT '',
            browser {$str(40)} NOT NULL DEFAULT '',
            count INTEGER NOT NULL DEFAULT 1,
            first_seen {$str(25)} NOT NULL,
            last_seen {$str(25)} NOT NULL
        )$engine");

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
            'CREATE INDEX idx_editors_user ON score_editors(user_id)',
            'CREATE INDEX idx_members_user ON class_members(user_id)',
            'CREATE INDEX idx_comments_score ON public_comments(score_id)',
            'CREATE INDEX idx_notifications_user ON notifications(user_id, id)',
            'CREATE INDEX idx_comments_user ON public_comments(user_id, created_at)',
            'CREATE INDEX idx_submissions_score ON submissions(score_id)',
            'CREATE INDEX idx_tokens_user ON account_tokens(user_id, purpose, created_at)',
            'CREATE INDEX idx_errors_seen ON error_reports(last_seen)',
        ] as $sql) {
            try {
                $pdo->exec($driver === 'sqlite' ? str_replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS', $sql) : $sql);
            } catch (\PDOException) {
                // index already exists (MySQL)
            }
        }
    }
}
