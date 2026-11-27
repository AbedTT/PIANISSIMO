// Scanning sheet music on this computer, without a server: Audiveris (free, open source,
// https://audiveris.github.io) reads a photo or PDF of printed music and writes MusicXML, which
// the app opens as an editable score. Started from the app's "Scan a page…": POST /__desktop/scan
// with the file as the body.
//
// Audiveris is found (in this order) in Pianissimo's own "scanner" folder (see ScannerSetup.cs: setup
// puts it there), through PIANISSIMO_AUDIVERIS (the path of Audiveris.exe), an "audiveris=" line in
// settings.ini, or the usual folders of a separately installed Audiveris. It brings its own Java.
//
// The file is checked by its content (PDF, PNG, JPEG or TIFF), copied to a private temporary
// folder, read by Audiveris with a time limit, and the folder is deleted afterwards whatever
// happens. Back go the MusicXML and Audiveris's picture of each page (for checking the result).
// Keep to C# 5 syntax (see Common.cs).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;

namespace Pianissimo
{
    static class Scanner
    {
        const int MaxBytes = 30 * 1024 * 1024;
        /// <summary>
        /// Audiveris settings. minStaffLength: by default a short line of music (a last line holding one
        /// or two bars) is not taken for a staff, so its bars were lost; 10 staff spaces still keeps out
        /// stray lines.
        /// </summary>
        public const string Tuning = "-constant org.audiveris.omr.sheet.grid.LinesRetriever.minStaffLength=10";
        const int TimeLimitMs = 5 * 60 * 1000;
        static readonly object busy = new object();

        /// <summary>Audiveris.exe, or null when it is not installed.</summary>
        public static string Find()
        {
            List<string> candidates = new List<string>();
            // the scanner Pianissimo set up in its own folder (setup, or "Set up the scanner" in the app)
            string own = ScannerSetup.FindIn(AppDomain.CurrentDomain.BaseDirectory);
            if (own == null) own = ScannerSetup.FindIn(Common.InstallDir);
            if (own != null) candidates.Add(own);
            string env = Environment.GetEnvironmentVariable("PIANISSIMO_AUDIVERIS");
            if (!string.IsNullOrEmpty(env)) candidates.Add(env);
            string setting = Common.ReadSetting("audiveris");
            if (!string.IsNullOrEmpty(setting)) candidates.Add(setting);
            foreach (Environment.SpecialFolder folder in new[] {
                Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.LocalApplicationData })
            {
                string root = Environment.GetFolderPath(folder);
                if (string.IsNullOrEmpty(root)) continue;
                candidates.Add(Path.Combine(root, "Audiveris", "Audiveris.exe"));
                candidates.Add(Path.Combine(root, "Programs", "Audiveris", "Audiveris.exe"));
            }
            foreach (string c in candidates)
            {
                try
                {
                    // a folder works too: the one Audiveris.exe is in
                    string exe = Directory.Exists(c) ? Path.Combine(c, "Audiveris.exe") : c;
                    if (File.Exists(exe) && exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return exe;
                }
                catch (Exception) { }
            }
            return null;
        }

        /// <summary>The text-reading data Pianissimo set up next to its scanner (titles, lyrics), or null.</summary>
        public static string OcrFolder()
        {
            string dir = ScannerSetup.OcrFolder(AppDomain.CurrentDomain.BaseDirectory);
            return dir ?? ScannerSetup.OcrFolder(Common.InstallDir);
        }

        /// <summary>"pdf", "png", "jpg", "tif", or null for anything else.</summary>
        public static string KindOf(byte[] data)
        {
            if (data.Length < 8) return null;
            if (data[0] == 0x25 && data[1] == 0x50 && data[2] == 0x44 && data[3] == 0x46) return "pdf";                      // %PDF
            if (data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) return "png";
            if (data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) return "jpg";
            if ((data[0] == 0x49 && data[1] == 0x49 && data[2] == 0x2A && data[3] == 0) ||
                (data[0] == 0x4D && data[1] == 0x4D && data[2] == 0 && data[3] == 0x2A)) return "tif";
            return null;
        }

        /// <summary>A safe file name from what the app sends ("Moonlight sonata.pdf" → "Moonlight sonata").</summary>
        public static string BaseName(string name)
        {
            string s = Path.GetFileNameWithoutExtension(name ?? "") ?? "";
            s = Regex.Replace(s, @"[^\p{L}\p{N} _().,'-]+", " ").Trim();
            if (s.Length > 60) s = s.Substring(0, 60).Trim();
            return s.Length == 0 || s.StartsWith(".") ? "Scanned page" : s;
        }

        public class Result
        {
            public string Format;      // "mxl" or "musicxml"
            public byte[] Music;
            public List<byte[]> Pages = new List<byte[]>();
            /// <summary>Audiveris's description of each page (sheet#N.xml): where every bar is on the picture.</summary>
            public List<byte[]> Sheets = new List<byte[]>();
        }

        public static Result Scan(byte[] data, string fileName)
        {
            string exe = Find();
            if (exe == null) throw new ScanError(501, "Audiveris is not installed on this computer.");
            if (data.Length > MaxBytes) throw new ScanError(413, "That file is too large to scan (30 MB at most).");
            string kind = KindOf(data);
            if (kind == null) throw new ScanError(415, "Scan a PDF, PNG, JPEG or TIFF file.");

            // one at a time: Audiveris uses a lot of memory
            lock (busy)
            {
                string dir = Path.Combine(Path.GetTempPath(), "pianissimo-scan-" + Guid.NewGuid().ToString("N"));
                string outDir = Path.Combine(dir, "out");
                Directory.CreateDirectory(outDir);
                try
                {
                    string input = Path.Combine(dir, BaseName(fileName) + "." + kind);
                    File.WriteAllBytes(input, data);
                    Run(exe, "-batch " + Tuning + " -export -output " + Quote(outDir) + " " + Quote(input));
                    Result result = new Result();
                    string music = FindFile(outDir, new[] { ".mxl", ".musicxml", ".xml" });
                    if (music == null) throw new ScanError(422, "No music could be recognised on that page. Try a straighter, sharper scan or photo.");
                    result.Format = music.EndsWith(".mxl", StringComparison.OrdinalIgnoreCase) ? "mxl" : "musicxml";
                    result.Music = File.ReadAllBytes(music);
                    string book = FindFile(outDir, new[] { ".omr" });
                    if (book != null)
                    {
                        result.Pages = FromBook(book, @"^sheet#(\d+)/BINARY\.png$");
                        result.Sheets = FromBook(book, @"^sheet#(\d+)/sheet#\d+\.xml$");
                        if (result.Sheets.Count != result.Pages.Count) result.Sheets.Clear();
                    }
                    return result;
                }
                finally
                {
                    try { Directory.Delete(dir, true); } catch (Exception) { }
                }
            }
        }

        static void Run(string exe, string args)
        {
            ProcessStartInfo info = new ProcessStartInfo(exe, args);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.WorkingDirectory = Path.GetDirectoryName(exe);
            // text reading (titles, lyrics) with the data Pianissimo set up
            string ocr = OcrFolder();
            if (ocr != null) info.EnvironmentVariables["TESSDATA_PREFIX"] = ocr;
            using (Process p = Process.Start(info))
            {
                // keep reading, or Audiveris stops when its output buffer is full
                p.OutputDataReceived += delegate { };
                p.ErrorDataReceived += delegate { };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(TimeLimitMs))
                {
                    try { p.Kill(); } catch (Exception) { }
                    throw new ScanError(504, "Reading the music took too long. Try one page at a time.");
                }
            }
        }

        /// <summary>One file per page from Audiveris's project file (a zip), in page order: its
        /// black-and-white picture (sheet#1/BINARY.png, …) or its description (sheet#1/sheet#1.xml, …).</summary>
        static List<byte[]> FromBook(string omr, string pattern)
        {
            SortedDictionary<int, byte[]> pages = new SortedDictionary<int, byte[]>();
            try
            {
                using (ZipArchive zip = ZipFile.OpenRead(omr))
                {
                    foreach (ZipArchiveEntry e in zip.Entries)
                    {
                        Match m = Regex.Match(e.FullName, pattern);
                        if (!m.Success || e.Length > 20 * 1024 * 1024) continue;
                        using (Stream s = e.Open())
                        using (MemoryStream copy = new MemoryStream())
                        {
                            s.CopyTo(copy);
                            pages[int.Parse(m.Groups[1].Value)] = copy.ToArray();
                        }
                    }
                }
            }
            catch (Exception) { }
            return new List<byte[]>(pages.Values);
        }

        static string FindFile(string dir, string[] extensions)
        {
            foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
            {
                foreach (string ext in extensions)
                {
                    if (f.EndsWith(ext, StringComparison.OrdinalIgnoreCase)) return f;
                }
            }
            return null;
        }

        static string Quote(string s)
        {
            return "\"" + s.Replace("\"", "") + "\"";
        }
    }

    class ScanError : Exception
    {
        public readonly int Status;
        public ScanError(int status, string message) : base(message) { Status = status; }
    }
}
