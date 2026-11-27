<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * Community around shared scores: profiles, likes, remixes, comments and reports.
 *
 * Moderation is light and automatic: three different people reporting a comment hides it,
 * three reporting a score takes it off Explore and profiles (its link keeps working for the
 * owner to fix or make private). The comment's author and the score's owner can delete a
 * comment. Posting is rate limited per person.
 */
final class Community
{
    public const HIDE_AFTER_REPORTS = 3;
    private const COMMENTS_PER_10_MIN = 10;

    public function __construct(private PDO $db, private Scores $scores, private ?Notify $notify = null)
    {
    }

    /** A person's public page: name, member since, their public scores and likes received. */
    public function profile(int $userId): array
    {
        $st = $this->db->prepare('SELECT id, name, created_at FROM users WHERE id = ?');
        $st->execute([$userId]);
        $user = $st->fetch();
        if (!$user) {
            throw new HttpError(404, 'No such person.');
        }
        $list = $this->db->prepare(
            "SELECT s.slug, s.title, s.composer, s.updated_at, u.name AS author, u.id AS author_id,
                    (SELECT COUNT(*) FROM score_likes l WHERE l.score_id = s.id) AS likes
             FROM scores s JOIN users u ON u.id = s.user_id
             WHERE s.user_id = ? AND s.visibility = 'public' AND s.hidden = 0 ORDER BY s.updated_at DESC LIMIT 200",
        );
        $list->execute([$userId]);
        $scores = array_map([Scores::class, 'publicRow'], $list->fetchAll());
        return [
            'user' => ['id' => (int) $user['id'], 'name' => $user['name'], 'created_at' => $user['created_at']],
            'scores' => $scores,
            'likes' => array_sum(array_column($scores, 'likes')),
        ];
    }

    /** Like or unlike a shared score. */
    public function toggleLike(string $slug, int $userId): array
    {
        $score = $this->shared($slug);
        $has = $this->db->prepare('SELECT 1 FROM score_likes WHERE score_id = ? AND user_id = ?');
        $has->execute([$score['id'], $userId]);
        if ($has->fetch()) {
            $this->db->prepare('DELETE FROM score_likes WHERE score_id = ? AND user_id = ?')->execute([$score['id'], $userId]);
            $liked = false;
        } else {
            $this->db->prepare('INSERT INTO score_likes (score_id, user_id, created_at) VALUES (?, ?, ?)')->execute([$score['id'], $userId, Http::now()]);
            $liked = true;
        }
        return ['liked' => $liked, 'likes' => $this->likes((int) $score['id'])];
    }

    /** Copy a shared score into the user's library, remembering where it came from. */
    public function remix(string $slug, int $userId): array
    {
        $score = $this->shared($slug);
        $data = json_decode($score['data'], true);
        $data['title'] = mb_substr(($data['title'] ?? 'Untitled') . ' (remix)', 0, 200);
        $meta = $this->scores->create($userId, $data);
        $this->db->prepare('UPDATE scores SET remix_of = ? WHERE id = ?')->execute([$score['id'], $meta['id']]);
        return $meta;
    }

    public function comments(string $slug, ?int $viewerId): array
    {
        $score = $this->shared($slug);
        $st = $this->db->prepare(
            'SELECT c.id, c.text, c.created_at, c.user_id, u.name FROM public_comments c JOIN users u ON u.id = c.user_id
             WHERE c.score_id = ? AND c.hidden = 0 ORDER BY c.id ASC LIMIT 500',
        );
        $st->execute([$score['id']]);
        $owner = (int) $score['user_id'];
        return array_map(fn ($r) => [
            'id' => (int) $r['id'],
            'text' => $r['text'],
            'created_at' => $r['created_at'],
            'author' => ['id' => (int) $r['user_id'], 'name' => $r['name']],
            // the comment's author and the score's owner may delete it
            'can_delete' => $viewerId !== null && ($viewerId === (int) $r['user_id'] || $viewerId === $owner),
        ], $st->fetchAll());
    }

    public function addComment(string $slug, int $userId, string $text): array
    {
        $score = $this->shared($slug);
        $text = trim($text);
        if ($text === '' || mb_strlen($text) > 1000) {
            throw new HttpError(422, 'Write a comment of up to 1000 characters.');
        }
        $recent = $this->db->prepare('SELECT COUNT(*) FROM public_comments WHERE user_id = ? AND created_at > ?');
        $recent->execute([$userId, gmdate('Y-m-d\TH:i:s\Z', time() - 600)]);
        if ((int) $recent->fetchColumn() >= self::COMMENTS_PER_10_MIN) {
            throw new HttpError(429, 'That is a lot of comments: please wait a few minutes.');
        }
        $this->db->prepare('INSERT INTO public_comments (score_id, user_id, text, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$score['id'], $userId, $text, Http::now()]);
        $who = $this->db->prepare('SELECT u.name, s.title FROM users u, scores s WHERE u.id = ? AND s.id = ?');
        $who->execute([$userId, $score['id']]);
        if ($w = $who->fetch()) {
            $this->notify?->send((int) $score['user_id'], 'comment', ['actor' => $w['name'], 'title' => $w['title']], 'view.html?s=' . rawurlencode($slug), $userId);
        }
        return $this->comments($slug, $userId);
    }

    public function deleteComment(int $commentId, int $userId): void
    {
        $st = $this->db->prepare('SELECT c.user_id, s.user_id AS owner FROM public_comments c JOIN scores s ON s.id = c.score_id WHERE c.id = ?');
        $st->execute([$commentId]);
        $row = $st->fetch();
        if (!$row || ($userId !== (int) $row['user_id'] && $userId !== (int) $row['owner'])) {
            throw new HttpError(404, 'Comment not found.');
        }
        $this->db->prepare('DELETE FROM public_comments WHERE id = ?')->execute([$commentId]);
    }

    /** Report a comment or a score; enough reports from different people hide it. */
    public function report(string $kind, int $targetId, int $userId): array
    {
        if ($kind === 'comment') {
            $st = $this->db->prepare('SELECT id FROM public_comments WHERE id = ?');
        } else {
            $st = $this->db->prepare("SELECT id FROM scores WHERE id = ? AND visibility IN ('public', 'unlisted')");
        }
        $st->execute([$targetId]);
        if (!$st->fetch()) {
            throw new HttpError(404, 'Nothing to report there.');
        }
        $exists = $this->db->prepare('SELECT 1 FROM reports WHERE kind = ? AND target_id = ? AND user_id = ?');
        $exists->execute([$kind, $targetId, $userId]);
        if (!$exists->fetch()) {
            $this->db->prepare('INSERT INTO reports (kind, target_id, user_id, created_at) VALUES (?, ?, ?, ?)')
                ->execute([$kind, $targetId, $userId, Http::now()]);
        }
        $count = $this->db->prepare('SELECT COUNT(*) FROM reports WHERE kind = ? AND target_id = ?');
        $count->execute([$kind, $targetId]);
        $hidden = (int) $count->fetchColumn() >= self::HIDE_AFTER_REPORTS;
        if ($hidden) {
            $table = $kind === 'comment' ? 'public_comments' : 'scores';
            $this->db->prepare("UPDATE $table SET hidden = 1 WHERE id = ?")->execute([$targetId]);
        }
        return ['reported' => true, 'hidden' => $hidden];
    }

    // ------------------------------------------------------------------ moderation (admins)

    /** Everything reported, most reported first, with whether it is hidden. */
    public function reports(): array
    {
        $st = $this->db->query(
            "SELECT r.kind, r.target_id, COUNT(*) AS n, MAX(r.created_at) AS last,
                    c.text AS comment_text, c.hidden AS comment_hidden, cu.name AS comment_author, cs.slug AS comment_slug,
                    s.title AS score_title, s.hidden AS score_hidden, s.slug AS score_slug, s.visibility, su.name AS score_author
             FROM reports r
             LEFT JOIN public_comments c ON r.kind = 'comment' AND c.id = r.target_id
             LEFT JOIN users cu ON cu.id = c.user_id
             LEFT JOIN scores cs ON cs.id = c.score_id
             LEFT JOIN scores s ON r.kind = 'score' AND s.id = r.target_id
             LEFT JOIN users su ON su.id = s.user_id
             GROUP BY r.kind, r.target_id ORDER BY n DESC, last DESC LIMIT 200",
        );
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $comment = $r['kind'] === 'comment';
            if ($comment ? $r['comment_text'] === null : $r['score_title'] === null) {
                continue; // already deleted
            }
            $out[] = [
                'kind' => $r['kind'],
                'id' => (int) $r['target_id'],
                'reports' => (int) $r['n'],
                'last' => $r['last'],
                'hidden' => (bool) ($comment ? $r['comment_hidden'] : $r['score_hidden']),
                'text' => $comment ? $r['comment_text'] : $r['score_title'],
                'author' => $comment ? $r['comment_author'] : $r['score_author'],
                'link' => 'view.html?s=' . rawurlencode((string) ($comment ? $r['comment_slug'] : $r['score_slug'])),
            ];
        }
        return $out;
    }

    /**
     * An admin's decision on reported content: `restore` (show it again and forget the reports),
     * `dismiss` (forget the reports, leave it as it is) or `remove` (delete the comment, or make
     * the score private so only its owner sees it).
     */
    public function moderate(string $kind, int $id, string $action): void
    {
        if (!in_array($kind, ['comment', 'score'], true) || !in_array($action, ['restore', 'dismiss', 'remove'], true)) {
            throw new HttpError(422, 'Unknown moderation action.');
        }
        $table = $kind === 'comment' ? 'public_comments' : 'scores';
        if ($action === 'restore') {
            $this->db->prepare("UPDATE $table SET hidden = 0 WHERE id = ?")->execute([$id]);
        } elseif ($action === 'remove') {
            if ($kind === 'comment') {
                $this->db->prepare('DELETE FROM public_comments WHERE id = ?')->execute([$id]);
            } else {
                $this->db->prepare("UPDATE scores SET visibility = 'private', hidden = 0 WHERE id = ?")->execute([$id]);
            }
        }
        $this->db->prepare('DELETE FROM reports WHERE kind = ? AND target_id = ?')->execute([$kind, $id]);
    }

    // ------------------------------------------------------------------ helpers

    /** A score shared by link or publicly. */
    private function shared(string $slug): array
    {
        $st = $this->db->prepare("SELECT id, user_id, data FROM scores WHERE slug = ? AND visibility IN ('public', 'unlisted')");
        $st->execute([$slug]);
        $row = $st->fetch();
        if (!$row) {
            throw new HttpError(404, 'This score does not exist or is no longer shared.');
        }
        return $row;
    }

    private function likes(int $scoreId): int
    {
        $st = $this->db->prepare('SELECT COUNT(*) FROM score_likes WHERE score_id = ?');
        $st->execute([$scoreId]);
        return (int) $st->fetchColumn();
    }
}
