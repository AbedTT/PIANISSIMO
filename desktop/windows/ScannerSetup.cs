// The music scanner, set up for you: Pianissimo's setup (and, for copies installed without it, the
// app's "Set up the scanner" button) downloads Audiveris, the free program that reads printed
// music, and unpacks it into Pianissimo's own folder:
//
//   %LOCALAPPDATA%\Programs\Pianissimo\scanner\Audiveris\Audiveris.exe   (with its own Java)
//   %LOCALAPPDATA%\Programs\Pianissimo\scanner\tessdata\eng.traineddata  (text reading: titles, lyrics)
//
// Nothing is installed system-wide and no administrator rights are needed: the official Windows
// installer of Audiveris is unpacked with `msiexec /a` (an "administrative image") instead of being
// run. The text-reading data is Tesseract's English model (tesseract-ocr/tessdata 4.1.0, Apache-2.0),
// which Audiveris uses to read titles, lyrics and other words. Both downloads are pinned (BuildInfo,
// from package.json) and must match their size and SHA-256. Updates of Pianissimo keep the scanner
// folder; uninstalling removes it. Install() only fetches what is missing, so a scanner set up by
// Pianissimo 0.5.1 (without text reading) gets just the 22 MB of text data.
//
// Audiveris is free software under the GNU Affero General Public License v3; its source code is at
// https://github.com/Audiveris/audiveris. It runs as a separate program, unchanged.
// Keep to C# 5 syntax (see Common.cs).
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Threading;

namespace Pianissimo
{
    static class ScannerSetup
    {
        /// <summary>This build knows which Audiveris to fetch.</summary>
        public static bool Possible
        {
            get { return BuildInfo.AudiverisUrl.StartsWith("https://") && BuildInfo.AudiverisSha256.Length == 64; }
        }

        /// <summary>Where the scanner lives for a copy of Pianissimo in this folder.</summary>
        public static string Folder(string programDir)
        {
            return Path.Combine(programDir, "scanner");
        }

        /// <summary>Audiveris.exe in that folder, or null.</summary>
        public static string FindIn(string programDir)
        {
            string dir = Folder(programDir);
            if (!Directory.Exists(dir)) return null;
            string direct = Path.Combine(dir, "Audiveris", "Audiveris.exe");
            if (File.Exists(direct)) return direct;
            try
            {
                foreach (string f in Directory.GetFiles(dir, "Audiveris.exe", SearchOption.AllDirectories)) return f;
            }
            catch (Exception) { }
            return null;
        }

        static bool OcrPossible
        {
            get { return BuildInfo.OcrUrl.StartsWith("https://") && BuildInfo.OcrSha256.Length == 64; }
        }

        /// <summary>The text-reading data for a copy of Pianissimo in this folder, or null.</summary>
        public static string OcrFolder(string programDir)
        {
            string dir = Path.Combine(Folder(programDir), "tessdata");
            return File.Exists(Path.Combine(dir, "eng.traineddata")) ? dir : null;
        }

        /// <summary>Megabytes still to download for this folder (the scanner and/or its text data).</summary>
        public static int DownloadMegabytes(string programDir)
        {
            long bytes = 0;
            if (FindIn(programDir) == null) bytes += BuildInfo.AudiverisBytes;
            if (OcrPossible && OcrFolder(programDir) == null) bytes += BuildInfo.OcrBytes;
            return (int)Math.Round(bytes / 1048576.0);
        }

        /// <summary>Megabytes of a complete scanner (for setup's text).</summary>
        public static int FullMegabytes
        {
            get { return (int)Math.Round((BuildInfo.AudiverisBytes + (OcrPossible ? BuildInfo.OcrBytes : 0)) / 1048576.0); }
        }

        /// <summary>
        /// Download, check and unpack what is missing in programDir\scanner: Audiveris and/or its
        /// text-reading data. progress(percent, what) is called along the way (the downloads up to 90).
        /// </summary>
        public static void Install(string programDir, Action<int, string> progress)
        {
            if (!Possible) throw new Exception("This copy of Pianissimo does not know where to get the scanner.");
            bool needScanner = FindIn(programDir) == null;
            bool needOcr = OcrPossible && OcrFolder(programDir) == null;
            long total = (needScanner ? BuildInfo.AudiverisBytes : 0) + (needOcr ? BuildInfo.OcrBytes : 0);
            string temp = Path.Combine(Path.GetTempPath(), "pianissimo-scanner-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            try
            {
                long done = 0;
                if (needScanner)
                {
                    InstallScanner(programDir, temp, progress, done, total);
                    done += BuildInfo.AudiverisBytes;
                }
                if (needOcr)
                {
                    string file = Path.Combine(temp, "eng.traineddata");
                    Download(BuildInfo.OcrUrl, BuildInfo.OcrSha256, BuildInfo.OcrBytes, file, progress, done, total);
                    string dir = Path.Combine(Folder(programDir), "tessdata");
                    Directory.CreateDirectory(dir);
                    string target = Path.Combine(dir, "eng.traineddata");
                    if (File.Exists(target)) File.Delete(target);
                    File.Move(file, target);
                }
                Report(progress, 100, "The music scanner is ready.");
            }
            finally
            {
                try { Directory.Delete(temp, true); } catch (Exception) { }
            }
        }

        static void InstallScanner(string programDir, string temp, Action<int, string> progress, long done, long total)
        {
            string msi = Path.Combine(temp, "Audiveris.msi");
            string target = Folder(programDir);
            string fresh = target + ".new";
            try
            {
                Download(BuildInfo.AudiverisUrl, BuildInfo.AudiverisSha256, BuildInfo.AudiverisBytes, msi, progress, done, total);
                Report(progress, (int)((done + BuildInfo.AudiverisBytes) * 90 / Math.Max(1, total)), "Unpacking the music scanner…");
                if (Directory.Exists(fresh)) Directory.Delete(fresh, true);
                Directory.CreateDirectory(fresh);
                ProcessStartInfo info = new ProcessStartInfo("msiexec.exe", "/a \"" + msi + "\" /qn TARGETDIR=\"" + fresh + "\"");
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                using (Process p = Process.Start(info))
                {
                    if (!p.WaitForExit(10 * 60 * 1000))
                    {
                        try { p.Kill(); } catch (Exception) { }
                        throw new Exception("Unpacking the scanner took too long.");
                    }
                    if (p.ExitCode != 0 && p.ExitCode != 3010) throw new Exception("Unpacking the scanner failed (Windows Installer error " + p.ExitCode + ").");
                }
                // the image keeps a copy of the installer at its top: not needed
                foreach (string f in Directory.GetFiles(fresh, "*.msi")) File.Delete(f);
                if (Directory.GetFiles(fresh, "Audiveris.exe", SearchOption.AllDirectories).Length == 0)
                    throw new Exception("The scanner was unpacked, but Audiveris.exe is missing.");
                File.WriteAllText(Path.Combine(fresh, "VERSION"), BuildInfo.AudiverisVersion);
                // text-reading data already there (a re-install of the scanner) stays
                string keep = Path.Combine(target, "tessdata");
                if (Directory.Exists(keep)) Directory.Move(keep, Path.Combine(fresh, "tessdata"));
                if (Directory.Exists(target)) Directory.Delete(target, true);
                Directory.Move(fresh, target);
            }
            finally
            {
                try { if (Directory.Exists(fresh)) Directory.Delete(fresh, true); } catch (Exception) { }
            }
        }

        /// <summary>Download url into file, checking its size and SHA-256; progress counts from done of total bytes.</summary>
        static void Download(string url, string sha256, long expected, string file, Action<int, string> progress, long done, long total)
        {
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = "Pianissimo/" + BuildInfo.Version;
            req.Timeout = 30000;
            req.ReadWriteTimeout = 60000;
            long mb = Math.Max(1, total / 1048576);
            using (WebResponse res = req.GetResponse())
            using (Stream input = res.GetResponseStream())
            using (FileStream output = File.Create(file))
            using (SHA256 sha = SHA256.Create())
            {
                byte[] buf = new byte[81920];
                long have = 0;
                int last = -1;
                int n;
                while ((n = input.Read(buf, 0, buf.Length)) > 0)
                {
                    output.Write(buf, 0, n);
                    sha.TransformBlock(buf, 0, n, null, 0);
                    have += n;
                    if (expected > 0 && have > expected) throw new Exception("The scanner download is larger than expected.");
                    int percent = total > 0 ? (int)((done + have) * 90 / total) : 0;
                    if (percent != last)
                    {
                        last = percent;
                        Report(progress, percent, "Downloading the music scanner… " + ((done + have) / 1048576) + " of " + mb + " MB");
                    }
                }
                sha.TransformFinalBlock(new byte[0], 0, 0);
                if (expected > 0 && have != expected) throw new Exception("The scanner download was cut short. Check your internet connection and try again.");
                string hex = BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant();
                if (hex != sha256.ToLowerInvariant()) throw new Exception("The scanner download did not match its checksum, so it was not used.");
            }
        }

        static void Report(Action<int, string> progress, int percent, string what)
        {
            if (progress != null) progress(Math.Max(0, Math.Min(100, percent)), what);
        }

        // ------------------------------------------------------------------ for the app's "Set up the scanner" button
        static readonly object gate = new object();
        static string state = "idle"; // idle, working, done, error
        static int percent;
        static string message = "";

        /// <summary>Start setting up the scanner in the background (does nothing if it is already running).</summary>
        public static void Start(string programDir)
        {
            lock (gate)
            {
                if (state == "working") return;
                state = "working";
                percent = 0;
                message = "Starting…";
            }
            Thread worker = new Thread(delegate ()
            {
                try
                {
                    Install(programDir, delegate (int p, string what) { lock (gate) { percent = p; message = what; } });
                    lock (gate) { state = "done"; percent = 100; message = "The music scanner is ready."; }
                }
                catch (Exception ex)
                {
                    lock (gate) { state = "error"; message = ex is WebException ? "The scanner could not be downloaded. Check your internet connection and try again." : ex.Message; }
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        /// <summary>{state, percent, message} for the app.</summary>
        public static void Status(out string s, out int p, out string m)
        {
            lock (gate)
            {
                s = state;
                p = percent;
                m = message;
            }
        }
    }
}
