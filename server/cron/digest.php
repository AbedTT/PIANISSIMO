<?php
/**
 * Daily notification digests. Run once a day from cron, for example:
 *
 *   15 7 * * *  php /var/www/pianissimo/server/cron/digest.php
 *
 * Sends one email to each person who chose "daily summary", with everything since their last
 * one. Needs `mail_from` in the config; does nothing otherwise.
 */
declare(strict_types=1);

namespace Pianissimo;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

require __DIR__ . '/../lib/Http.php';
require __DIR__ . '/../lib/Db.php';
require __DIR__ . '/../lib/Notify.php';

$config = require __DIR__ . '/../config.php';
$sent = (new Notify(Db::get($config), $config))->sendDigests();
fwrite(STDOUT, "Pianissimo: $sent digest(s) sent\n");
