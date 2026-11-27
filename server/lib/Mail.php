<?php
declare(strict_types=1);

namespace Pianissimo;

/**
 * Sends plain-text emails (UTF-8), one recipient at a time.
 *
 * Transports, chosen from the configuration:
 * - `mail_log`: append each message to that file instead of sending it (development, tests);
 * - `smtp_host`: talk SMTP to a mail service (Postmark, SendGrid, Mailgun, Amazon SES, your
 *   host's relay…) with STARTTLS or TLS and a login. This is the reliable choice in production;
 * - otherwise PHP's mail(), which needs a working sendmail on the server and often ends up in spam.
 *
 * Email is off unless `mail_from` is set. A failure is written to the PHP error log and
 * reported as `false`; it never breaks the request that wanted to send something.
 */
final class Mailer
{
    /** The last SMTP conversation's error, for the log and for tests. */
    public string $lastError = '';

    public function __construct(private array $config)
    {
    }

    public function enabled(): bool
    {
        return trim((string) ($this->config['mail_from'] ?? '')) !== '';
    }

    public function send(string $to, string $subject, string $body): bool
    {
        $this->lastError = '';
        if (!$this->enabled()) {
            return false;
        }
        $to = trim($to);
        if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to)) {
            return $this->fail("bad recipient address");
        }
        $from = str_replace(["\r", "\n"], '', trim((string) $this->config['mail_from']));
        $fromAddress = self::address($from);
        $subjectHeader = '=?UTF-8?B?' . base64_encode(str_replace(["\r", "\n"], ' ', $subject)) . '?=';
        $domain = substr(strrchr($fromAddress, '@') ?: '@localhost', 1);
        $headers = [
            "From: $from",
            'Date: ' . date(DATE_RFC2822),
            'Message-ID: <' . bin2hex(random_bytes(16)) . "@$domain>",
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            // tells auto-responders not to answer
            'Auto-Submitted: auto-generated',
        ];
        $encoded = rtrim(chunk_split(base64_encode(str_replace(["\r\n", "\r"], "\n", $body)), 76, "\r\n"));

        $log = (string) ($this->config['mail_log'] ?? '');
        if ($log !== '') {
            $ok = @file_put_contents($log, "To: $to\nSubject: $subject\n\n$body\n-----\n", FILE_APPEND | LOCK_EX) !== false;
            return $ok ?: $this->fail("cannot write $log");
        }
        if (trim((string) ($this->config['smtp_host'] ?? '')) !== '') {
            $message = "To: $to\r\nSubject: $subjectHeader\r\n" . implode("\r\n", $headers) . "\r\n\r\n$encoded\r\n";
            return $this->smtp($fromAddress, $to, $message);
        }
        $ok = @mail($to, $subjectHeader, $encoded, implode("\r\n", $headers));
        return $ok ?: $this->fail('mail() refused the message (is sendmail set up?)');
    }

    /** `Name <a@b.c>` or `a@b.c` → `a@b.c` */
    private static function address(string $from): string
    {
        return preg_match('/<([^>]+)>/', $from, $m) ? trim($m[1]) : $from;
    }

    private function fail(string $why): bool
    {
        $this->lastError = $why;
        error_log("[pianissimo] email not sent: $why");
        return false;
    }

    // ------------------------------------------------------------------ SMTP (RFC 5321)

    private function smtp(string $from, string $to, string $message): bool
    {
        $host = (string) $this->config['smtp_host'];
        $secure = strtolower((string) ($this->config['smtp_secure'] ?? 'tls')); // tls (STARTTLS) | ssl | none
        $port = (int) (($this->config['smtp_port'] ?? 0) ?: ($secure === 'ssl' ? 465 : 587));
        $timeout = (int) ($this->config['smtp_timeout'] ?? 15);
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
        $sock = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$sock) {
            return $this->fail("cannot connect to $host:$port ($errstr)");
        }
        stream_set_timeout($sock, $timeout);
        try {
            $this->expect($sock, 220);
            $helo = gethostname() ?: 'localhost';
            $features = $this->command($sock, "EHLO $helo", 250);
            if ($secure === 'tls') {
                if (!preg_match('/^250[ -]STARTTLS/mi', $features)) {
                    throw new \RuntimeException('the server does not offer STARTTLS (set smtp_secure to ssl or none)');
                }
                $this->command($sock, 'STARTTLS', 220);
                if (!@stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                    throw new \RuntimeException('TLS handshake failed');
                }
                $features = $this->command($sock, "EHLO $helo", 250);
            }
            $user = (string) ($this->config['smtp_user'] ?? '');
            if ($user !== '') {
                $pass = (string) ($this->config['smtp_pass'] ?? '');
                if (preg_match('/^250[ -]AUTH\b.*\bPLAIN\b/mi', $features)) {
                    $this->command($sock, 'AUTH PLAIN ' . base64_encode("\0$user\0$pass"), 235);
                } else {
                    $this->command($sock, 'AUTH LOGIN', 334);
                    $this->command($sock, base64_encode($user), 334);
                    $this->command($sock, base64_encode($pass), 235);
                }
            }
            $this->command($sock, "MAIL FROM:<$from>", 250);
            $this->command($sock, "RCPT TO:<$to>", [250, 251]);
            $this->command($sock, 'DATA', 354);
            // dot-stuffing: a line that starts with a dot gets a second one
            $data = preg_replace('/^\./m', '..', $message);
            $this->command($sock, $data . '.', 250);
            try {
                $this->command($sock, 'QUIT', 221);
            } catch (\RuntimeException) {
                // the message is sent already: a missing goodbye does not matter
            }
            return true;
        } catch (\RuntimeException $e) {
            return $this->fail("SMTP $host:$port: " . $e->getMessage());
        } finally {
            fclose($sock);
        }
    }

    /** Send one line (or the message body) and check the reply code. */
    private function command($sock, string $line, int|array $want): string
    {
        if (@fwrite($sock, $line . "\r\n") === false) {
            throw new \RuntimeException('connection lost');
        }
        return $this->expect($sock, $want);
    }

    /** Read one (possibly multi-line) reply and check its code. */
    private function expect($sock, int|array $want): string
    {
        $reply = '';
        while (($line = fgets($sock, 2048)) !== false) {
            $reply .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }
        $code = (int) substr($reply, 0, 3);
        if (!in_array($code, (array) $want, true)) {
            // never echo what we sent (it may be a password); the server's answer is enough
            throw new \RuntimeException($reply === '' ? 'no answer (timeout)' : 'unexpected answer: ' . trim($reply));
        }
        return $reply;
    }
}
