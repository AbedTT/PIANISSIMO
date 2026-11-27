<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * Sessions, CSRF tokens, sign-in and brute-force throttling; password reset, password change
 * and email confirmation by one-time links.
 *
 * Every account has an `auth_epoch` that a password change or reset raises. A session remembers
 * the epoch it signed in with, so changing the password signs out every other device.
 */
final class Auth
{
    public const RESET_SECONDS = 3600;
    public const VERIFY_SECONDS = 7 * 86400;
    /** At most this many reset or confirmation emails per account and hour. */
    private const LINKS_PER_HOUR = 3;

    /** The emails, per language; {name} and {link} are filled in. */
    private const MAIL = [
        'reset_subject' => [
            'en' => 'Choose a new Pianissimo password',
            'fr' => 'Choisissez un nouveau mot de passe Pianissimo',
            'es' => 'Elige una nueva contraseña de Pianissimo',
            'de' => 'Neues Pianissimo-Passwort festlegen',
        ],
        'reset_body' => [
            'en' => "Hello {name},\n\nSomeone (hopefully you) asked to reset the password of your Pianissimo account. Choose a new one here within the next hour:\n\n{link}\n\nIf it was not you, ignore this email: your password stays as it is.\n",
            'fr' => "Bonjour {name},\n\nQuelqu’un (vous, nous l’espérons) a demandé à réinitialiser le mot de passe de votre compte Pianissimo. Choisissez-en un nouveau ici dans l’heure :\n\n{link}\n\nSi ce n’était pas vous, ignorez cet e-mail : votre mot de passe ne change pas.\n",
            'es' => "Hola, {name}:\n\nAlguien (esperamos que tú) pidió restablecer la contraseña de tu cuenta de Pianissimo. Elige una nueva aquí durante la próxima hora:\n\n{link}\n\nSi no fuiste tú, ignora este correo: tu contraseña sigue igual.\n",
            'de' => "Hallo {name},\n\njemand (hoffentlich Sie) möchte das Passwort Ihres Pianissimo-Kontos zurücksetzen. Legen Sie innerhalb der nächsten Stunde hier ein neues fest:\n\n{link}\n\nWaren Sie es nicht, ignorieren Sie diese E-Mail: Ihr Passwort bleibt unverändert.\n",
        ],
        'verify_subject' => [
            'en' => 'Confirm your email for Pianissimo',
            'fr' => 'Confirmez votre e-mail pour Pianissimo',
            'es' => 'Confirma tu correo para Pianissimo',
            'de' => 'Bestätigen Sie Ihre E-Mail für Pianissimo',
        ],
        'verify_body' => [
            'en' => "Welcome to Pianissimo, {name}!\n\nPlease confirm that this is your email address, so you can always get back into your account:\n\n{link}\n\nThe link works for 7 days. If you did not create an account, ignore this email.\n",
            'fr' => "Bienvenue sur Pianissimo, {name} !\n\nConfirmez que cette adresse est bien la vôtre, pour pouvoir toujours retrouver votre compte :\n\n{link}\n\nLe lien fonctionne 7 jours. Si vous n’avez pas créé de compte, ignorez cet e-mail.\n",
            'es' => "¡Te damos la bienvenida a Pianissimo, {name}!\n\nConfirma que esta es tu dirección de correo, para poder recuperar siempre tu cuenta:\n\n{link}\n\nEl enlace funciona 7 días. Si no creaste una cuenta, ignora este correo.\n",
            'de' => "Willkommen bei Pianissimo, {name}!\n\nBitte bestätigen Sie, dass dies Ihre E-Mail-Adresse ist, damit Sie immer wieder in Ihr Konto kommen:\n\n{link}\n\nDer Link gilt 7 Tage. Haben Sie kein Konto erstellt, ignorieren Sie diese E-Mail.\n",
        ],
    ];

    private Mailer $mailer;

    public function __construct(private PDO $db, private array $config)
    {
        $this->mailer = new Mailer($config);
    }

    public function startSession(): void
    {
        $https = Http::isHttps();
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
        $st = $this->db->prepare('SELECT id, email, name, auth_epoch, email_verified_at FROM users WHERE id = ?');
        $st->execute([$id]);
        $u = $st->fetch();
        // the password was changed since this session signed in: it is no longer valid
        if (!$u || (int) $u['auth_epoch'] !== (int) ($_SESSION['epoch'] ?? 0)) {
            unset($_SESSION['user_id'], $_SESSION['epoch']);
            return null;
        }
        $admin = in_array(strtolower($u['email']), $this->config['admins'] ?? [], true);
        return [
            'id' => (int) $u['id'],
            'email' => $u['email'],
            'name' => $u['name'],
            'verified' => $u['email_verified_at'] !== null,
        ] + ($admin ? ['admin' => true] : []);
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
        self::checkNewPassword($password);
        $st = $this->db->prepare('SELECT 1 FROM users WHERE email = ?');
        $st->execute([$email]);
        if ($st->fetch()) {
            throw new HttpError(409, 'An account with this email already exists. Try signing in.');
        }
        $st = $this->db->prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)');
        $st->execute([$email, $name, password_hash($password, PASSWORD_DEFAULT), Http::now()]);
        $this->signIn((int) $this->db->lastInsertId());
        $user = $this->user();
        $this->sendVerification($user['id']);
        return $user;
    }

    public function login(string $email, string $password): array
    {
        $this->throttle('login', $email);
        $st = $this->db->prepare('SELECT id, password_hash FROM users WHERE email = ?');
        $st->execute([strtolower(trim($email))]);
        $row = $st->fetch();
        // verify against a dummy hash when the user does not exist, so timing does not reveal accounts
        // (a real bcrypt hash of a random throw-away string, so password_verify costs the same)
        $hash = $row['password_hash'] ?? '$2y$10$yHN4IG1Dt6PM0St8NSq6HuexLVb3uJRhKiCj/6dvrYh5tYCq32dj2';
        if (!password_verify($password, $hash) || !$row) {
            $this->recordAttempt('login', $email);
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
        $st = $this->db->prepare('SELECT auth_epoch FROM users WHERE id = ?');
        $st->execute([$userId]);
        $_SESSION['user_id'] = $userId;
        $_SESSION['epoch'] = (int) $st->fetchColumn();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    // ------------------------------------------------------------------ recovery and confirmation

    /** Whether this server can send the emails that reset passwords and confirm addresses. */
    public function canMail(): bool
    {
        return $this->mailer->enabled() && $this->siteUrl() !== '';
    }

    /**
     * Email a one-time link for choosing a new password. The answer is the same whether or not
     * an account uses the address, so it cannot be used to find out who has one.
     */
    public function forgot(string $email): void
    {
        $this->throttle('forgot');
        $this->recordAttempt('forgot');
        if (!$this->canMail()) {
            error_log('[pianissimo] password reset asked for, but email is not set up (mail_from and site_url)');
            throw new HttpError(503, 'This server cannot send emails yet, so passwords cannot be reset here. Please ask the site’s admin.');
        }
        $st = $this->db->prepare('SELECT id, name, email, lang FROM users WHERE email = ?');
        $st->execute([strtolower(trim($email))]);
        $u = $st->fetch();
        if (!$u || $this->recentLinks((int) $u['id'], 'reset') >= self::LINKS_PER_HOUR) {
            return;
        }
        $link = $this->siteUrl() . 'app.html#reset=' . $this->issueToken((int) $u['id'], 'reset', self::RESET_SECONDS);
        $this->mail($u, 'reset', $link);
    }

    /** Set a new password with a link from forgot(); signs in here, and out everywhere else. */
    public function reset(string $token, string $password): array
    {
        $this->throttle('reset');
        $userId = $this->tokenUser($token, 'reset');
        if ($userId === null) {
            $this->recordAttempt('reset');
            throw new HttpError(400, 'This link to reset your password is not valid any more. Ask for a new one.');
        }
        self::checkNewPassword($password);
        $now = Http::now();
        // the link reached their inbox, which also confirms the address
        $this->db->prepare('UPDATE users SET password_hash = ?, auth_epoch = auth_epoch + 1, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $now, $userId]);
        // every other reset link of this account stops working too
        $this->db->prepare("UPDATE account_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL")
            ->execute([$now, $userId]);
        $this->signIn($userId);
        return $this->user();
    }

    /** Change the password of a signed-in account; other devices are signed out. */
    public function changePassword(int $userId, string $current, string $password): array
    {
        $this->throttle('password', "user:$userId");
        $st = $this->db->prepare('SELECT password_hash FROM users WHERE id = ?');
        $st->execute([$userId]);
        if (!password_verify($current, (string) $st->fetchColumn())) {
            $this->recordAttempt('password', "user:$userId");
            throw new HttpError(403, 'Your current password is not right.');
        }
        self::checkNewPassword($password);
        $this->db->prepare('UPDATE users SET password_hash = ?, auth_epoch = auth_epoch + 1 WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $userId]);
        $this->signIn($userId);
        return $this->user();
    }

    /** Email a link that confirms the account's address. False when not sent (already confirmed, no email, too many). */
    public function sendVerification(int $userId): bool
    {
        if (!$this->canMail()) {
            return false;
        }
        $st = $this->db->prepare('SELECT id, name, email, lang, email_verified_at FROM users WHERE id = ?');
        $st->execute([$userId]);
        $u = $st->fetch();
        if (!$u || $u['email_verified_at'] !== null || $this->recentLinks($userId, 'verify') >= self::LINKS_PER_HOUR) {
            return false;
        }
        $link = $this->siteUrl() . 'app.html#verify=' . $this->issueToken($userId, 'verify', self::VERIFY_SECONDS);
        return $this->mail($u, 'verify', $link);
    }

    /** Confirm an address with a link from sendVerification() (works signed in or not). */
    public function verifyEmail(string $token): void
    {
        $this->throttle('verify');
        $userId = $this->tokenUser($token, 'verify');
        if ($userId === null) {
            $this->recordAttempt('verify');
            throw new HttpError(400, 'This confirmation link is not valid any more. Send a new one from your account menu.');
        }
        $now = Http::now();
        $this->db->prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')->execute([$now, $userId]);
        $this->db->prepare("UPDATE account_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL")
            ->execute([$now, $userId]);
    }

    private static function checkNewPassword(string $password): void
    {
        if (strlen($password) < 8 || strlen($password) > 200) {
            throw new HttpError(422, 'Your password needs at least 8 characters.');
        }
    }

    /** Address of the web pages, ending in a slash. Email links need it set: it is never taken from the request. */
    private function siteUrl(): string
    {
        $url = trim((string) ($this->config['site_url'] ?? ''));
        return $url === '' ? '' : rtrim($url, '/') . '/';
    }

    /** A new one-time token; only its SHA-256 is stored. */
    private function issueToken(int $userId, string $purpose, int $seconds): string
    {
        $token = bin2hex(random_bytes(32));
        $this->db->prepare('INSERT INTO account_tokens (user_id, purpose, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$userId, $purpose, hash('sha256', $token), Http::now(), gmdate('Y-m-d\TH:i:s\Z', time() + $seconds)]);
        // forget links that ran out more than a day ago
        $this->db->prepare('DELETE FROM account_tokens WHERE expires_at < ?')->execute([gmdate('Y-m-d\TH:i:s\Z', time() - 86400)]);
        return $token;
    }

    /** The account a live, unused token belongs to. */
    private function tokenUser(string $token, string $purpose): ?int
    {
        if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
            return null;
        }
        $st = $this->db->prepare('SELECT user_id FROM account_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?');
        $st->execute([hash('sha256', $token), $purpose, Http::now()]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    private function recentLinks(int $userId, string $purpose): int
    {
        $st = $this->db->prepare('SELECT COUNT(*) FROM account_tokens WHERE user_id = ? AND purpose = ? AND created_at > ?');
        $st->execute([$userId, $purpose, gmdate('Y-m-d\TH:i:s\Z', time() - 3600)]);
        return (int) $st->fetchColumn();
    }

    private function mail(array $u, string $kind, string $link): bool
    {
        $lang = in_array($u['lang'] ?? 'en', ['en', 'fr', 'es', 'de'], true) ? $u['lang'] : 'en';
        return $this->mailer->send(
            $u['email'],
            self::MAIL["{$kind}_subject"][$lang],
            strtr(self::MAIL["{$kind}_body"][$lang], ['{name}' => $u['name'], '{link}' => $link]),
        );
    }

    /**
     * Refuse when there were too many attempts in the last 15 minutes: from this IP address, and
     * (for sign-in) on this account. Counting per account stops password guessing even when it
     * comes from many addresses; the higher per-IP limits let a whole classroom behind one
     * address sign up and sign in.
     */
    private function throttle(string $action, ?string $account = null): void
    {
        $since = gmdate('Y-m-d\TH:i:s\Z', time() - 15 * 60);
        $st = $this->db->prepare('SELECT COUNT(*) FROM auth_attempts WHERE ip = ? AND action = ? AND created_at > ?');
        foreach ($this->subjects($account) as $who => $limit) {
            $st->execute([$who, $action, $since]);
            if ((int) $st->fetchColumn() >= ($limit ?? $this->ipLimit($action))) {
                throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
            }
        }
    }

    private function recordAttempt(string $action, ?string $account = null): void
    {
        $st = $this->db->prepare('INSERT INTO auth_attempts (ip, action, created_at) VALUES (?, ?, ?)');
        foreach (array_keys($this->subjects($account)) as $who) {
            $st->execute([$who, $action, Http::now()]);
        }
        // keep the table small
        $this->db->prepare('DELETE FROM auth_attempts WHERE created_at < ?')
            ->execute([gmdate('Y-m-d\TH:i:s\Z', time() - 3600)]);
    }

    /**
     * Who is counted, with their limit (null = the per-IP limit of the action). An account is
     * stored as a hash in the `ip` column, like `user:<id>` for scanning.
     */
    private function subjects(?string $account): array
    {
        $out = [Http::clientIp() => null];
        if ($account !== null && $account !== '') {
            $out['acct:' . substr(hash('sha256', strtolower(trim($account))), 0, 40)] = (int) $this->config['auth_attempts_per_15min'];
        }
        return $out;
    }

    private function ipLimit(string $action): int
    {
        return (int) match ($action) {
            'register' => $this->config['registrations_per_ip_15min'] ?? 30,
            'login' => $this->config['auth_attempts_per_ip_15min'] ?? 50,
            default => $this->config['auth_attempts_per_15min'],
        };
    }
}
