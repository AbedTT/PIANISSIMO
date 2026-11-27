<?php
declare(strict_types=1);

namespace Pianissimo;

/** Thrown to end a request with an HTTP error and a JSON message. */
final class HttpError extends \RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Http
{
    public static function json(array $body, int $status = 200): never
    {
        http_response_code($status);
        echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /** Decoded JSON request body (an object), size-limited. */
    public static function input(int $maxBytes): array
    {
        $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($length > $maxBytes) {
            throw new HttpError(413, 'That score is too large to save.');
        }
        $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
        if ($raw === false || $raw === '') {
            return [];
        }
        if (strlen($raw) > $maxBytes) {
            throw new HttpError(413, 'That score is too large to save.');
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new HttpError(400, 'The request body must be JSON.');
        }
        return $data;
    }

    public static function now(): string
    {
        return gmdate('Y-m-d\TH:i:s\Z');
    }

    /** Proxies (IP addresses or CIDR ranges) whose forwarding headers are believed; see config `trusted_proxies`. */
    private static array $trustedProxies = [];
    private static string $ipHeader = 'X-Forwarded-For';

    /** Set from the configuration at the start of each request. */
    public static function configure(array $config): void
    {
        $proxies = $config['trusted_proxies'] ?? [];
        self::$trustedProxies = is_array($proxies) ? $proxies : array_filter(array_map('trim', explode(',', (string) $proxies)));
        self::$ipHeader = (string) (($config['client_ip_header'] ?? '') ?: 'X-Forwarded-For');
    }

    /**
     * The visitor's address. Behind a reverse proxy or CDN (Cloudflare, a load balancer) every
     * request comes from the proxy, so with `trusted_proxies` set the address is read from the
     * forwarding header instead: the nearest address in it that is not a trusted proxy. Without
     * that setting, forwarding headers are ignored (anyone could send them).
     */
    public static function clientIp(): string
    {
        $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (self::$trustedProxies && self::trusted($remote)) {
            $header = (string) ($_SERVER['HTTP_' . strtoupper(str_replace('-', '_', self::$ipHeader))] ?? '');
            // X-Forwarded-For is "client, proxy1, proxy2": walk back from the end past our own proxies
            foreach (array_reverse(array_map('trim', explode(',', $header))) as $hop) {
                if (filter_var($hop, FILTER_VALIDATE_IP) === false) {
                    break;
                }
                $remote = $hop;
                if (!self::trusted($hop)) {
                    break;
                }
            }
        }
        return substr($remote, 0, 45);
    }

    /** Whether the visitor used HTTPS (also when a trusted proxy ended the TLS connection). */
    public static function isHttps(): bool
    {
        if ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['SERVER_PORT'] ?? '') === '443')) {
            return true;
        }
        return self::$trustedProxies
            && self::trusted((string) ($_SERVER['REMOTE_ADDR'] ?? ''))
            && strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0])) === 'https';
    }

    /** Whether an address is one of the trusted proxies (exact address or CIDR range, IPv4 or IPv6). */
    public static function trusted(string $ip): bool
    {
        $bin = @inet_pton($ip);
        if ($bin === false) {
            return false;
        }
        foreach (self::$trustedProxies as $entry) {
            [$net, $bits] = array_pad(explode('/', trim((string) $entry), 2), 2, null);
            $netBin = @inet_pton($net);
            if ($netBin === false || strlen($netBin) !== strlen($bin)) {
                continue;
            }
            $bits = $bits === null ? strlen($bin) * 8 : max(0, min((int) $bits, strlen($bin) * 8));
            $bytes = intdiv($bits, 8);
            if (substr($bin, 0, $bytes) !== substr($netBin, 0, $bytes)) {
                continue;
            }
            $rest = $bits % 8;
            if ($rest === 0 || ((ord($bin[$bytes]) ^ ord($netBin[$bytes])) & (0xff << (8 - $rest)) & 0xff) === 0) {
                return true;
            }
        }
        return false;
    }

    /** Random URL-safe identifier (base62). */
    public static function slug(int $length = 10): string
    {
        $alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $out = '';
        $bytes = random_bytes($length);
        for ($i = 0; $i < $length; $i++) {
            $out .= $alphabet[ord($bytes[$i]) % 62];
        }
        return $out;
    }
}
