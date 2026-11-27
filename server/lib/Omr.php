<?php
declare(strict_types=1);

namespace Pianissimo;

use PDO;

/**
 * Scanning sheet music (optical music recognition) with an engine installed on the server,
 * normally Audiveris (open source): `omr_command` in the config, with {in} (the uploaded
 * file) and {out} (a folder for the result), for example
 *
 *   audiveris -batch -export -output {out} {in}
 *
 * The upload is checked by its content (PNG, JPEG, TIFF or PDF, at most 10 MB), run in a
 * private temporary folder with a time limit, and the folder is deleted afterwards whatever
 * happens. Only the MusicXML it produced goes back to the browser.
 */
final class Omr
{
    private const MAX_BYTES = 10 * 1024 * 1024;
    private const PER_HOUR = 20;
    private const TYPES = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/tiff' => 'tif', 'application/pdf' => 'pdf'];

    public function __construct(private PDO $db, private array $config)
    {
    }

    public function available(): bool
    {
        return trim((string) ($this->config['omr_command'] ?? '')) !== '';
    }

    /**
     * Recognise an uploaded file; returns ['format' => 'mxl'|'musicxml', 'data' => base64, 'pages' => [base64 PNG, …]].
     * The pages are Audiveris's black-and-white picture of each page (from its .omr project file), so the
     * editor can show the page beside the result; other engines return none.
     */
    public function scan(int $userId, ?array $file): array
    {
        if (!$this->available()) {
            throw new HttpError(501, 'Scanning sheet music is not set up on this server.');
        }
        $this->throttle($userId);
        if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            throw new HttpError(422, 'Choose a photo or PDF of the sheet music.');
        }
        if ((int) $file['size'] > self::MAX_BYTES) {
            throw new HttpError(413, 'That file is too large to scan (10 MB at most).');
        }
        $type = (new \finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) ?: '';
        $ext = self::TYPES[$type] ?? null;
        if (!$ext) {
            throw new HttpError(415, 'Scan a PNG, JPEG, TIFF or PDF file.');
        }

        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'pianissimo-omr-' . bin2hex(random_bytes(8));
        mkdir($dir . DIRECTORY_SEPARATOR . 'out', 0700, true);
        // the file is named after the upload, so the score gets that title when the page has none
        $in = $dir . DIRECTORY_SEPARATOR . self::baseName((string) ($file['name'] ?? '')) . ".$ext";
        try {
            if (!copy($file['tmp_name'], $in)) {
                throw new HttpError(500, 'The upload could not be read.');
            }
            $this->run($in, $dir . DIRECTORY_SEPARATOR . 'out');
            $result = $this->findResult($dir . DIRECTORY_SEPARATOR . 'out');
            if (!$result) {
                throw new HttpError(422, 'No music could be recognised on that page. Try a straighter, sharper photo.');
            }
            $format = str_ends_with(strtolower($result), '.mxl') ? 'mxl' : 'musicxml';
            $out = $dir . DIRECTORY_SEPARATOR . 'out';
            $pages = $this->fromBook($out, '~^sheet#(\d+)/BINARY\.png$~');
            $sheets = $this->fromBook($out, '~^sheet#(\d+)/sheet#\d+\.xml$~');
            return [
                'format' => $format,
                'data' => base64_encode((string) file_get_contents($result)),
                'pages' => $pages,
                // where each bar is on the pictures (the editor follows the cursor on the page)
                'sheets' => count($sheets) === count($pages) ? $sheets : [],
            ];
        } finally {
            self::remove($dir);
        }
    }

    private function run(string $in, string $out): void
    {
        $command = strtr((string) $this->config['omr_command'], ['{in}' => escapeshellarg($in), '{out}' => escapeshellarg($out)]);
        $proc = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($proc)) {
            throw new HttpError(500, 'The scanner could not be started.');
        }
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $limit = time() + (int) ($this->config['omr_timeout'] ?? 180);
        while (true) {
            fread($pipes[1], 65536);
            fread($pipes[2], 65536);
            $status = proc_get_status($proc);
            if (!$status['running']) {
                break;
            }
            if (time() > $limit) {
                proc_terminate($proc);
                throw new HttpError(504, 'Scanning took too long. Try a single page.');
            }
            usleep(100_000);
        }
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
    }

    /** The MusicXML the engine wrote (it may use subfolders). */
    private function findResult(string $dir): ?string
    {
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if (preg_match('/\.(mxl|musicxml|xml)$/i', $f->getFilename())) {
                return $f->getPathname();
            }
        }
        return null;
    }

    /** One file per page from Audiveris's .omr file (a zip), base64, in page order: its picture or its description. */
    private function fromBook(string $dir, string $pattern): array
    {
        if (!class_exists(\ZipArchive::class)) {
            return [];
        }
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if (!str_ends_with(strtolower($f->getFilename()), '.omr')) {
                continue;
            }
            $zip = new \ZipArchive();
            if ($zip->open($f->getPathname(), \ZipArchive::RDONLY) !== true) {
                return [];
            }
            $pages = [];
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                if ($stat && preg_match($pattern, $stat['name'], $m) && $stat['size'] <= 20 * 1024 * 1024) {
                    $pages[(int) $m[1]] = base64_encode((string) $zip->getFromIndex($i));
                }
            }
            $zip->close();
            ksort($pages);
            return array_values($pages);
        }
        return [];
    }

    /** A safe file name from the upload's ("Moonlight sonata.pdf" -> "Moonlight sonata"). */
    public static function baseName(string $name): string
    {
        $stem = pathinfo(basename(str_replace('\\', '/', $name)), PATHINFO_FILENAME);
        $stem = trim((string) preg_replace('/[^\p{L}\p{N} _().,\'-]+/u', ' ', $stem));
        $stem = trim(mb_substr($stem, 0, 60));
        return $stem === '' || str_starts_with($stem, '.') ? 'Scanned page' : $stem;
    }

    private function throttle(int $userId): void
    {
        $since = gmdate('Y-m-d\TH:i:s\Z', time() - 3600);
        $st = $this->db->prepare("SELECT COUNT(*) FROM auth_attempts WHERE ip = ? AND action = 'omr' AND created_at > ?");
        $st->execute(["user:$userId", $since]);
        if ((int) $st->fetchColumn() >= self::PER_HOUR) {
            throw new HttpError(429, 'That is a lot of scanning: please wait a while.');
        }
        $this->db->prepare("INSERT INTO auth_attempts (ip, action, created_at) VALUES (?, 'omr', ?)")->execute(["user:$userId", Http::now()]);
    }

    private static function remove(string $path): void
    {
        if (!file_exists($path)) {
            return;
        }
        if (is_dir($path)) {
            foreach (scandir($path) ?: [] as $f) {
                if ($f !== '.' && $f !== '..') {
                    self::remove($path . DIRECTORY_SEPARATOR . $f);
                }
            }
            @rmdir($path);
        } else {
            @unlink($path);
        }
    }
}
