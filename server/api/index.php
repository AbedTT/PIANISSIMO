<?php
/**
 * Pianissimo JSON API.  URL form: .../server/api/index.php/<route>
 *
 *   GET    /health
 *   GET    /auth/me                 POST /auth/register  POST /auth/login  POST /auth/logout
 *   GET    /scores                  POST /scores
 *   GET    /scores/{id}             PUT  /scores/{id}    DELETE /scores/{id}
 *   POST   /scores/{id}/duplicate
 *   GET    /public[?q=]             GET  /public/{slug}
 *
 * Every response is JSON and carries the CSRF token (`csrf`) that the next
 * state-changing request must send back in the X-CSRF-Token header.
 */
declare(strict_types=1);

namespace Pianissimo;

require __DIR__ . '/../lib/Http.php';
require __DIR__ . '/../lib/Db.php';
require __DIR__ . '/../lib/Auth.php';
require __DIR__ . '/../lib/Scores.php';

$config = require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');

set_exception_handler(function (\Throwable $e) use ($config): void {
    if ($e instanceof HttpError) {
        $status = $e->status;
        $message = $e->getMessage();
    } else {
        error_log('[pianissimo] ' . $e);
        $status = 500;
        $message = $config['debug'] ? $e->getMessage() : 'Something went wrong on the server.';
    }
    http_response_code($status);
    $body = ['error' => $message];
    if (session_status() === PHP_SESSION_ACTIVE && !empty($_SESSION['csrf'])) {
        $body['csrf'] = $_SESSION['csrf'];
    }
    echo json_encode($body);
});

$db = Db::get($config);
$auth = new Auth($db, $config);
$scores = new Scores($db, $config);
$auth->startSession();

$method = $_SERVER['REQUEST_METHOD'];
$path = '/' . trim($_SERVER['PATH_INFO'] ?? '', '/');
$respond = fn (array $body, int $status = 200) => Http::json($body + ['csrf' => $auth->csrf()], $status);

if ($method !== 'GET') {
    $auth->checkCsrf();
}

// ------------------------------------------------------------------ routes
if ($path === '/health') {
    $respond(['ok' => true]);
}

if ($path === '/auth/me' && $method === 'GET') {
    $respond(['user' => $auth->user()]);
}
if ($path === '/auth/register' && $method === 'POST') {
    $in = Http::input(10_000);
    $user = $auth->register((string) ($in['name'] ?? ''), (string) ($in['email'] ?? ''), (string) ($in['password'] ?? ''));
    $respond(['user' => $user], 201);
}
if ($path === '/auth/login' && $method === 'POST') {
    $in = Http::input(10_000);
    $respond(['user' => $auth->login((string) ($in['email'] ?? ''), (string) ($in['password'] ?? ''))]);
}
if ($path === '/auth/logout' && $method === 'POST') {
    $auth->logout();
    $respond(['ok' => true]);
}

if ($path === '/scores') {
    $user = $auth->requireUser();
    if ($method === 'GET') {
        $respond(['scores' => $scores->list($user['id'])]);
    }
    if ($method === 'POST') {
        $in = Http::input($config['max_score_bytes'] + 10_000);
        $respond(['score' => $scores->create($user['id'], $in['data'] ?? null)], 201);
    }
}

if (preg_match('#^/scores/(\d+)(/duplicate)?$#', $path, $m)) {
    $user = $auth->requireUser();
    $id = (int) $m[1];
    if (!empty($m[2])) {
        if ($method === 'POST') {
            $respond(['score' => $scores->duplicate($id, $user['id'])], 201);
        }
    } elseif ($method === 'GET') {
        $respond(['score' => $scores->get($id, $user['id'])]);
    } elseif ($method === 'PUT') {
        $respond(['score' => $scores->update($id, $user['id'], Http::input($config['max_score_bytes'] + 10_000))]);
    } elseif ($method === 'DELETE') {
        $scores->delete($id, $user['id']);
        $respond(['ok' => true]);
    }
}

if ($path === '/public' && $method === 'GET') {
    $respond(['scores' => $scores->publicList((string) ($_GET['q'] ?? ''))]);
}
if (preg_match('#^/public/([A-Za-z0-9]{6,16})$#', $path, $m) && $method === 'GET') {
    $respond(['score' => $scores->publicBySlug($m[1])]);
}

throw new HttpError(404, 'Unknown API route.');
