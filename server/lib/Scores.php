<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/** Score library: ownership-checked CRUD, sharing and the public listing. */
final class Scores
{
    private const VISIBILITY = ['private', 'unlisted', 'public'];
    private const META = 'id, title, composer, visibility, slug, revision, created_at, updated_at';
    /** A new history entry is kept at most this often while someone keeps saving. */
    private const VERSION_EVERY_SECONDS = 300;
    private const MAX_VERSIONS = 50;

    public function __construct(private PDO $db, private array $config)
    {
    }

    public function list(int $userId): array
    {
        $st = $this->db->prepare('SELECT ' . self::META . ' FROM scores WHERE user_id = ? ORDER BY updated_at DESC');
        $st->execute([$userId]);
        return array_map([$this, 'meta'], $st->fetchAll());
    }

    public function create(int $userId, mixed $data): array
    {
        $count = $this->db->prepare('SELECT COUNT(*) FROM scores WHERE user_id = ?');
        $count->execute([$userId]);
        if ((int) $count->fetchColumn() >= $this->config['max_scores_per_user']) {
            throw new HttpError(403, 'Your library is full. Delete some scores first.');
        }
        [$json, $title, $composer] = $this->validate($data);
        $now = Http::now();
        $st = $this->db->prepare(
            'INSERT INTO scores (user_id, title, composer, data, visibility, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        );
        $st->execute([$userId, $title, $composer, $json, 'private', $this->uniqueSlug(), $now, $now]);
        return $this->metaById((int) $this->db->lastInsertId(), $userId);
    }

    public function get(int $id, int $userId): array
    {
        $row = $this->owned($id, $userId, ', data');
        $meta = $this->meta($row);
        $meta['data'] = json_decode($row['data'], true);
        return $meta;
    }

    /** Metadata only (cheap; used to notice saves made elsewhere). */
    public function info(int $id, int $userId): array
    {
        return $this->metaById($id, $userId);
    }

    public function update(int $id, int $userId, array $patch): array
    {
        $current = $this->owned($id, $userId, ', data');
        $sets = [];
        $args = [];
        if (array_key_exists('data', $patch)) {
            // optimistic concurrency: refuse to overwrite a newer save made elsewhere
            $base = $patch['base_revision'] ?? null;
            if ($base !== null && empty($patch['force']) && (int) $base !== (int) $current['revision']) {
                throw new HttpError(409, 'This score was changed in another tab or device since you opened it.');
            }
            [$json, $title, $composer] = $this->validate($patch['data']);
            if ($json !== $current['data']) {
                $this->snapshot($id, $current);
                array_push($sets, 'data = ?', 'title = ?', 'composer = ?', 'revision = revision + 1');
                array_push($args, $json, $title, $composer);
            }
        }
        if (array_key_exists('visibility', $patch)) {
            if (!in_array($patch['visibility'], self::VISIBILITY, true)) {
                throw new HttpError(422, 'Unknown sharing setting.');
            }
            $sets[] = 'visibility = ?';
            $args[] = $patch['visibility'];
        }
        if (!$sets) {
            if (array_key_exists('data', $patch)) {
                return $this->meta($current); // saved data was identical
            }
            throw new HttpError(422, 'Nothing to update.');
        }
        $sets[] = 'updated_at = ?';
        $args[] = Http::now();
        $args[] = $id;
        $this->db->prepare('UPDATE scores SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($args);
        return $this->metaById($id, $userId);
    }

    /** Earlier versions of a score, newest first (without their data). */
    public function versions(int $id, int $userId): array
    {
        $this->owned($id, $userId);
        $st = $this->db->prepare('SELECT id, title, created_at FROM score_versions WHERE score_id = ? ORDER BY id DESC');
        $st->execute([$id]);
        return array_map(fn ($r) => ['id' => (int) $r['id'], 'title' => $r['title'], 'created_at' => $r['created_at']], $st->fetchAll());
    }

    /** One earlier version with its data. */
    public function version(int $id, int $versionId, int $userId): array
    {
        $this->owned($id, $userId);
        $st = $this->db->prepare('SELECT id, title, data, created_at FROM score_versions WHERE id = ? AND score_id = ?');
        $st->execute([$versionId, $id]);
        $row = $st->fetch();
        if (!$row) {
            throw new HttpError(404, 'That version no longer exists.');
        }
        return ['id' => (int) $row['id'], 'title' => $row['title'], 'created_at' => $row['created_at'], 'data' => json_decode($row['data'], true)];
    }

    /** Keep the state before a save, unless a version was kept only moments ago. */
    private function snapshot(int $id, array $current): void
    {
        $last = $this->db->prepare('SELECT created_at FROM score_versions WHERE score_id = ? ORDER BY id DESC LIMIT 1');
        $last->execute([$id]);
        $at = $last->fetchColumn();
        if ($at !== false && time() - strtotime((string) $at) < self::VERSION_EVERY_SECONDS) {
            return;
        }
        $this->db->prepare('INSERT INTO score_versions (score_id, title, data, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$id, $current['title'], $current['data'], $current['updated_at']]);
        $old = $this->db->prepare('SELECT id FROM score_versions WHERE score_id = ? ORDER BY id DESC LIMIT 1000 OFFSET ' . self::MAX_VERSIONS);
        $old->execute([$id]);
        $del = $this->db->prepare('DELETE FROM score_versions WHERE id = ?');
        foreach ($old->fetchAll(PDO::FETCH_COLUMN) as $vid) {
            $del->execute([$vid]);
        }
    }

    public function delete(int $id, int $userId): void
    {
        $this->owned($id, $userId);
        $this->db->prepare('DELETE FROM scores WHERE id = ?')->execute([$id]);
    }

    public function duplicate(int $id, int $userId): array
    {
        $row = $this->owned($id, $userId, ', data');
        $data = json_decode($row['data'], true);
        $data['title'] = mb_substr(($data['title'] ?? 'Untitled') . ' (copy)', 0, 200);
        return $this->create($userId, $data);
    }

    /** A shared score (unlisted or public) by its slug, with the author's display name. */
    public function publicBySlug(string $slug): array
    {
        $st = $this->db->prepare(
            "SELECT s.slug, s.title, s.composer, s.data, s.updated_at, u.name AS author
             FROM scores s JOIN users u ON u.id = s.user_id
             WHERE s.slug = ? AND s.visibility IN ('public', 'unlisted')",
        );
        $st->execute([$slug]);
        $row = $st->fetch();
        if (!$row) {
            throw new HttpError(404, 'This score does not exist or is no longer shared.');
        }
        $row['data'] = json_decode($row['data'], true);
        return $row;
    }

    /** Public scores, newest first, optionally filtered by title or composer. */
    public function publicList(string $query): array
    {
        $sql = "SELECT s.slug, s.title, s.composer, s.updated_at, u.name AS author
                FROM scores s JOIN users u ON u.id = s.user_id WHERE s.visibility = 'public'";
        $args = [];
        $query = trim($query);
        if ($query !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], mb_substr($query, 0, 80)) . '%';
            $sql .= " AND (s.title LIKE ? ESCAPE '\\' OR s.composer LIKE ? ESCAPE '\\')";
            array_push($args, $like, $like);
        }
        $sql .= ' ORDER BY s.updated_at DESC LIMIT 60';
        $st = $this->db->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    // ------------------------------------------------------------------ helpers

    /** Check the score is a Pianissimo document; returns [json, title, composer]. */
    private function validate(mixed $data): array
    {
        if (
            !is_array($data) || ($data['version'] ?? null) !== 1 || !is_array($data['measures'] ?? null)
            || !is_array($data['staves'] ?? null) || count($data['staves']) < 1 || count($data['staves']) > 16
            || count($data['measures']) > 5000
        ) {
            throw new HttpError(422, 'This is not a valid Pianissimo score.');
        }
        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false || strlen($json) > $this->config['max_score_bytes']) {
            throw new HttpError(413, 'That score is too large to save.');
        }
        $title = trim((string) ($data['title'] ?? '')) ?: 'Untitled score';
        return [$json, mb_substr($title, 0, 200), mb_substr(trim((string) ($data['composer'] ?? '')), 0, 200)];
    }

    private function owned(int $id, int $userId, string $extra = ''): array
    {
        $st = $this->db->prepare('SELECT ' . self::META . $extra . ', user_id FROM scores WHERE id = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        // same answer for "missing" and "someone else's", so ids cannot be probed
        if (!$row || (int) $row['user_id'] !== $userId) {
            throw new HttpError(404, 'Score not found.');
        }
        return $row;
    }

    private function metaById(int $id, int $userId): array
    {
        return $this->meta($this->owned($id, $userId));
    }

    private function meta(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'title' => $row['title'],
            'composer' => $row['composer'],
            'visibility' => $row['visibility'],
            'slug' => $row['slug'],
            'revision' => (int) ($row['revision'] ?? 1),
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    private function uniqueSlug(): string
    {
        $st = $this->db->prepare('SELECT 1 FROM scores WHERE slug = ?');
        do {
            $slug = Http::slug(10);
            $st->execute([$slug]);
        } while ($st->fetch());
        return $slug;
    }
}
