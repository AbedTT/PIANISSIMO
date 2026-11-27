<?php
/**
 * Pianissimo JSON API.  URL form: .../server/api/index.php/<route>
 *
 *   GET    /health
 *   GET    /auth/me                 POST /auth/register  POST /auth/login  POST /auth/logout
 *   GET    /account/export          POST /account/delete {password}
 *   GET    /scores                  POST /scores
 *   GET    /scores/{id}             PUT  /scores/{id}    DELETE /scores/{id}
 *   POST   /scores/{id}/duplicate
 *   GET    /scores/{id}/editors     POST /scores/{id}/editors  DELETE /scores/{id}/editors/{userId}
 *   POST   /scores/{id}/realtime    (ticket for the live co-editing service)
 *   GET    /scores/{id}/assignment  (the assignment this score is someone's work on, or null)
 *   GET    /classes                 POST /classes        POST /classes/join
 *   GET    /classes/{id}            DELETE /classes/{id} DELETE /classes/{id}/members/{userId}
 *   POST   /classes/{id}/assignments
 *   POST   /assignments/{id}/start  POST /assignments/{id}/submit  GET /assignments/{id}/submissions
 *   POST   /submissions/{id}/return {feedback, grade, marks[]}
 *   GET    /calendar                (due dates across the user's classes)
 *   GET    /public[?q=&sort=likes]  GET  /public/{slug}
 *   POST   /public/{slug}/like      POST /public/{slug}/remix   POST /public/{slug}/report
 *   GET    /public/{slug}/comments  POST /public/{slug}/comments
 *   DELETE /public/comments/{id}    POST /public/comments/{id}/report
 *   GET    /people/{id}             (public profile)
 *   GET    /notifications           POST /notifications/read {ids?}  POST /notifications/email {mode: off|each|daily}
 *   POST   /account/language {lang}
 *   GET    /omr                     POST /omr (multipart `file`: a photo or PDF of sheet music)
 *   GET    /admin/reports           POST /admin/reports/{comment|score}/{id} {action: restore|dismiss|remove}
 *
 * Every response is JSON and carries the CSRF token (`csrf`) that the next
 * state-changing request must send back in the X-CSRF-Token header.
 */
declare(strict_types=1);

namespace Pianissimo;

require __DIR__ . '/../lib/Http.php';
require __DIR__ . '/../lib/Db.php';
require __DIR__ . '/../lib/Auth.php';
require __DIR__ . '/../lib/Notify.php';
require __DIR__ . '/../lib/Account.php';
require __DIR__ . '/../lib/Omr.php';
require __DIR__ . '/../lib/Scores.php';
require __DIR__ . '/../lib/Classes.php';
require __DIR__ . '/../lib/Community.php';

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
$notify = new Notify($db, $config);
$scores = new Scores($db, $config, $notify);
$classes = new Classes($db, $scores, $notify);
$community = new Community($db, $scores, $notify);
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
if ($path === '/omr') {
    $omr = new Omr($db, $config);
    if ($method === 'GET') {
        $respond(['available' => $omr->available()]);
    }
    if ($method === 'POST') {
        $respond(['result' => $omr->scan($auth->requireUser()['id'], $_FILES['file'] ?? null)]);
    }
}
if ($path === '/account/language' && $method === 'POST') {
    $notify->setLanguage($auth->requireUser()['id'], (string) (Http::input(1_000)['lang'] ?? ''));
    $respond(['ok' => true]);
}
if ($path === '/account/export' && $method === 'GET') {
    header('Content-Disposition: attachment; filename="pianissimo-my-data.json"');
    $respond(['data' => (new Account($db))->export($auth->requireUser()['id'])]);
}
if ($path === '/account/delete' && $method === 'POST') {
    (new Account($db))->delete($auth->requireUser()['id'], (string) (Http::input(1_000)['password'] ?? ''));
    $auth->logout();
    $respond(['ok' => true]);
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
        $respond(['score' => isset($_GET['meta']) ? $scores->info($id, $user['id']) : $scores->get($id, $user['id'])]);
    } elseif ($method === 'PUT') {
        $respond(['score' => $scores->update($id, $user['id'], Http::input($config['max_score_bytes'] + 10_000))]);
    } elseif ($method === 'DELETE') {
        $scores->delete($id, $user['id']);
        $respond(['ok' => true]);
    }
}

if (preg_match('#^/scores/(\d+)/versions(?:/(\d+))?$#', $path, $m) && $method === 'GET') {
    $user = $auth->requireUser();
    if (!empty($m[2])) {
        $respond(['version' => $scores->version((int) $m[1], (int) $m[2], $user['id'])]);
    }
    $respond(['versions' => $scores->versions((int) $m[1], $user['id'])]);
}

if (preg_match('#^/scores/(\d+)/editors(?:/(\d+))?$#', $path, $m)) {
    $user = $auth->requireUser();
    $id = (int) $m[1];
    if (!empty($m[2]) && $method === 'DELETE') {
        $scores->removeEditor($id, $user['id'], (int) $m[2]);
        $respond(['ok' => true]);
    }
    if (empty($m[2]) && $method === 'GET') {
        $respond(['editors' => $scores->editors($id, $user['id'])]);
    }
    if (empty($m[2]) && $method === 'POST') {
        $in = Http::input(2_000);
        $respond(['editors' => $scores->addEditor($id, $user['id'], (string) ($in['email'] ?? ''))]);
    }
}

if (preg_match('#^/scores/(\d+)/realtime$#', $path, $m) && $method === 'POST') {
    $respond($scores->realtimeTicket((int) $m[1], $auth->requireUser()));
}

// ------------------------------------------------------------------ teaching
if (preg_match('#^/scores/(\d+)/assignment$#', $path, $m) && $method === 'GET') {
    $respond(['assignment' => $classes->forScore((int) $m[1], $auth->requireUser()['id'])]);
}
if ($path === '/classes') {
    $user = $auth->requireUser();
    if ($method === 'GET') {
        $respond(['classes' => $classes->list($user['id'])]);
    }
    if ($method === 'POST') {
        $respond(['class' => $classes->create($user['id'], (string) (Http::input(2_000)['name'] ?? ''))], 201);
    }
}
if ($path === '/classes/join' && $method === 'POST') {
    $respond(['class' => $classes->join($auth->requireUser()['id'], (string) (Http::input(2_000)['code'] ?? ''))]);
}
if (preg_match('#^/classes/(\d+)(?:/members/(\d+)|/(assignments))?$#', $path, $m)) {
    $user = $auth->requireUser();
    $id = (int) $m[1];
    if (!empty($m[2]) && $method === 'DELETE') {
        $classes->removeMember($id, $user['id'], (int) $m[2]);
        $respond(['ok' => true]);
    }
    if (!empty($m[3]) && $method === 'POST') {
        $respond(['class' => $classes->assign($id, $user['id'], Http::input(20_000))], 201);
    }
    if (empty($m[2]) && empty($m[3]) && $method === 'GET') {
        $respond(['class' => $classes->get($id, $user['id'])]);
    }
    if (empty($m[2]) && empty($m[3]) && $method === 'DELETE') {
        $classes->deleteClass($id, $user['id']);
        $respond(['ok' => true]);
    }
}
if (preg_match('#^/assignments/(\d+)/(start|submit|submissions)$#', $path, $m)) {
    $user = $auth->requireUser();
    $id = (int) $m[1];
    if ($m[2] === 'start' && $method === 'POST') {
        $respond(['submission' => $classes->start($id, $user)]);
    }
    if ($m[2] === 'submit' && $method === 'POST') {
        $respond(['submission' => $classes->submit($id, $user['id'])]);
    }
    if ($m[2] === 'submissions' && $method === 'GET') {
        $respond(['submissions' => $classes->submissions($id, $user['id'])]);
    }
}
if (preg_match('#^/submissions/(\d+)/return$#', $path, $m) && $method === 'POST') {
    $in = Http::input(10_000);
    $respond(['submission' => $classes->giveBack(
        (int) $m[1],
        $auth->requireUser()['id'],
        (string) ($in['feedback'] ?? ''),
        (string) ($in['grade'] ?? ''),
        is_array($in['marks'] ?? null) ? $in['marks'] : [],
    )]);
}
if ($path === '/calendar' && $method === 'GET') {
    $respond(['calendar' => $classes->calendar($auth->requireUser()['id'])]);
}

if ($path === '/public' && $method === 'GET') {
    $respond(['scores' => $scores->publicList((string) ($_GET['q'] ?? ''), (string) ($_GET['sort'] ?? 'new'))]);
}
if (preg_match('#^/public/([A-Za-z0-9]{6,16})$#', $path, $m) && $method === 'GET') {
    $shared = $scores->publicBySlug($m[1], $auth->user()['id'] ?? null);
    unset($shared['id']); // internal
    $respond(['score' => $shared]);
}

// ------------------------------------------------------------------ community
if (preg_match('#^/public/([A-Za-z0-9]{6,16})/(like|remix|report|comments)$#', $path, $m)) {
    [$all, $slug, $what] = $m;
    if ($what === 'comments' && $method === 'GET') {
        $respond(['comments' => $community->comments($slug, $auth->user()['id'] ?? null)]);
    }
    $user = $auth->requireUser();
    if ($method === 'POST') {
        if ($what === 'like') {
            $respond($community->toggleLike($slug, $user['id']));
        }
        if ($what === 'remix') {
            $respond(['score' => $community->remix($slug, $user['id'])], 201);
        }
        if ($what === 'report') {
            $respond($community->report('score', $scores->publicBySlug($slug)['id'], $user['id']));
        }
        if ($what === 'comments') {
            $respond(['comments' => $community->addComment($slug, $user['id'], (string) (Http::input(4_000)['text'] ?? ''))], 201);
        }
    }
}
if (preg_match('#^/public/comments/(\d+)(/report)?$#', $path, $m)) {
    $user = $auth->requireUser();
    if (!empty($m[2]) && $method === 'POST') {
        $respond($community->report('comment', (int) $m[1], $user['id']));
    }
    if (empty($m[2]) && $method === 'DELETE') {
        $community->deleteComment((int) $m[1], $user['id']);
        $respond(['ok' => true]);
    }
}
// ------------------------------------------------------------------ notifications and moderation
if ($path === '/notifications' && $method === 'GET') {
    $respond($notify->list($auth->requireUser()['id']));
}
if ($path === '/notifications/read' && $method === 'POST') {
    $in = Http::input(10_000);
    $notify->markRead($auth->requireUser()['id'], is_array($in['ids'] ?? null) ? $in['ids'] : null);
    $respond(['ok' => true]);
}
if ($path === '/notifications/email' && $method === 'POST') {
    $in = Http::input(1_000);
    // `on` (true/false) is the older form of the setting
    $mode = isset($in['mode']) ? (string) $in['mode'] : (!empty($in['on']) ? 'each' : 'off');
    $notify->setEmail($auth->requireUser()['id'], $mode);
    $respond(['ok' => true]);
}
if (preg_match('#^/admin/reports(?:/(comment|score)/(\d+))?$#', $path, $m)) {
    $user = $auth->requireUser();
    if (empty($user['admin'])) {
        throw new HttpError(403, 'Only site admins can review reports.');
    }
    if (empty($m[1]) && $method === 'GET') {
        $respond(['reports' => $community->reports()]);
    }
    if (!empty($m[1]) && $method === 'POST') {
        $community->moderate($m[1], (int) $m[2], (string) (Http::input(1_000)['action'] ?? ''));
        $respond(['ok' => true]);
    }
}

if (preg_match('#^/people/(\d+)$#', $path, $m) && $method === 'GET') {
    $respond(['profile' => $community->profile((int) $m[1])]);
}

throw new HttpError(404, 'Unknown API route.');
