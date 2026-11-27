<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/** Sessions, CSRF tokens, sign-in and brute-force throttling. */
final class Auth
{
    public function __construct(private PDO $db, private array $config)
    {
    }

    public function startSession(): void
    {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['SERVER_PORT'] ?? '') === '443');
        session_name($this->config['session_name']);
        session_set_cookie_params([
            'lifetime' => $this->config['session_days'] * 86400,
            'path' => '/',
            'secure' => $https,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        ini_set('session.use_strict_mode', '1');
        ini_set('session.gc_maxlifetime', (string) ($this->config['session_days'] * 86400));
        session_start();
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
    }

    public function csrf(): string
    {
        return $_SESSION['csrf'];
    }

    /** Every state-changing request must echo the session's CSRF token in X-CSRF-Token. */
    public function checkCsrf(): void
    {
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($sent) || !hash_equals($this->csrf(), $sent)) {
            throw new HttpError(403, 'Your session expired. Please reload the page and try again.');
        }
    }

    public function user(): ?array
    {
        $id = $_SESSION['user_id'] ?? null;
        if (!$id) {
            return null;
        }
        $st = $this->db->prepare('SELECT id, email, name FROM users WHERE id = ?');
        $st->execute([$id]);
        $u = $st->fetch();
        if (!$u) {
            return null;
        }
        $admin = in_array(strtolower($u['email']), $this->config['admins'] ?? [], true);
        return ['id' => (int) $u['id'], 'email' => $u['email'], 'name' => $u['name']] + ($admin ? ['admin' => true] : []);
    }

    public function requireUser(): array
    {
        $u = $this->user();
        if (!$u) {
            throw new HttpError(401, 'Please sign in first.');
        }
        return $u;
    }

    public function register(string $name, string $email, string $password): array
    {
        $this->throttle('register');
        $this->recordAttempt('register');
        $name = trim($name);
        $email = strtolower(trim($email));
        if ($name === '' || mb_strlen($name) > 60) {
            throw new HttpError(422, 'Please enter a name of up to 60 characters.');
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
            throw new HttpError(422, 'Please enter a valid email address.');
        }
        if (strlen($password) < 8 || strlen($password) > 200) {
            throw new HttpError(422, 'Your password needs at least 8 characters.');
        }
        $st = $this->db->prepare('SELECT 1 FROM users WHERE email = ?');
        $st->execute([$email]);
        if ($st->fetch()) {
            throw new HttpError(409, 'An account with this email already exists. Try signing in.');
        }
        $st = $this->db->prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)');
        $st->execute([$email, $name, password_hash($password, PASSWORD_DEFAULT), Http::now()]);
        $this->signIn((int) $this->db->lastInsertId());
        return $this->user();
    }

    public function login(string $email, string $password): array
    {
        $this->throttle('login');
        $st = $this->db->prepare('SELECT id, password_hash FROM users WHERE email = ?');
        $st->execute([strtolower(trim($email))]);
        $row = $st->fetch();
        // verify against a dummy hash when the user does not exist, so timing does not reveal accounts
        // (a real bcrypt hash of a random throw-away string, so password_verify costs the same)
        $hash = $row['password_hash'] ?? '$2y$10$yHN4IG1Dt6PM0St8NSq6HuexLVb3uJRhKiCj/6dvrYh5tYCq32dj2';
        if (!password_verify($password, $hash) || !$row) {
            $this->recordAttempt('login');
            throw new HttpError(401, 'Wrong email or password.');
        }
        if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
            $up = $this->db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $up->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
        }
        $this->signIn((int) $row['id']);
        return $this->user();
    }

    public function logout(): void
    {
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    private function signIn(int $userId): void
    {
        session_regenerate_id(true); // prevent session fixation
        $_SESSION['user_id'] = $userId;
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    private function throttle(string $action): void
    {
        $since = gmdate('Y-m-d\TH:i:s\Z', time() - 15 * 60);
        $st = $this->db->prepare('SELECT COUNT(*) FROM auth_attempts WHERE ip = ? AND action = ? AND created_at > ?');
        $st->execute([Http::clientIp(), $action, $since]);
        if ((int) $st->fetchColumn() >= $this->config['auth_attempts_per_15min']) {
            throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
        }
    }

    private function recordAttempt(string $action): void
    {
        $this->db->prepare('INSERT INTO auth_attempts (ip, action, created_at) VALUES (?, ?, ?)')
            ->execute([Http::clientIp(), $action, Http::now()]);
        // keep the table small
        $this->db->prepare('DELETE FROM auth_attempts WHERE created_at < ?')
            ->execute([gmdate('Y-m-d\TH:i:s\Z', time() - 3600)]);
    }
}
