#!/usr/bin/env python3
"""Pianissimo desktop launcher for macOS and Linux (Python 3.7+, standard library only).

Serves the built web app (the "app" folder next to this file) on http://127.0.0.1:47831 and opens
it in an app window of Chrome, Chromium, Edge or Brave with its own profile, so it works offline and
keeps its saved scores. The port is fixed because the browser keeps saved data per address. When the
last window closes, the launcher exits. Without one of those browsers it opens the default browser
and keeps serving until you press Ctrl+C.

    pianissimo [score files...]

/server/* goes to the online server from settings.ini ("server=https://..."), or PIANISSIMO_SERVER,
if one is set; otherwise the app works locally. Mirrors desktop/windows/Launcher.cs.
"""
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
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
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


def read_server():
    value = os.environ.get("PIANISSIMO_SERVER", "")
    if not value and os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            for line in f:
                if line.strip().lower().startswith("server="):
                    value = line.strip()[7:].strip()
    return value.rstrip("/") if re.match(r"^https?://[^\s/]+", value or "") else None


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


def main():
    global PORT
    if not os.path.isfile(os.path.join(APP_DIR, "app.html")):
        sys.exit("Pianissimo: the app files are missing (%s). Please reinstall." % APP_DIR)
    os.makedirs(DATA_DIR, exist_ok=True)
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
