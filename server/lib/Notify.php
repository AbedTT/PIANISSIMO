<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * In-app notifications (the bell in the editor), with optional email copies.
 *
 * Email is off unless `mail_from` is set. Each person chooses: no email, one per event, or a
 * daily digest (sent by server/cron/digest.php). Emails are written in the person's language
 * (the one they last used in the editor). With `mail_log` set, messages are appended to that
 * file instead of being sent (development and tests).
 */
final class Notify
{
    private const KEEP = 200;
    public const EMAIL_OFF = 0;
    public const EMAIL_EACH = 1;
    public const EMAIL_DAILY = 2;
    public const LANGS = ['en', 'fr', 'es', 'de'];

    /** Notification texts per kind and language; {actor}, {title} and {class} are filled in. */
    private const TEXT = [
        'invite' => [
            'en' => '{actor} invited you to edit “{title}”',
            'fr' => '{actor} vous invite à modifier « {title} »',
            'es' => '{actor} te invitó a editar «{title}»',
            'de' => '{actor} hat Sie eingeladen, „{title}“ zu bearbeiten',
        ],
        'assignment' => [
            'en' => 'New assignment in {class}: {title}',
            'fr' => 'Nouveau devoir dans {class} : {title}',
            'es' => 'Nueva tarea en {class}: {title}',
            'de' => 'Neue Aufgabe in {class}: {title}',
        ],
        'handed-in' => [
            'en' => '{actor} handed in “{title}”',
            'fr' => '{actor} a remis « {title} »',
            'es' => '{actor} entregó «{title}»',
            'de' => '{actor} hat „{title}“ abgegeben',
        ],
        'returned' => [
            'en' => 'Your work on “{title}” was given back',
            'fr' => 'Votre travail sur « {title} » vous a été rendu',
            'es' => 'Tu trabajo en «{title}» fue devuelto',
            'de' => 'Ihre Arbeit zu „{title}“ wurde zurückgegeben',
        ],
        'comment' => [
            'en' => '{actor} commented on “{title}”',
            'fr' => '{actor} a commenté « {title} »',
            'es' => '{actor} comentó «{title}»',
            'de' => '{actor} hat „{title}“ kommentiert',
        ],
    ];

    /** The words around an email. */
    private const MAIL = [
        'open' => ['en' => 'Open it', 'fr' => 'Ouvrir', 'es' => 'Abrir', 'de' => 'Öffnen'],
        'off' => [
            'en' => 'You can change or turn off these emails from the bell in the Pianissimo editor.',
            'fr' => 'Vous pouvez modifier ou couper ces e-mails depuis la cloche de l’éditeur Pianissimo.',
            'es' => 'Puedes cambiar o desactivar estos correos desde la campana del editor de Pianissimo.',
            'de' => 'Sie können diese E-Mails über die Glocke im Pianissimo-Editor ändern oder abschalten.',
        ],
        'digest1' => [
            'en' => '1 new notification',
            'fr' => '1 nouvelle notification',
            'es' => '1 notificación nueva',
            'de' => '1 neue Benachrichtigung',
        ],
        'digest' => [
            'en' => '{n} new notifications',
            'fr' => '{n} nouvelles notifications',
            'es' => '{n} notificaciones nuevas',
            'de' => '{n} neue Benachrichtigungen',
        ],
    ];

    public function __construct(private PDO $db, private array $config)
    {
    }

    /**
     * Tell one person something happened. `params` fills the kind's text (actor, title, class).
     * Never tells someone about their own action.
     */
    public function send(int $userId, string $kind, array $params, string $link, ?int $actorId = null): void
    {
        if ($actorId !== null && $actorId === $userId) {
            return;
        }
        $text = self::text($kind, $params, 'en');
        $this->db->prepare('INSERT INTO notifications (user_id, kind, text, params, link, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$userId, $kind, mb_substr($text, 0, 300), json_encode($params, JSON_UNESCAPED_UNICODE), mb_substr($link, 0, 300), Http::now()]);
        // keep the list short
        $old = $this->db->prepare('SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1000 OFFSET ' . self::KEEP);
        $old->execute([$userId]);
        $ids = $old->fetchAll(PDO::FETCH_COLUMN);
        if ($ids) {
            $this->db->exec('DELETE FROM notifications WHERE id IN (' . implode(',', array_map('intval', $ids)) . ')');
        }
        $user = $this->recipient($userId);
        if ($user && (int) $user['notify_email'] === self::EMAIL_EACH) {
            $lang = $user['lang'];
            $this->deliver(
                $user['email'],
                'Pianissimo: ' . mb_substr(self::text($kind, $params, $lang), 0, 80),
                self::text($kind, $params, $lang) . "\n\n" . self::MAIL['open'][$lang] . ': ' . $this->url($link) . "\n\n" . self::MAIL['off'][$lang] . "\n",
            );
        }
    }

    /** A notification's text in a language. */
    public static function text(string $kind, array $params, string $lang): string
    {
        $tpl = self::TEXT[$kind][$lang] ?? self::TEXT[$kind]['en'] ?? $kind;
        return strtr($tpl, ['{actor}' => (string) ($params['actor'] ?? ''), '{title}' => (string) ($params['title'] ?? ''), '{class}' => (string) ($params['class'] ?? '')]);
    }

    /** The latest notifications and how many are unread. */
    public function list(int $userId): array
    {
        $st = $this->db->prepare('SELECT id, kind, text, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50');
        $st->execute([$userId]);
        $items = array_map(fn ($r) => [
            'id' => (int) $r['id'],
            'kind' => $r['kind'],
            'text' => $r['text'],
            'link' => $r['link'],
            'created_at' => $r['created_at'],
            'read' => $r['read_at'] !== null,
        ], $st->fetchAll());
        $count = $this->db->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL');
        $count->execute([$userId]);
        $mode = (int) ($this->recipient($userId)['notify_email'] ?? self::EMAIL_EACH);
        return [
            'notifications' => $items,
            'unread' => (int) $count->fetchColumn(),
            'email' => ['available' => $this->mailOn(), 'mode' => [self::EMAIL_OFF => 'off', self::EMAIL_EACH => 'each', self::EMAIL_DAILY => 'daily'][$mode] ?? 'each'],
        ];
    }

    /** Mark some (or, without ids, all) notifications read. */
    public function markRead(int $userId, ?array $ids): void
    {
        $now = Http::now();
        if ($ids === null) {
            $this->db->prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')->execute([$now, $userId]);
            return;
        }
        $st = $this->db->prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL');
        foreach (array_slice($ids, 0, 100) as $id) {
            $st->execute([$now, $userId, (int) $id]);
        }
    }

    /** off | each | daily */
    public function setEmail(int $userId, string $mode): void
    {
        $value = ['off' => self::EMAIL_OFF, 'each' => self::EMAIL_EACH, 'daily' => self::EMAIL_DAILY][$mode] ?? null;
        if ($value === null) {
            throw new HttpError(422, 'Choose off, each or daily.');
        }
        $this->db->prepare('UPDATE users SET notify_email = ? WHERE id = ?')->execute([$value, $userId]);
        if ($value === self::EMAIL_DAILY) {
            // the first digest covers what comes from now on
            $this->db->prepare('UPDATE users SET digest_last_id = (SELECT COALESCE(MAX(id), 0) FROM notifications WHERE user_id = ?) WHERE id = ?')
                ->execute([$userId, $userId]);
        }
    }

    /** The language emails are written in (the one the person uses in the editor). */
    public function setLanguage(int $userId, string $lang): void
    {
        if (!in_array($lang, self::LANGS, true)) {
            throw new HttpError(422, 'Unknown language.');
        }
        $this->db->prepare('UPDATE users SET lang = ? WHERE id = ?')->execute([$lang, $userId]);
    }

    /**
     * Daily digests: one email per person who chose them, with everything since their last
     * digest (run once a day from cron: server/cron/digest.php). Returns how many were sent.
     */
    public function sendDigests(): int
    {
        if (!$this->mailOn()) {
            return 0;
        }
        $users = $this->db->prepare('SELECT id, email, lang, digest_last_id FROM users WHERE notify_email = ?');
        $users->execute([self::EMAIL_DAILY]);
        $sent = 0;
        foreach ($users->fetchAll() as $u) {
            $st = $this->db->prepare('SELECT id, kind, params, link FROM notifications WHERE user_id = ? AND id > ? ORDER BY id');
            $st->execute([$u['id'], (int) $u['digest_last_id']]);
            $items = $st->fetchAll();
            if ($items) {
                $lang = in_array($u['lang'], self::LANGS, true) ? $u['lang'] : 'en';
                $lines = array_map(
                    fn ($n) => '• ' . self::text($n['kind'], json_decode((string) $n['params'], true) ?: [], $lang) . "\n  " . $this->url($n['link']),
                    $items,
                );
                $title = count($items) === 1 ? self::MAIL['digest1'][$lang] : strtr(self::MAIL['digest'][$lang], ['{n}' => (string) count($items)]);
                $this->deliver($u['email'], "Pianissimo: $title", "$title\n\n" . implode("\n\n", $lines) . "\n\n" . self::MAIL['off'][$lang] . "\n");
                $sent++;
                $this->db->prepare('UPDATE users SET digest_last_id = ? WHERE id = ?')->execute([(int) end($items)['id'], $u['id']]);
            }
        }
        return $sent;
    }

    // ------------------------------------------------------------------ helpers

    private function recipient(int $userId): ?array
    {
        $st = $this->db->prepare('SELECT email, notify_email, lang FROM users WHERE id = ?');
        $st->execute([$userId]);
        $u = $st->fetch();
        if (!$u) {
            return null;
        }
        $u['lang'] = in_array($u['lang'] ?? 'en', self::LANGS, true) ? $u['lang'] : 'en';
        return $u;
    }

    private function mailOn(): bool
    {
        return (new Mailer($this->config))->enabled();
    }

    private function url(string $link): string
    {
        $base = rtrim((string) ($this->config['site_url'] ?? ''), '/');
        return $base !== '' ? "$base/$link" : $link;
    }

    /** Send (or, with mail_log, write down) one email. A failure never breaks the request. */
    private function deliver(string $to, string $subject, string $body): void
    {
        (new Mailer($this->config))->send($to, $subject, $body);
    }
}
