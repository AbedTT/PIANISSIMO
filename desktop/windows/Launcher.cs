// Pianissimo.exe: the desktop app on Windows.
//
// Serves the built web app (the "app" folder next to this file) on http://127.0.0.1:47831 and opens it
// in an app window of Microsoft Edge (or Chrome) with its own profile, so it has its own taskbar
// entry, works offline and keeps its saved scores. The port is fixed because the browser keeps
// saved data per address. When the last window closes, the launcher exits.
//
//   Pianissimo.exe [score files…]   open the editor (and the given files)
//   Pianissimo.exe --uninstall [/S]  remove Pianissimo (used by Apps & features)
//   Pianissimo.exe --no-window       only run the local server (for tests); stop it with Task Manager
//
// /server/* goes to the online server from settings.ini, if one is set (sign-in, sharing, library);
// otherwise the app works locally and says the online features need a server.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Pianissimo
{
    static class Launcher
    {
        const int FirstPort = 47831;
        const int LastPort = 47840;
        static string appDir;
        static string sessionFile;
        static string token;
        static string server;
        static int port;
        static readonly Dictionary<string, string> openFiles = new Dictionary<string, string>();

        [STAThread]
        static int Main(string[] args)
        {
            try
            {
                if (args.Length > 0 && args[0] == "--uninstall") return Uninstaller.Run(args);
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2 for the online server
                appDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
                if (!File.Exists(Path.Combine(appDir, "app.html")))
                {
                    MessageBox.Show("The app files are missing (" + appDir + "). Please reinstall Pianissimo.", Common.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                Directory.CreateDirectory(Common.DataDir);
                sessionFile = Path.Combine(Common.DataDir, "session.txt");
                server = Common.ReadServer();
                List<string> files = new List<string>();
                foreach (string a in args)
                {
                    if (File.Exists(a)) files.Add(Path.GetFullPath(a));
                }
                string browser = FindBrowser();

                // Pianissimo is already running: let that copy serve the files and just open windows.
                if (Array.IndexOf(args, "--no-window") < 0 && HandOver(files, browser)) return 0;

                TcpListener listener = Bind();
                if (listener == null)
                {
                    MessageBox.Show("Pianissimo could not start its local server (ports " + FirstPort + "–" + LastPort + " are busy).", Common.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                token = RandomHex(16);
                File.WriteAllText(sessionFile, port + "\n" + token);
                Thread serveThread = new Thread(delegate () { Serve(listener); });
                serveThread.IsBackground = true;
                serveThread.Start();

                List<string> urls = new List<string>();
                foreach (string f in files) urls.Add(AppUrl(Register(f)));
                if (urls.Count == 0) urls.Add(AppUrl(null));

                if (Array.IndexOf(args, "--no-window") >= 0) Thread.Sleep(Timeout.Infinite);
                else if (browser != null)
                {
                    Process first = OpenWindow(browser, urls[0]);
                    for (int i = 1; i < urls.Count; i++)
                    {
                        Thread.Sleep(800);
                        OpenWindow(browser, urls[i]);
                    }
                    first.WaitForExit();
                    // the browser can hand its windows to another process of the same profile: wait for all of them
                    Thread.Sleep(1500);
                    while (Common.ProfileInUse()) Thread.Sleep(2000);
                }
                else
                {
                    foreach (string u in urls) Process.Start(u);
                    RunTray();
                }
                try { File.Delete(sessionFile); } catch { }
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show("Pianissimo could not start:\n\n" + ex.Message, Common.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        static string AppUrl(string importPath)
        {
            string url = "http://127.0.0.1:" + port + "/app.html";
            return importPath == null ? url : url + "?file=" + Uri.EscapeDataString(importPath);
        }

        static string RandomHex(int bytes)
        {
            byte[] b = new byte[bytes];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            StringBuilder sb = new StringBuilder();
            foreach (byte x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }

        static TcpListener Bind()
        {
            for (int p = FirstPort; p <= LastPort; p++)
            {
                try
                {
                    TcpListener l = new TcpListener(IPAddress.Loopback, p);
                    l.ExclusiveAddressUse = true;
                    l.Start();
                    port = p;
                    return l;
                }
                catch (SocketException) { }
            }
            return null;
        }

        static string Register(string path)
        {
            string id = RandomHex(16);
            lock (openFiles) openFiles[id] = path;
            return "/__open/" + id + "/" + Uri.EscapeDataString(Path.GetFileName(path));
        }

        // ------------------------------------------------------------------ a second launch
        static bool HandOver(List<string> files, string browser)
        {
            if (!File.Exists(sessionFile)) return false;
            string[] lines = File.ReadAllLines(sessionFile);
            int otherPort;
            if (lines.Length < 2 || !int.TryParse(lines[0], out otherPort)) return false;
            string otherToken = lines[1].Trim();
            string baseUrl = "http://127.0.0.1:" + otherPort;
            try
            {
                if (Call(baseUrl + "/__pianissimo/ping", otherToken, null) != "ok") return false;
                port = otherPort;
                List<string> urls = new List<string>();
                foreach (string f in files) urls.Add(AppUrl(Call(baseUrl + "/__pianissimo/register", otherToken, f)));
                if (urls.Count == 0) urls.Add(AppUrl(null));
                foreach (string u in urls)
                {
                    if (browser != null) OpenWindow(browser, u);
                    else Process.Start(u);
                }
                return true;
            }
            catch
            {
                return false; // a stale session file: start our own server
            }
        }

        static string Call(string url, string key, string body)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 2000;
            req.Proxy = null;
            req.Headers["X-Pianissimo-Token"] = key;
            if (body != null)
            {
                req.Method = "POST";
                byte[] data = Encoding.UTF8.GetBytes(body);
                req.ContentLength = data.Length;
                using (Stream s = req.GetRequestStream()) s.Write(data, 0, data.Length);
            }
            using (WebResponse res = req.GetResponse())
            using (StreamReader r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                return r.ReadToEnd();
        }

        // ------------------------------------------------------------------ the app window
        static string FindBrowser()
        {
            List<string> candidates = new List<string>();
            foreach (string exe in new[] { "msedge.exe", "chrome.exe", "brave.exe" })
            {
                foreach (RegistryKey root in new[] { Registry.CurrentUser, Registry.LocalMachine })
                {
                    using (RegistryKey k = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                    {
                        if (k != null && k.GetValue("") is string) candidates.Add(((string)k.GetValue("")).Trim('"'));
                    }
                }
            }
            string[] roots =
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            };
            foreach (string root in roots)
            {
                if (string.IsNullOrEmpty(root)) continue;
                candidates.Add(Path.Combine(root, @"Microsoft\Edge\Application\msedge.exe"));
                candidates.Add(Path.Combine(root, @"Google\Chrome\Application\chrome.exe"));
            }
            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            return null;
        }

        static Process OpenWindow(string browser, string url)
        {
            ProcessStartInfo psi = new ProcessStartInfo(browser,
                "--app=\"" + url + "\" --user-data-dir=\"" + Common.ProfileDir + "\" --no-first-run --no-default-browser-check --window-size=1320,880");
            psi.UseShellExecute = false;
            return Process.Start(psi);
        }

        /// <summary>No Edge or Chrome: the app opened in the default browser, so keep serving until Quit.</summary>
        static void RunTray()
        {
            NotifyIcon icon = new NotifyIcon();
            icon.Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            icon.Text = "Pianissimo is running";
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("Open Pianissimo", delegate { Process.Start(AppUrl(null)); });
            menu.MenuItems.Add("Quit", delegate { icon.Visible = false; Application.Exit(); });
            icon.ContextMenu = menu;
            icon.DoubleClick += delegate { Process.Start(AppUrl(null)); };
            icon.Visible = true;
            icon.ShowBalloonTip(4000, "Pianissimo", "Pianissimo opened in your browser. Quit it from this icon.", ToolTipIcon.Info);
            Application.Run();
        }

        // ------------------------------------------------------------------ a small HTTP server
        static void Serve(TcpListener listener)
        {
            while (true)
            {
                TcpClient client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(delegate { Handle(client); });
            }
        }

        class Request
        {
            public string Method;
            public string Target;
            public string Path;
            public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public byte[] Body = new byte[0];
            public string Header(string name)
            {
                string v;
                return Headers.TryGetValue(name, out v) ? v : null;
            }
        }

        static void Handle(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 30000;
                    client.SendTimeout = 60000;
                    NetworkStream stream = client.GetStream();
                    Request req = ReadRequest(stream);
                    if (req == null) return;
                    Route(stream, req);
                }
                catch (Exception)
                {
                    // the browser closed the connection, or a malformed request: nothing to answer
                }
            }
        }

        static Request ReadRequest(Stream s)
        {
            byte[] buf = new byte[65536];
            int len = 0, headEnd = -1;
            while (headEnd < 0)
            {
                if (len == buf.Length) return null;
                int n = s.Read(buf, len, buf.Length - len);
                if (n <= 0) return null;
                len += n;
                for (int i = Math.Max(0, len - n - 3); i + 3 < len; i++)
                {
                    if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10) { headEnd = i; break; }
                }
            }
            string[] lines = Encoding.ASCII.GetString(buf, 0, headEnd).Split(new[] { "\r\n" }, StringSplitOptions.None);
            string[] first = lines[0].Split(' ');
            if (first.Length < 3) return null;
            Request req = new Request();
            req.Method = first[0];
            req.Target = first[1];
            int q = req.Target.IndexOf('?');
            req.Path = q < 0 ? req.Target : req.Target.Substring(0, q);
            for (int i = 1; i < lines.Length; i++)
            {
                int c = lines[i].IndexOf(':');
                if (c > 0) req.Headers[lines[i].Substring(0, c).Trim()] = lines[i].Substring(c + 1).Trim();
            }
            long length;
            if (long.TryParse(req.Header("Content-Length") ?? "0", out length) && length > 0)
            {
                if (length > 100L * 1024 * 1024) return null;
                byte[] body = new byte[length];
                int have = Math.Min(len - (headEnd + 4), (int)length);
                Array.Copy(buf, headEnd + 4, body, 0, have);
                while (have < length)
                {
                    int n = s.Read(body, have, (int)length - have);
                    if (n <= 0) return null;
                    have += n;
                }
                req.Body = body;
            }
            return req;
        }

        static void Route(Stream s, Request req)
        {
            // only this computer's own pages may talk to us (blocks DNS-rebinding tricks)
            string host = req.Header("Host");
            if (host != "127.0.0.1:" + port && host != "localhost:" + port)
            {
                Send(s, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Forbidden"), false, null);
                return;
            }
            if (req.Path.StartsWith("/__pianissimo/"))
            {
                if (req.Header("X-Pianissimo-Token") != token)
                {
                    Send(s, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Forbidden"), false, null);
                    return;
                }
                string answer = "ok";
                if (req.Path == "/__pianissimo/register")
                {
                    string path = Encoding.UTF8.GetString(req.Body);
                    if (!File.Exists(path))
                    {
                        Send(s, 404, "Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("No such file"), false, null);
                        return;
                    }
                    answer = Register(path);
                }
                Send(s, 200, "OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(answer), false, null);
                return;
            }
            if (req.Path == "/__desktop.json")
            {
                // tells the app it runs as the desktop app: it then checks for new releases
                // and whether it can scan sheet music here (Audiveris is installed)
                string info = "{\"platform\":\"windows\",\"version\":" + JsonString(BuildInfo.Version) + ",\"canInstall\":" + (Updater.CanInstall ? "true" : "false") +
                    ",\"scan\":" + (Scanner.Find() != null ? "true" : "false") +
                    ",\"scannerSetup\":" + (ScannerSetup.Possible ? "true" : "false") +
                    ",\"scannerOcr\":" + (Scanner.OcrFolder() != null ? "true" : "false") +
                    ",\"scannerMegabytes\":" + ScannerSetup.DownloadMegabytes(AppDomain.CurrentDomain.BaseDirectory) + "}";
                Send(s, 200, "OK", "application/json", Encoding.UTF8.GetBytes(info), req.Method == "HEAD", new[] { "Cache-Control: no-store" });
                return;
            }
            if (req.Path == "/__desktop/update")
            {
                // "Update now": only from our own page (the custom header cannot be sent by other sites without
                // a permission this server never gives; the Origin must be ours too)
                if (!FromOurPage(req))
                {
                    Send(s, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Forbidden"), false, null);
                    return;
                }
                try
                {
                    if (!Updater.CanInstall && !Updater.DryRun) throw new Exception("This copy of Pianissimo is not installed (the portable version): download the new version instead.");
                    string setup = Updater.Prepare();
                    if (!Updater.DryRun) Updater.Run(setup);
                    Send(s, 200, "OK", "application/json", Encoding.UTF8.GetBytes("{\"ok\":true,\"setup\":" + JsonString(Path.GetFileName(setup)) + "}"), false, new[] { "Cache-Control: no-store" });
                }
                catch (Exception ex)
                {
                    Send(s, 500, "Internal Server Error", "application/json", Encoding.UTF8.GetBytes("{\"error\":" + JsonString(ex.Message) + "}"), false, new[] { "Cache-Control: no-store" });
                }
                return;
            }
            if (req.Path == "/__desktop/scanner/setup")
            {
                // "Set up the scanner": POST starts downloading Audiveris into our folder; GET says how far it is
                if (req.Method == "POST")
                {
                    if (!FromOurPage(req) || !ScannerSetup.Possible)
                    {
                        Send(s, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Forbidden"), false, null);
                        return;
                    }
                    ScannerSetup.Start(AppDomain.CurrentDomain.BaseDirectory);
                }
                string st, msg;
                int pct;
                ScannerSetup.Status(out st, out pct, out msg);
                string body = "{\"state\":" + JsonString(st) + ",\"percent\":" + pct + ",\"message\":" + JsonString(msg) + "}";
                Send(s, 200, "OK", "application/json", Encoding.UTF8.GetBytes(body), false, new[] { "Cache-Control: no-store" });
                return;
            }
            if (req.Path == "/__desktop/scan")
            {
                // "Scan a page…": the file is the body; Audiveris on this computer reads it
                if (!FromOurPage(req))
                {
                    Send(s, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Forbidden"), false, null);
                    return;
                }
                try
                {
                    Scanner.Result r = Scanner.Scan(req.Body, Uri.UnescapeDataString(req.Header("X-File-Name") ?? ""));
                    StringBuilder json = new StringBuilder("{\"result\":{\"format\":\"").Append(r.Format)
                        .Append("\",\"data\":\"").Append(Convert.ToBase64String(r.Music)).Append("\",\"pages\":[");
                    for (int i = 0; i < r.Pages.Count; i++)
                    {
                        if (i > 0) json.Append(',');
                        json.Append('"').Append(Convert.ToBase64String(r.Pages[i])).Append('"');
                    }
                    json.Append("],\"sheets\":[");
                    for (int i = 0; i < r.Sheets.Count; i++)
                    {
                        if (i > 0) json.Append(',');
                        json.Append('"').Append(Convert.ToBase64String(r.Sheets[i])).Append('"');
                    }
                    json.Append("]}}");
                    Send(s, 200, "OK", "application/json", Encoding.UTF8.GetBytes(json.ToString()), false, new[] { "Cache-Control: no-store" });
                }
                catch (Exception ex)
                {
                    ScanError se = ex as ScanError;
                    int code = se != null ? se.Status : 500;
                    string message = se != null ? ex.Message : "Audiveris could not read that file: " + ex.Message;
                    Send(s, code, "Error", "application/json", Encoding.UTF8.GetBytes("{\"error\":" + JsonString(message) + "}"), false, new[] { "Cache-Control: no-store" });
                }
                return;
            }
            if (req.Path.StartsWith("/__open/"))
            {
                string[] parts = req.Path.Split('/');
                string path = null;
                if (parts.Length >= 3) lock (openFiles) openFiles.TryGetValue(parts[2], out path);
                if (path == null || !File.Exists(path))
                {
                    Send(s, 404, "Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"), false, null);
                    return;
                }
                Send(s, 200, "OK", "application/octet-stream", File.ReadAllBytes(path), req.Method == "HEAD", new[] { "Cache-Control: no-store" });
                return;
            }
            if (req.Path.StartsWith("/server/"))
            {
                if (server == null)
                {
                    string msg = "{\"error\":\"This copy of Pianissimo is not connected to an online server, so signing in, sharing and the online library are off. " +
                        "Your scores are saved on this computer. To connect, put server=<address of your Pianissimo website> in " +
                        Common.SettingsFile.Replace("\\", "\\\\") + " and restart Pianissimo.\"}";
                    Send(s, 503, "Service Unavailable", "application/json", Encoding.UTF8.GetBytes(msg), false, new[] { "Cache-Control: no-store" });
                }
                else Proxy(s, req);
                return;
            }
            ServeStatic(s, req);
        }

        static void ServeStatic(Stream s, Request req)
        {
            if (req.Method != "GET" && req.Method != "HEAD")
            {
                Send(s, 405, "Method Not Allowed", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Method not allowed"), false, null);
                return;
            }
            string full = null;
            try
            {
                string rel = Uri.UnescapeDataString(req.Path).TrimStart('/').Replace('/', '\\');
                if (rel == "") rel = "index.html";
                string root = Path.GetFullPath(appDir).TrimEnd('\\') + "\\";
                full = Path.GetFullPath(Path.Combine(root, rel));
                if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) full = null;
                else if (Directory.Exists(full)) full = Path.Combine(full, "index.html");
            }
            catch (Exception)
            {
                full = null;
            }
            if (full == null || !File.Exists(full))
            {
                Send(s, 404, "Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"), req.Method == "HEAD", null);
                return;
            }
            string cache = req.Path.StartsWith("/assets/") ? "Cache-Control: public, max-age=31536000, immutable" : "Cache-Control: no-cache";
            Send(s, 200, "OK", MimeType(full), File.ReadAllBytes(full), req.Method == "HEAD", new[] { cache });
        }

        /// <summary>A request from Pianissimo's own page: a POST with our custom header (other websites cannot
        /// send it to this computer without a permission this server never gives) and our Origin.</summary>
        static bool FromOurPage(Request req)
        {
            string origin = req.Header("Origin");
            bool ours = origin == "http://127.0.0.1:" + port || origin == "http://localhost:" + port;
            return req.Method == "POST" && req.Header("X-Pianissimo-Desktop") == "1" && ours;
        }

        static string JsonString(string value)
        {
            StringBuilder sb = new StringBuilder("\"");
            foreach (char c in value ?? "")
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        static string MimeType(string path)
        {
            switch (Path.GetExtension(path).ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js":
                case ".mjs": return "text/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json";
                case ".webmanifest": return "application/manifest+json";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".ico": return "image/x-icon";
                case ".woff2": return "font/woff2";
                case ".woff": return "font/woff";
                case ".ttf": return "font/ttf";
                case ".wasm": return "application/wasm";
                case ".mp3": return "audio/mpeg";
                case ".ogg": return "audio/ogg";
                case ".wav": return "audio/wav";
                case ".txt": return "text/plain; charset=utf-8";
                case ".xml": return "application/xml";
                default: return "application/octet-stream";
            }
        }

        static void Send(Stream s, int code, string reason, string type, byte[] body, bool headOnly, string[] extra)
        {
            StringBuilder head = new StringBuilder();
            head.Append("HTTP/1.1 ").Append(code).Append(' ').Append(reason).Append("\r\n");
            head.Append("Content-Type: ").Append(type).Append("\r\n");
            head.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            head.Append("X-Content-Type-Options: nosniff\r\n");
            head.Append("Connection: close\r\n");
            if (extra != null)
            {
                foreach (string h in extra) head.Append(h).Append("\r\n");
            }
            head.Append("\r\n");
            byte[] h2 = Encoding.UTF8.GetBytes(head.ToString());
            s.Write(h2, 0, h2.Length);
            if (!headOnly) s.Write(body, 0, body.Length);
            s.Flush();
        }

        // ------------------------------------------------------------------ the online server
        static readonly HashSet<string> SkipRequestHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Host", "Connection", "Content-Length", "Accept-Encoding", "Origin", "Referer", "Cookie", "Expect",
            "Upgrade", "Proxy-Connection", "Keep-Alive", "Transfer-Encoding", "Content-Type", "Accept", "User-Agent",
        };

        static void Proxy(Stream s, Request req)
        {
            Uri target = new Uri(server + req.Target);
            HttpWebRequest fwd = (HttpWebRequest)WebRequest.Create(target);
            fwd.Method = req.Method;
            fwd.AllowAutoRedirect = false;
            fwd.Timeout = 120000;
            fwd.ReadWriteTimeout = 120000;
            fwd.CookieContainer = new CookieContainer();
            fwd.ContentType = req.Header("Content-Type");
            fwd.Accept = req.Header("Accept");
            fwd.UserAgent = req.Header("User-Agent");
            string cookies = req.Header("Cookie");
            if (cookies != null)
            {
                foreach (string part in cookies.Split(';'))
                {
                    int eq = part.IndexOf('=');
                    if (eq <= 0) continue;
                    try { fwd.CookieContainer.Add(target, new Cookie(part.Substring(0, eq).Trim(), part.Substring(eq + 1).Trim(), "/")); } catch { }
                }
            }
            foreach (KeyValuePair<string, string> h in req.Headers)
            {
                if (SkipRequestHeaders.Contains(h.Key)) continue;
                try { fwd.Headers[h.Key] = h.Value; } catch { }
            }
            if (req.Body.Length > 0 || req.Method == "POST" || req.Method == "PUT")
            {
                fwd.ContentLength = req.Body.Length;
                using (Stream up = fwd.GetRequestStream()) up.Write(req.Body, 0, req.Body.Length);
            }
            HttpWebResponse res;
            try
            {
                res = (HttpWebResponse)fwd.GetResponse();
            }
            catch (WebException ex)
            {
                res = ex.Response as HttpWebResponse;
                if (res == null)
                {
                    string msg = "{\"error\":\"Cannot reach the Pianissimo server at " + server.Replace("\"", "") + ". Check your internet connection.\"}";
                    Send(s, 502, "Bad Gateway", "application/json", Encoding.UTF8.GetBytes(msg), false, new[] { "Cache-Control: no-store" });
                    return;
                }
            }
            using (res)
            {
                byte[] body;
                using (MemoryStream ms = new MemoryStream())
                {
                    using (Stream down = res.GetResponseStream()) down.CopyTo(ms);
                    body = ms.ToArray();
                }
                List<string> extra = new List<string>();
                string cache = res.Headers["Cache-Control"];
                if (cache != null) extra.Add("Cache-Control: " + cache);
                string location = res.Headers["Location"];
                if (location != null) extra.Add("Location: " + location);
                // rebuild cookies for this address: no Domain, and no Secure (this is a loopback connection)
                foreach (Cookie c in res.Cookies)
                {
                    string line = "Set-Cookie: " + c.Name + "=" + c.Value + "; Path=/; SameSite=Lax";
                    if (c.HttpOnly) line += "; HttpOnly";
                    if (c.Expired) line += "; Max-Age=0";
                    else if (c.Expires != DateTime.MinValue) line += "; Max-Age=" + Math.Max(0, (long)(c.Expires.ToUniversalTime() - DateTime.UtcNow).TotalSeconds);
                    extra.Add(line);
                }
                Send(s, (int)res.StatusCode, res.StatusDescription, res.ContentType ?? "application/octet-stream", body, req.Method == "HEAD", extra.ToArray());
            }
        }
    }

    /// <summary>Pianissimo.exe --uninstall: what "Uninstall" in Apps &amp; features runs.</summary>
    static class Uninstaller
    {
        public static int Run(string[] args)
        {
            bool quiet = Array.IndexOf(args, "/S") >= 0 || Array.IndexOf(args, "--quiet") >= 0;
            if (!quiet && MessageBox.Show("Remove Pianissimo from this computer?", "Uninstall Pianissimo", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
            while (!quiet && Common.ProfileInUse())
            {
                if (MessageBox.Show("Please close all Pianissimo windows first.", "Uninstall Pianissimo", MessageBoxButtons.RetryCancel, MessageBoxIcon.Information) != DialogResult.Retry) return 1;
            }
            int self = Process.GetCurrentProcess().Id;
            foreach (Process p in Process.GetProcessesByName("Pianissimo"))
            {
                if (p.Id != self) try { p.Kill(); } catch { }
            }
            // a scan still running from our scanner folder would keep its files locked
            string scannerDir = ScannerSetup.Folder(AppDomain.CurrentDomain.BaseDirectory);
            foreach (Process p in Process.GetProcessesByName("Audiveris"))
            {
                try
                {
                    if (p.MainModule.FileName.StartsWith(scannerDir, StringComparison.OrdinalIgnoreCase)) p.Kill();
                }
                catch { }
            }
            bool removeData = !quiet && MessageBox.Show(
                "Also delete the scores and settings saved on this computer?\n\nChoose No to keep them for a later reinstall. Scores in an online library are not affected.",
                "Uninstall Pianissimo", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;

            Common.RemoveShortcuts();
            Common.UnregisterFileTypes();
            Registry.CurrentUser.DeleteSubKeyTree(Common.UninstallKey, false);

            // delete the program folder once this process has exited, but only if it is the installed copy
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string cmd = "ping -n 3 127.0.0.1 >nul";
            if (Common.SamePath(dir, Common.InstallDir)) cmd += " & rmdir /s /q \"" + dir + "\"";
            if (removeData) cmd += " & rmdir /s /q \"" + Common.DataDir + "\"";
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c " + cmd);
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(psi);
            if (!quiet) MessageBox.Show("Pianissimo was removed from this computer.", "Uninstall Pianissimo", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
    }
}
