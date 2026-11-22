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

    public static function clientIp(): string
    {
        // REMOTE_ADDR only: forwarded headers can be spoofed unless a trusted proxy is configured
        return substr((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 45);
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
