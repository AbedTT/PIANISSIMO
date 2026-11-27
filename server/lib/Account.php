<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * A person's own data: download everything stored about them (one JSON file) or delete the
 * account. Deleting removes the user row; the database's foreign keys (ON DELETE CASCADE)
 * then remove their scores and versions, editor invitations, class memberships, classes
 * they teach (with assignments and the work handed in), comments, likes and notifications.
 */
final class Account
{
    public function __construct(private PDO $db)
    {
    }

    public function export(int $userId): array
    {
        $one = function (string $sql, array $args) {
            $st = $this->db->prepare($sql);
            $st->execute($args);
            return $st->fetchAll();
        };
        $user = $one('SELECT id, name, email, created_at, email_verified_at, notify_email, lang FROM users WHERE id = ?', [$userId])[0] ?? null;
        if (!$user) {
            throw new HttpError(404, 'Account not found.');
        }
        $scores = array_map(function ($r) {
            $r['data'] = json_decode($r['data'], true);
            return $r;
        }, $one('SELECT id, title, composer, visibility, slug, revision, created_at, updated_at, data FROM scores WHERE user_id = ?', [$userId]));
        return [
            'exported_at' => Http::now(),
            'account' => $user,
            'scores' => $scores,
            'editing_with_others' => $one(
                'SELECT s.id, s.title, u.name AS owner, e.created_at FROM score_editors e JOIN scores s ON s.id = e.score_id JOIN users u ON u.id = s.user_id WHERE e.user_id = ?',
                [$userId],
            ),
            'classes_taught' => $one('SELECT id, name, join_code, created_at FROM classes WHERE owner_id = ?', [$userId]),
            'classes_joined' => $one(
                'SELECT c.id, c.name, m.joined_at FROM class_members m JOIN classes c ON c.id = m.class_id WHERE m.user_id = ?',
                [$userId],
            ),
            'work_handed_in' => $one(
                'SELECT a.title, s.status, s.feedback, s.grade, s.marks, s.submitted_at, s.returned_at, s.score_id
                 FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.user_id = ?',
                [$userId],
            ),
            'comments' => $one(
                'SELECT c.text, c.created_at, s.title AS score FROM public_comments c JOIN scores s ON s.id = c.score_id WHERE c.user_id = ?',
                [$userId],
            ),
            'likes' => $one('SELECT s.title, l.created_at FROM score_likes l JOIN scores s ON s.id = l.score_id WHERE l.user_id = ?', [$userId]),
            'notifications' => $one('SELECT kind, text, link, created_at, read_at FROM notifications WHERE user_id = ?', [$userId]),
        ];
    }

    /** Delete the account after checking the password (so a forgotten open session cannot do it). */
    public function delete(int $userId, string $password): void
    {
        $st = $this->db->prepare('SELECT password_hash FROM users WHERE id = ?');
        $st->execute([$userId]);
        $hash = $st->fetchColumn();
        if ($hash === false || !password_verify($password, (string) $hash)) {
            throw new HttpError(403, 'That password is not right.');
        }
        $this->db->prepare('DELETE FROM reports WHERE user_id = ?')->execute([$userId]);
        $this->db->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
    }
}
