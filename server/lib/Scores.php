<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * Score library: CRUD with access checks, sharing, editors and the public listing.
 * The owner can do everything; invited editors can open, save, see the history and
 * co-edit, but not delete, change who sees it, or manage editors.
 */
final class Scores
{
    private const VISIBILITY = ['private', 'unlisted', 'public'];
    private const META = 'id, title, composer, visibility, slug, revision, created_at, updated_at';
    private const META_S = 's.id, s.title, s.composer, s.visibility, s.slug, s.revision, s.created_at, s.updated_at';
    /** A new history entry is kept at most this often while someone keeps saving. */
    private const VERSION_EVERY_SECONDS = 300;
    private const MAX_VERSIONS = 50;

    public function __construct(private PDO $db, private array $config, private ?Notify $notify = null)
    {
    }

    /** Own scores and scores shared with this user for editing, most recently changed first. */
    public function list(int $userId): array
    {
        $st = $this->db->prepare(
            'SELECT ' . self::META_S . ", 'owner' AS role, '' AS owner_name FROM scores s WHERE s.user_id = ?
             UNION ALL
             SELECT " . self::META_S . ", 'editor' AS role, u.name AS owner_name
             FROM scores s JOIN score_editors e ON e.score_id = s.id JOIN users u ON u.id = s.user_id WHERE e.user_id = ?
             ORDER BY updated_at DESC",
        );
        $st->execute([$userId, $userId]);
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
        $row = $this->accessible($id, $userId, ', data');
        $meta = $this->meta($row);
        $meta['data'] = json_decode($row['data'], true);
        return $meta;
    }

    /** Metadata only (cheap; used to notice saves made elsewhere). */
    public function info(int $id, int $userId): array
    {
        return $this->meta($this->accessible($id, $userId));
    }

    public function update(int $id, int $userId, array $patch): array
    {
        $current = $this->accessible($id, $userId, ', data');
        if (array_key_exists('visibility', $patch) && $current['role'] !== 'owner') {
            throw new HttpError(403, 'Only the owner can change who sees this score.');
        }
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
        return $this->meta($this->accessible($id, $userId));
    }

    /** Earlier versions of a score, newest first (without their data). */
    public function versions(int $id, int $userId): array
    {
        $this->accessible($id, $userId);
        $st = $this->db->prepare('SELECT id, title, created_at FROM score_versions WHERE score_id = ? ORDER BY id DESC');
        $st->execute([$id]);
        return array_map(fn ($r) => ['id' => (int) $r['id'], 'title' => $r['title'], 'created_at' => $r['created_at']], $st->fetchAll());
    }

    /** One earlier version with its data. */
    public function version(int $id, int $versionId, int $userId): array
    {
        $this->accessible($id, $userId);
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

    /** A copy in the user's own library (also of a score someone shared with them). */
    public function duplicate(int $id, int $userId): array
    {
        $row = $this->accessible($id, $userId, ', data');
        $data = json_decode($row['data'], true);
        $data['title'] = mb_substr(($data['title'] ?? 'Untitled') . ' (copy)', 0, 200);
        return $this->create($userId, $data);
    }

    /**
     * A shared score (unlisted or public) by its slug: the author, likes (and whether the
     * viewer liked it), and the score it is a remix of, when that one is still shared.
     */
    public function publicBySlug(string $slug, ?int $viewerId = null): array
    {
        $st = $this->db->prepare(
            "SELECT s.id, s.slug, s.title, s.composer, s.data, s.updated_at, s.visibility, s.remix_of, u.name AS author, u.id AS author_id,
                    (SELECT COUNT(*) FROM score_likes l WHERE l.score_id = s.id) AS likes
             FROM scores s JOIN users u ON u.id = s.user_id
             WHERE s.slug = ? AND s.visibility IN ('public', 'unlisted')",
        );
        $st->execute([$slug]);
        $row = $st->fetch();
        if (!$row) {
            throw new HttpError(404, 'This score does not exist or is no longer shared.');
        }
        $out = self::publicRow($row);
        $out['data'] = json_decode($row['data'], true);
        $out['visibility'] = $row['visibility'];
        $liked = false;
        if ($viewerId !== null) {
            $l = $this->db->prepare('SELECT 1 FROM score_likes WHERE score_id = ? AND user_id = ?');
            $l->execute([$row['id'], $viewerId]);
            $liked = (bool) $l->fetch();
        }
        $out['liked'] = $liked;
        $out['remix_of'] = null;
        if ($row['remix_of']) {
            $o = $this->db->prepare(
                "SELECT s.slug, s.title, u.name AS author FROM scores s JOIN users u ON u.id = s.user_id
                 WHERE s.id = ? AND s.visibility IN ('public', 'unlisted')",
            );
            $o->execute([$row['remix_of']]);
            $out['remix_of'] = $o->fetch() ?: null;
        }
        $out['id'] = (int) $row['id'];
        return $out;
    }

    /** The public fields of a shared score's row. */
    public static function publicRow(array $r): array
    {
        return [
            'slug' => $r['slug'],
            'title' => $r['title'],
            'composer' => $r['composer'],
            'updated_at' => $r['updated_at'],
            'author' => $r['author'],
            'author_id' => (int) $r['author_id'],
            'likes' => (int) $r['likes'],
        ];
    }

    /** Public scores, newest (or most liked) first, optionally filtered by title or composer. */
    public function publicList(string $query, string $sort = 'new'): array
    {
        $sql = "SELECT s.slug, s.title, s.composer, s.updated_at, u.name AS author, u.id AS author_id,
                       (SELECT COUNT(*) FROM score_likes l WHERE l.score_id = s.id) AS likes
                FROM scores s JOIN users u ON u.id = s.user_id WHERE s.visibility = 'public' AND s.hidden = 0";
        $args = [];
        $query = trim($query);
        if ($query !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], mb_substr($query, 0, 80)) . '%';
            $sql .= " AND (s.title LIKE ? ESCAPE '\\' OR s.composer LIKE ? ESCAPE '\\')";
            array_push($args, $like, $like);
        }
        $sql .= $sort === 'likes' ? ' ORDER BY likes DESC, s.updated_at DESC LIMIT 60' : ' ORDER BY s.updated_at DESC LIMIT 60';
        $st = $this->db->prepare($sql);
        $st->execute($args);
        return array_map([self::class, 'publicRow'], $st->fetchAll());
    }

    // ------------------------------------------------------------------ editors and live co-editing

    /** The owner and everyone invited to edit. */
    public function editors(int $id, int $userId): array
    {
        $this->accessible($id, $userId);
        $st = $this->db->prepare(
            "SELECT u.id, u.name, u.email, 'owner' AS role FROM scores s JOIN users u ON u.id = s.user_id WHERE s.id = ?
             UNION ALL
             SELECT u.id, u.name, u.email, 'editor' AS role FROM score_editors e JOIN users u ON u.id = e.user_id WHERE e.score_id = ?",
        );
        $st->execute([$id, $id]);
        return array_map(fn ($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'email' => $r['email'], 'role' => $r['role']], $st->fetchAll());
    }

    /** Invite someone with a Pianissimo account to edit (owner only). */
    public function addEditor(int $id, int $ownerId, string $email): array
    {
        $this->owned($id, $ownerId);
        $email = mb_strtolower(trim($email));
        $st = $this->db->prepare('SELECT id FROM users WHERE email = ?');
        $st->execute([$email]);
        $editorId = $st->fetchColumn();
        if ($editorId === false) {
            throw new HttpError(404, 'No Pianissimo account uses that email. Ask them to sign up first.');
        }
        if ((int) $editorId === $ownerId) {
            throw new HttpError(422, 'You already own this score.');
        }
        $count = $this->db->prepare('SELECT COUNT(*) FROM score_editors WHERE score_id = ?');
        $count->execute([$id]);
        if ((int) $count->fetchColumn() >= ($this->config['max_editors_per_score'] ?? 20)) {
            throw new HttpError(403, 'This score already has the most editors allowed.');
        }
        $exists = $this->db->prepare('SELECT 1 FROM score_editors WHERE score_id = ? AND user_id = ?');
        $exists->execute([$id, (int) $editorId]);
        if (!$exists->fetch()) {
            $this->db->prepare('INSERT INTO score_editors (score_id, user_id, created_at) VALUES (?, ?, ?)')
                ->execute([$id, (int) $editorId, Http::now()]);
            $row = $this->accessible($id, $ownerId);
            $this->notify?->send((int) $editorId, 'invite', ['actor' => $row['owner_name'], 'title' => $row['title']], "app.html?open=$id", $ownerId);
        }
        return $this->editors($id, $ownerId);
    }

    /** The owner removes an editor, or an editor leaves. */
    public function removeEditor(int $id, int $userId, int $editorId): void
    {
        $row = $this->accessible($id, $userId);
        if ($row['role'] !== 'owner' && $editorId !== $userId) {
            throw new HttpError(403, 'Only the owner can remove other editors.');
        }
        $this->db->prepare('DELETE FROM score_editors WHERE score_id = ? AND user_id = ?')->execute([$id, $editorId]);
    }

    /**
     * A short-lived ticket for the realtime service: who the user is and which score they
     * may join, signed with the secret the service shares with this server.
     */
    public function realtimeTicket(int $id, array $user): array
    {
        $row = $this->accessible($id, (int) $user['id']);
        $url = (string) ($this->config['realtime_url'] ?? '');
        $secret = (string) ($this->config['realtime_secret'] ?? '');
        if ($url === '' || strlen($secret) < 16) {
            return ['url' => null];
        }
        $payload = self::b64(json_encode([
            'u' => (int) $user['id'],
            'n' => $user['name'],
            's' => $id,
            'r' => $row['role'],
            'e' => time() + 3600,
        ]));
        return ['url' => $url, 'token' => $payload . '.' . self::b64(hash_hmac('sha256', $payload, $secret, true))];
    }

    private static function b64(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
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

    /** The owner's or an invited editor's view of a score; adds `role`. */
    private function accessible(int $id, int $userId, string $extra = ''): array
    {
        $st = $this->db->prepare(
            'SELECT ' . self::META_S . str_replace(', ', ', s.', $extra) . ", s.user_id, u.name AS owner_name,
                    CASE WHEN s.user_id = ? THEN 'owner' ELSE 'editor' END AS role
             FROM scores s JOIN users u ON u.id = s.user_id
             WHERE s.id = ? AND (s.user_id = ? OR EXISTS (SELECT 1 FROM score_editors e WHERE e.score_id = s.id AND e.user_id = ?))",
        );
        $st->execute([$userId, $id, $userId, $userId]);
        $row = $st->fetch();
        if (!$row) {
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
            'role' => $row['role'] ?? 'owner',
        ] + (($row['role'] ?? 'owner') === 'editor' ? ['owner' => $row['owner_name'] ?? ''] : []);
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
