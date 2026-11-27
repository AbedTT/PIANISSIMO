#!/usr/bin/env python3
"""Pianissimo desktop launcher for macOS and Linux (Python 3.7+, standard library only).

Serves the built web app (the "app" folder next to this file) on http://127.0.0.1:47831 and opens
it in an app window of Chrome, Chromium, Edge or Brave with its own profile, so it works offline and
keeps its saved scores. The port is fixed because the browser keeps saved data per address. When the
last window closes, the launcher exits. Without one of those browsers it opens the default browser
and keeps serving until you press Ctrl+C.

    pianissimo [score files...]

"Scan a page" reads sheet music with Audiveris (https://audiveris.github.io). "Set up the scanner" in the
app downloads it (the pinned release in scanner.json, checked against its SHA-256) into the data folder,
without administrator rights: from its .dmg on macOS, its .deb on Linux (x86_64). A separately installed
Audiveris is found too: PIANISSIMO_AUDIVERIS, "audiveris=" in settings.ini, the Audiveris app on macOS or
`audiveris` on the PATH.

/server/* goes to the online server from settings.ini ("server=https://..."), or PIANISSIMO_SERVER,
if one is set; otherwise the app works locally. Mirrors desktop/windows/Launcher.cs.
"""
import base64
import http.client
import http.cookies
import http.server
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import hashlib
import io
import sys
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import webbrowser

FIRST_PORT, LAST_PORT = 47831, 47840
HERE = os.path.dirname(os.path.realpath(__file__))
APP_DIR = os.path.join(HERE, "app")
MAC = platform.system() == "Darwin"
DATA_DIR = (
    os.path.expanduser("~/Library/Application Support/Pianissimo")
    if MAC
    else os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "pianissimo")
)
PROFILE_DIR = os.path.join(DATA_DIR, "Profile")
SESSION_FILE = os.path.join(DATA_DIR, "session.txt")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.ini")

MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
    ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm", ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
}


def read_version():
    """The installed version (the VERSION file next to this script)."""
    try:
        with open(os.path.join(HERE, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def read_setting(name):
    """A "name=value" line of settings.ini (the last one wins), or ""."""
    value = ""
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            for line in f:
                if line.strip().lower().startswith(name + "="):
                    value = line.strip()[len(name) + 1:].strip()
    return value


def read_server():
    value = os.environ.get("PIANISSIMO_SERVER", "") or read_setting("server")
    return value.rstrip("/") if re.match(r"^https?://[^\s/]+", value or "") else None


# ------------------------------------------------------------------ scanning sheet music (Audiveris)
SCAN_MAX_BYTES = 30 * 1024 * 1024
SCAN_TIME_LIMIT = 300
SCAN_LOCK = threading.Lock()
# Audiveris settings: by default a short line of music (one or two bars) is not taken for a staff and its
# bars are lost; 10 staff spaces still keeps out stray lines (see desktop/windows/Scanner.cs)
SCAN_TUNING = ["-constant", "org.audiveris.omr.sheet.grid.LinesRetriever.minStaffLength=10"]
SCANNER_DIR = os.path.join(DATA_DIR, "scanner")


def own_scanner():
    """The Audiveris that "Set up the scanner" put in the data folder, or None."""
    if MAC:
        exe = os.path.join(SCANNER_DIR, "Audiveris.app", "Contents", "MacOS", "Audiveris")
    else:
        exe = os.path.join(SCANNER_DIR, "audiveris", "bin", "Audiveris")
    return exe if os.path.isfile(exe) and os.access(exe, os.X_OK) else None


def ocr_folder():
    """The text-reading data (titles, lyrics) Pianissimo set up next to its scanner, or None."""
    folder = os.path.join(SCANNER_DIR, "tessdata")
    return folder if os.path.isfile(os.path.join(folder, "eng.traineddata")) else None


class ScanError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def find_audiveris():
    candidates = [own_scanner() or "", os.environ.get("PIANISSIMO_AUDIVERIS", ""), read_setting("audiveris")]
    if MAC:
        for base in ("/Applications", os.path.expanduser("~/Applications")):
            candidates.append(os.path.join(base, "Audiveris.app", "Contents", "MacOS", "Audiveris"))
    candidates += ["/opt/audiveris/bin/Audiveris", "/opt/audiveris/bin/audiveris", shutil.which("audiveris") or "", shutil.which("Audiveris") or ""]
    for c in candidates:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def kind_of(data):
    if data[:4] == b"%PDF":
        return "pdf"
    if data[:4] == b"\x89PNG":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "tif"
    return None


def base_name(name):
    stem = os.path.splitext(os.path.basename(name or ""))[0]
    stem = re.sub(r"[^\w ().,'-]+", " ", stem).strip()[:60].strip()
    return stem if stem and not stem.startswith(".") else "Scanned page"


def scan(data, file_name):
    """Audiveris reads the page; returns the MusicXML and its black-and-white picture of each page."""
    exe = find_audiveris()
    if not exe:
        raise ScanError(501, "Audiveris is not installed on this computer.")
    if len(data) > SCAN_MAX_BYTES:
        raise ScanError(413, "That file is too large to scan (30 MB at most).")
    kind = kind_of(data)
    if not kind:
        raise ScanError(415, "Scan a PDF, PNG, JPEG or TIFF file.")
    with SCAN_LOCK, tempfile.TemporaryDirectory(prefix="pianissimo-scan-") as folder:
        out = os.path.join(folder, "out")
        os.mkdir(out)
        page = os.path.join(folder, base_name(file_name) + "." + kind)
        with open(page, "wb") as f:
            f.write(data)
        try:
            env = dict(os.environ)
            if ocr_folder():
                env["TESSDATA_PREFIX"] = ocr_folder()
            subprocess.run([exe, "-batch", *SCAN_TUNING, "-export", "-output", out, page], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=SCAN_TIME_LIMIT, env=env)
        except subprocess.TimeoutExpired:
            raise ScanError(504, "Reading the music took too long. Try one page at a time.")
        music = book = None
        for root, _dirs, files in os.walk(out):
            for name in sorted(files):
                low = name.lower()
                if not music and low.endswith((".mxl", ".musicxml", ".xml")):
                    music = os.path.join(root, name)
                if not book and low.endswith(".omr"):
                    book = os.path.join(root, name)
        if not music:
            raise ScanError(422, "No music could be recognised on that page. Try a straighter, sharper scan or photo.")
        with open(music, "rb") as f:
            result = {"format": "mxl" if music.lower().endswith(".mxl") else "musicxml", "data": base64.b64encode(f.read()).decode(), "pages": [], "sheets": []}
        if book:
            try:
                with zipfile.ZipFile(book) as z:
                    def from_book(pattern):
                        found = sorted((int(m.group(1)), n) for n in z.namelist() for m in [re.match(pattern, n)] if m)
                        return [base64.b64encode(z.read(n)).decode() for _, n in found]

                    result["pages"] = from_book(r"^sheet#(\d+)/BINARY\.png$")
                    # where each bar is on the pictures (the editor follows the cursor on the page)
                    sheets = from_book(r"^sheet#(\d+)/sheet#\d+\.xml$")
                    result["sheets"] = sheets if len(sheets) == len(result["pages"]) else []
            except (OSError, zipfile.BadZipFile):
                pass
        return result


SERVER = read_server()
TOKEN = secrets.token_hex(16)
PORT = FIRST_PORT
OPEN_FILES = {}


def register(path):
    file_id = secrets.token_hex(16)
    OPEN_FILES[file_id] = path
    return "/__open/%s/%s" % (file_id, urllib.parse.quote(os.path.basename(path), safe=""))


def app_url(import_path=None):
    url = "http://127.0.0.1:%d/app.html" % PORT
    return url + "?file=" + urllib.parse.quote(import_path, safe="") if import_path else url


# ------------------------------------------------------------------ setting up the scanner ("Set up the scanner")
SETUP = {"state": "idle", "percent": 0, "message": ""}
SETUP_LOCK = threading.Lock()


def scanner_pins():
    """The downloads for this computer, from scanner.json next to this script: {"main": …, "ocr": …} or None."""
    try:
        with open(os.path.join(HERE, "scanner.json"), encoding="utf-8") as f:
            pins = json.load(f)
    except (OSError, ValueError):
        return None
    machine = platform.machine().lower()
    if MAC:
        key = "macArm64" if machine in ("arm64", "aarch64") else "macX64"
    elif platform.system() == "Linux" and machine in ("x86_64", "amd64"):
        key = "linuxX64"
    else:
        return None
    main = pins.get(key) or {}
    if not str(main.get("url", "")).startswith("https://") or len(main.get("sha256", "")) != 64:
        return None
    ocr = pins.get("ocr") or {}
    return {"main": main, "ocr": ocr if str(ocr.get("url", "")).startswith("https://") else None}


def setup_megabytes():
    """What "Set up the scanner" still has to download, in MB."""
    pins = scanner_pins()
    if not pins:
        return 0
    size = 0 if own_scanner() else pins["main"]["bytes"]
    if pins["ocr"] and not ocr_folder():
        size += pins["ocr"]["bytes"]
    return round(size / 1048576)


def download(pin, dest, report, done, total):
    """Fetch pin["url"] into dest, checking its size and SHA-256."""
    req = urllib.request.Request(pin["url"], headers={"User-Agent": "Pianissimo/" + read_version()})
    sha = hashlib.sha256()
    have = 0
    with urllib.request.urlopen(req, timeout=60) as res, open(dest, "wb") as out:
        while True:
            chunk = res.read(1 << 16)
            if not chunk:
                break
            out.write(chunk)
            sha.update(chunk)
            have += len(chunk)
            if have > pin["bytes"]:
                raise ScanError(502, "The scanner download is larger than expected.")
            report(int((done + have) * 90 / max(1, total)), "download")
    if have != pin["bytes"]:
        raise ScanError(502, "The scanner download was cut short. Check your internet connection and try again.")
    if sha.hexdigest() != pin["sha256"].lower():
        raise ScanError(502, "The scanner download did not match its checksum, so it was not used.")


def safe_extract(archive, dest):
    """Unpack a tar archive into dest, refusing paths that would leave it."""
    root = os.path.realpath(dest)
    if hasattr(tarfile, "data_filter"):
        archive.extractall(dest, filter="data")
        return
    for m in archive.getmembers():
        target = os.path.realpath(os.path.join(dest, m.name))
        link = (m.issym() or m.islnk()) and (os.path.isabs(m.linkname) or ".." in m.linkname.split("/"))
        if not (target + os.sep).startswith(root + os.sep) or link:
            raise ScanError(502, "The scanner download contains unexpected files.")
    archive.extractall(dest)


def unpack_deb(deb, work):
    """The files of a .deb (an ar archive holding data.tar.*) into work/; returns work/opt/audiveris."""
    with open(deb, "rb") as f:
        data = f.read()
    if data[:8] != b"!<arch>\n":
        raise ScanError(502, "The scanner download is not a Debian package.")
    i, member, payload = 8, None, None
    while i + 60 <= len(data):
        name = data[i:i + 16].decode("ascii", "replace").strip().rstrip("/")
        size = int(data[i + 48:i + 58])
        if name.startswith("data.tar"):
            member, payload = name, data[i + 60:i + 60 + size]
            break
        i += 60 + size + (size % 2)
    if not member:
        raise ScanError(502, "The scanner download has no files in it.")
    out = os.path.join(work, "files")
    os.makedirs(out, exist_ok=True)
    try:
        mode = "r:zst" if member.endswith(".zst") else "r:*"
        with tarfile.open(fileobj=io.BytesIO(payload), mode=mode) as t:
            safe_extract(t, out)
    except (tarfile.TarError, ValueError):
        # Python before 3.14 cannot read zstd: let the system unpack it
        tar = os.path.join(work, member)
        with open(tar, "wb") as f:
            f.write(payload)
        if shutil.which("dpkg-deb"):
            subprocess.run(["dpkg-deb", "-x", deb, out], check=True, timeout=600)
        elif shutil.which("tar") and shutil.which("zstd"):
            subprocess.run(["tar", "--zstd", "-xf", tar, "-C", out], check=True, timeout=600)
        else:
            raise ScanError(502, "Unpacking the scanner needs the zstd tool (for example: sudo apt install zstd).")
    folder = os.path.join(out, "opt", "audiveris")
    if not os.path.isfile(os.path.join(folder, "bin", "Audiveris")):
        raise ScanError(502, "The scanner was unpacked, but Audiveris is missing.")
    return folder


def unpack_dmg(dmg, work):
    """Audiveris.app from a .dmg (macOS): mount it read-only, copy the app, unmount."""
    mount = os.path.join(work, "mnt")
    os.makedirs(mount)
    subprocess.run(["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, dmg],
                   check=True, stdout=subprocess.DEVNULL, timeout=300)
    try:
        apps = [n for n in os.listdir(mount) if n.endswith(".app")]
        if not apps:
            raise ScanError(502, "The scanner download has no app in it.")
        target = os.path.join(work, "Audiveris.app")
        subprocess.run(["ditto", os.path.join(mount, apps[0]), target], check=True, timeout=600)
        return target
    finally:
        subprocess.run(["hdiutil", "detach", mount, "-force"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)


def install_scanner(report):
    """Download and unpack what is missing: Audiveris and/or its text-reading data."""
    pins = scanner_pins()
    if not pins:
        raise ScanError(501, "This copy of Pianissimo cannot set up the scanner on this computer.")
    need_main = own_scanner() is None
    need_ocr = bool(pins["ocr"]) and not ocr_folder()
    total = (pins["main"]["bytes"] if need_main else 0) + (pins["ocr"]["bytes"] if need_ocr else 0)
    work = tempfile.mkdtemp(prefix="pianissimo-scanner-")
    try:
        done = 0
        if need_main:
            file = os.path.join(work, "audiveris.dmg" if MAC else "audiveris.deb")
            download(pins["main"], file, report, done, total)
            done += pins["main"]["bytes"]
            report(int(done * 90 / max(1, total)), "unpack")
            unpacked = unpack_dmg(file, work) if MAC else unpack_deb(file, work)
            fresh = SCANNER_DIR + ".new"
            shutil.rmtree(fresh, ignore_errors=True)
            os.makedirs(fresh)
            shutil.move(unpacked, os.path.join(fresh, "Audiveris.app" if MAC else "audiveris"))
            # text-reading data already there stays
            if os.path.isdir(os.path.join(SCANNER_DIR, "tessdata")):
                shutil.move(os.path.join(SCANNER_DIR, "tessdata"), os.path.join(fresh, "tessdata"))
            with open(os.path.join(fresh, "VERSION"), "w", encoding="utf-8") as f:
                f.write(json.load(open(os.path.join(HERE, "scanner.json"), encoding="utf-8")).get("version", "") + "\n")
            shutil.rmtree(SCANNER_DIR, ignore_errors=True)
            os.replace(fresh, SCANNER_DIR)
        if need_ocr:
            file = os.path.join(work, "eng.traineddata")
            download(pins["ocr"], file, report, done, total)
            folder = os.path.join(SCANNER_DIR, "tessdata")
            os.makedirs(folder, exist_ok=True)
            shutil.move(file, os.path.join(folder, "eng.traineddata"))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def start_setup():
    with SETUP_LOCK:
        if SETUP["state"] == "working":
            return
        SETUP.update(state="working", percent=0, message="Starting…")

    def report(percent, what):
        with SETUP_LOCK:
            SETUP["percent"] = max(0, min(100, percent))
            SETUP["message"] = what

    def run():
        try:
            install_scanner(report)
            with SETUP_LOCK:
                SETUP.update(state="done", percent=100, message="The music scanner is ready.")
        except ScanError as err:
            with SETUP_LOCK:
                SETUP.update(state="error", message=str(err))
        except (OSError, urllib.error.URLError, subprocess.SubprocessError):
            with SETUP_LOCK:
                SETUP.update(state="error", message="The scanner could not be downloaded. Check your internet connection and try again.")

    threading.Thread(target=run, daemon=True).start()


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "Pianissimo"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send(self, code, body, ctype="text/plain; charset=utf-8", extra=(), head=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if not head:
            self.wfile.write(body)
        self.close_connection = True

    def route(self):
        # only this computer's own pages may talk to us (blocks DNS-rebinding tricks)
        if self.headers.get("Host") not in ("127.0.0.1:%d" % PORT, "localhost:%d" % PORT):
            return self.send(403, b"Forbidden")
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/__pianissimo/"):
            if self.headers.get("X-Pianissimo-Token") != TOKEN:
                return self.send(403, b"Forbidden")
            if path == "/__pianissimo/register":
                length = int(self.headers.get("Content-Length") or 0)
                target = self.rfile.read(length).decode("utf-8")
                if not os.path.isfile(target):
                    return self.send(404, b"No such file")
                return self.send(200, register(target).encode())
            return self.send(200, b"ok")
        if path == "/__desktop.json":
            # tells the app it runs as the desktop app, so it checks for new releases (and offers the download)
            info = {
                "platform": "macos" if MAC else "linux", "version": read_version(), "canInstall": False,
                "scan": bool(find_audiveris()), "scannerSetup": bool(scanner_pins()), "scannerOcr": bool(ocr_folder()),
                "scannerMegabytes": setup_megabytes(),
            }
            return self.send(200, json.dumps(info).encode(), "application/json", [("Cache-Control", "no-store")], self.command == "HEAD")
        if path == "/__desktop/scanner/setup":
            # "Set up the scanner": POST (our own page only) starts it, GET says how far it is
            if self.command == "POST":
                origin = self.headers.get("Origin")
                ours = origin in ("http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT)
                if self.headers.get("X-Pianissimo-Desktop") != "1" or not ours or not scanner_pins():
                    return self.send(403, b"Forbidden")
                start_setup()
            with SETUP_LOCK:
                body = json.dumps(SETUP).encode()
            return self.send(200, body, "application/json", [("Cache-Control", "no-store")])
        if path == "/__desktop/scan":
            # "Scan a page": only from our own page (custom header + our Origin), the file is the body
            origin = self.headers.get("Origin")
            ours = origin in ("http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT)
            if self.command != "POST" or self.headers.get("X-Pianissimo-Desktop") != "1" or not ours:
                return self.send(403, b"Forbidden")
            length = int(self.headers.get("Content-Length") or 0)
            if length > SCAN_MAX_BYTES:
                return self.send(413, json.dumps({"error": "That file is too large to scan (30 MB at most)."}).encode(), "application/json")
            data = self.rfile.read(length)
            try:
                result = scan(data, urllib.parse.unquote(self.headers.get("X-File-Name") or ""))
                return self.send(200, json.dumps({"result": result}).encode(), "application/json", [("Cache-Control", "no-store")])
            except ScanError as err:
                return self.send(err.status, json.dumps({"error": str(err)}).encode(), "application/json", [("Cache-Control", "no-store")])
            except OSError as err:
                return self.send(500, json.dumps({"error": "Audiveris could not read that file: %s" % err}).encode(), "application/json")
        if path.startswith("/__open/"):
            parts = path.split("/")
            target = OPEN_FILES.get(parts[2]) if len(parts) > 2 else None
            if not target or not os.path.isfile(target):
                return self.send(404, b"Not found")
            with open(target, "rb") as f:
                return self.send(200, f.read(), "application/octet-stream", [("Cache-Control", "no-store")], self.command == "HEAD")
        if path.startswith("/server/"):
            if not SERVER:
                msg = (
                    "This copy of Pianissimo is not connected to an online server, so signing in, sharing and the online "
                    "library are off. Your scores are saved on this computer. To connect, put server=<address of your "
                    "Pianissimo website> in %s and restart Pianissimo." % SETTINGS_FILE
                )
                return self.send(503, json.dumps({"error": msg}).encode(), "application/json", [("Cache-Control", "no-store")])
            return self.proxy()
        if self.command not in ("GET", "HEAD"):
            return self.send(405, b"Method not allowed")
        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        root = os.path.realpath(APP_DIR)
        full = os.path.realpath(os.path.join(root, rel))
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not (full + os.sep).startswith(root + os.sep) or not os.path.isfile(full):
            return self.send(404, b"Not found", head=self.command == "HEAD")
        cache = "public, max-age=31536000, immutable" if path.startswith("/assets/") else "no-cache"
        with open(full, "rb") as f:
            body = f.read()
        ctype = MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        self.send(200, body, ctype, [("Cache-Control", cache)], self.command == "HEAD")

    def proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        skip = {"host", "connection", "content-length", "accept-encoding", "origin", "referer", "upgrade", "keep-alive", "transfer-encoding", "expect"}
        headers = {k: v for k, v in self.headers.items() if k.lower() not in skip}
        req = urllib.request.Request(SERVER + self.path, data=body, headers=headers, method=self.command)

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None

        opener = urllib.request.build_opener(NoRedirect)
        try:
            res = opener.open(req, timeout=120)
        except urllib.error.HTTPError as err:
            res = err
        except (urllib.error.URLError, OSError):
            msg = "Cannot reach the Pianissimo server at %s. Check your internet connection." % SERVER
            return self.send(502, json.dumps({"error": msg}).encode(), "application/json", [("Cache-Control", "no-store")])
        data = res.read()
        extra = [(k, res.headers[k]) for k in ("Cache-Control", "Location") if res.headers.get(k)]
        # cookies for this address: no Domain, and no Secure (this is a loopback connection)
        for raw in res.headers.get_all("Set-Cookie") or []:
            parts = [p.strip() for p in raw.split(";")]
            keep = [parts[0]] + [p for p in parts[1:] if p.split("=")[0].strip().lower() not in ("domain", "secure", "path")]
            extra.append(("Set-Cookie", "; ".join(keep + ["Path=/"])))
        self.send(res.status if hasattr(res, "status") else res.code, data, res.headers.get("Content-Type", "application/octet-stream"), extra, self.command == "HEAD")

    def do_GET(self):
        self.route()

    do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = do_GET


def find_browser():
    if MAC:
        apps = ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser", "Vivaldi"]
        for name in apps:
            for base in ("/Applications", os.path.expanduser("~/Applications")):
                exe = os.path.join(base, name + ".app", "Contents", "MacOS", name)
                if os.path.exists(exe):
                    return exe
        return None
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser", "vivaldi"):
        exe = shutil.which(name)
        if exe:
            return exe
    return None


def open_window(browser, url):
    args = [browser, "--app=" + url, "--user-data-dir=" + PROFILE_DIR, "--no-first-run", "--no-default-browser-check", "--window-size=1320,880"]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def profile_in_use():
    # Chromium keeps a SingletonLock symlink in the profile while it runs
    return os.path.islink(os.path.join(PROFILE_DIR, "SingletonLock"))


def call(base, token, path, body=None):
    req = urllib.request.Request(base + path, data=body.encode() if body is not None else None, headers={"X-Pianissimo-Token": token})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=2) as res:
        return res.read().decode()


def hand_over(files, browser):
    """Pianissimo already runs: let it serve the files and just open windows."""
    global PORT
    try:
        with open(SESSION_FILE, encoding="utf-8") as f:
            port_text, token = f.read().split()[:2]
        base = "http://127.0.0.1:" + port_text
        if call(base, token, "/__pianissimo/ping") != "ok":
            return False
        PORT = int(port_text)
        urls = [app_url(call(base, token, "/__pianissimo/register", path)) for path in files] or [app_url()]
    except (OSError, ValueError, urllib.error.URLError):
        return False
    for url in urls:
        open_window(browser, url) if browser else webbrowser.open(url)
    return True


def setup_from_terminal():
    """pianissimo.py --setup-scanner (install.sh runs it): set up the music scanner, showing progress."""
    if not scanner_pins():
        print("The music scanner cannot be set up automatically on this computer.")
        return 1
    if not setup_megabytes():
        print("The music scanner is already set up.")
        return 0
    print("Setting up the music scanner (about %d MB)…" % setup_megabytes())
    last = [-1]

    def report(percent, what):
        if percent // 5 != last[0]:
            last[0] = percent // 5
            print("  %s %d%%" % ("unpacking" if what == "unpack" else "downloading", percent), flush=True)

    try:
        install_scanner(report)
    except ScanError as err:
        print("Not set up: %s" % err)
        return 1
    except (OSError, urllib.error.URLError, subprocess.SubprocessError) as err:
        print("Not set up: the download failed (%s). Check your internet connection." % err)
        return 1
    print("The music scanner is ready: in Pianissimo, use Import > Scan a page.")
    return 0


def main():
    global PORT
    os.makedirs(DATA_DIR, exist_ok=True)
    if "--setup-scanner" in sys.argv[1:]:
        sys.exit(setup_from_terminal())
    if not os.path.isfile(os.path.join(APP_DIR, "app.html")):
        sys.exit("Pianissimo: the app files are missing (%s). Please reinstall." % APP_DIR)
    files = [os.path.abspath(a) for a in sys.argv[1:] if os.path.isfile(a)]
    browser = find_browser()
    if hand_over(files, browser):
        return
    httpd = None
    for port in range(FIRST_PORT, LAST_PORT + 1):
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
            PORT = port
            break
        except OSError:
            continue
    if httpd is None:
        sys.exit("Pianissimo could not start its local server (ports %d-%d are busy)." % (FIRST_PORT, LAST_PORT))
    httpd.daemon_threads = True
    with open(SESSION_FILE, "w", encoding="utf-8") as f:
        f.write("%d\n%s\n" % (PORT, TOKEN))
    os.chmod(SESSION_FILE, 0o600)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    urls = [app_url(register(path)) for path in files] or [app_url()]
    try:
        if browser:
            first = open_window(browser, urls[0])
            for url in urls[1:]:
                time.sleep(0.8)
                open_window(browser, url)
            first.wait()
            time.sleep(1.5)
            while profile_in_use():
                time.sleep(2)
        else:
            for url in urls:
                webbrowser.open(url)
            print("Pianissimo is running at %s. Press Ctrl+C to quit." % app_url())
            while True:
                time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.remove(SESSION_FILE)
        except OSError:
            pass


if __name__ == "__main__":
    main()
