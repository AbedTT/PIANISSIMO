// Updates for the installed Windows app (Pianissimo.exe): find the newest release, download its
// setup, check it, and run it with /update (the setup closes Pianissimo, installs over it and
// opens it again). Started from the app's "Update now" button: POST /__desktop/update.
//
// Where releases are announced is BuildInfo.UpdateFeed (from package.json, "pianissimo.updateFeed"):
//   github:owner/repo      the latest release of that GitHub repository
//   https://…/latest.json  a file written by `npm run package`, kept on your own website
// PIANISSIMO_UPDATE_FEED overrides it (for testing); PIANISSIMO_UPDATE_DRY_RUN=1 downloads and
// checks the setup but does not run it.
//
// The setup is only accepted when it comes over HTTPS from that feed's own releases, is a Windows
// program, matches the published SHA-256 when there is one, and, if this copy is code-signed,
// carries a valid signature from the same publisher.
// Keep to C# 5 syntax (see Common.cs).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace Pianissimo
{
    static class Updater
    {
        /// <summary>This is the installed copy (the portable zip cannot update itself: it offers the download).</summary>
        public static bool CanInstall
        {
            get { return Common.SamePath(AppDomain.CurrentDomain.BaseDirectory, Common.InstallDir); }
        }

        public static bool DryRun
        {
            get { return Environment.GetEnvironmentVariable("PIANISSIMO_UPDATE_DRY_RUN") == "1"; }
        }

        static string Feed
        {
            get
            {
                string env = Environment.GetEnvironmentVariable("PIANISSIMO_UPDATE_FEED");
                return string.IsNullOrEmpty(env) ? BuildInfo.UpdateFeed : env;
            }
        }

        /// <summary>Download and check the newest setup; returns its path. Throws with a message for people.</summary>
        public static string Prepare()
        {
            string version, url, sha256;
            Latest(out version, out url, out sha256);
            if (!Newer(version, BuildInfo.Version)) throw new Exception("You already have the newest version (" + BuildInfo.Version + ").");
            string dir = Path.Combine(Path.GetTempPath(), "Pianissimo-update");
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, "Pianissimo-Setup-" + Regex.Replace(version, "[^0-9A-Za-z.-]", "") + ".exe");
            try
            {
                using (WebClient wc = Client()) wc.DownloadFile(url, file);
            }
            catch (WebException ex)
            {
                throw new Exception("The new version could not be downloaded (" + ex.Message + ").");
            }
            Verify(file, sha256);
            return file;
        }

        /// <summary>Run the checked setup a moment later (after the app has had its answer).</summary>
        public static void Run(string setup)
        {
            Thread t = new Thread(delegate ()
            {
                Thread.Sleep(400);
                Process.Start(new ProcessStartInfo(setup, "/update") { UseShellExecute = false });
            });
            t.IsBackground = false;
            t.Start();
        }

        // ------------------------------------------------------------------ the feed
        static void Latest(out string version, out string url, out string sha256)
        {
            string feed = Feed ?? "";
            sha256 = null;
            JavaScriptSerializer json = new JavaScriptSerializer();
            json.MaxJsonLength = 8 * 1024 * 1024;
            Match gh = Regex.Match(feed, @"^github:([\w.-]+/[\w.-]+)$");
            if (gh.Success)
            {
                string repo = gh.Groups[1].Value;
                Dictionary<string, object> release = json.Deserialize<Dictionary<string, object>>(Get("https://api.github.com/repos/" + repo + "/releases/latest"));
                version = ((string)release["tag_name"]).TrimStart('v', 'V');
                string prefix = "https://github.com/" + repo + "/releases/download/";
                url = null;
                foreach (object o in (ArrayList)release["assets"])
                {
                    Dictionary<string, object> asset = (Dictionary<string, object>)o;
                    string name = (string)asset["name"];
                    string link = (string)asset["browser_download_url"];
                    if (!Regex.IsMatch(name, @"^Pianissimo-Setup-[0-9.]+\.exe$") || !link.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                    url = link;
                    object digest;
                    // GitHub publishes "sha256:<hex>" for each uploaded file
                    if (asset.TryGetValue("digest", out digest) && digest is string && ((string)digest).StartsWith("sha256:")) sha256 = ((string)digest).Substring(7);
                }
                if (url == null) throw new Exception("The newest release (" + version + ") has no Windows setup yet.");
                return;
            }
            Uri feedUri;
            if (!Uri.TryCreate(feed, UriKind.Absolute, out feedUri) || !(feedUri.Scheme == "https" || IsLoopback(feedUri)))
            {
                throw new Exception("This copy of Pianissimo has no update feed.");
            }
            Dictionary<string, object> latest = json.Deserialize<Dictionary<string, object>>(Get(feed));
            version = Convert.ToString(latest["version"]).TrimStart('v', 'V');
            object windows;
            if (!latest.TryGetValue("windows", out windows) || !(windows is string)) throw new Exception("The newest release (" + version + ") has no Windows setup yet.");
            Uri setup = new Uri(feedUri, (string)windows);
            // the setup must come from the same site as the feed
            if (setup.Scheme != feedUri.Scheme || !string.Equals(setup.Host, feedUri.Host, StringComparison.OrdinalIgnoreCase)) throw new Exception("The update feed points somewhere else; it was not used.");
            url = setup.AbsoluteUri;
            object sums;
            if (latest.TryGetValue("sha256", out sums) && sums is Dictionary<string, object>)
            {
                object sum;
                if (((Dictionary<string, object>)sums).TryGetValue("windows", out sum) && sum is string) sha256 = (string)sum;
            }
        }

        static bool IsLoopback(Uri u)
        {
            return u.Scheme == "http" && (u.Host == "127.0.0.1" || u.Host == "localhost");
        }

        static WebClient Client()
        {
            WebClient wc = new WebClient();
            wc.Headers[HttpRequestHeader.UserAgent] = "Pianissimo-Updater/" + BuildInfo.Version; // GitHub requires one
            wc.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json, application/json, */*";
            return wc;
        }

        static string Get(string url)
        {
            try
            {
                using (WebClient wc = Client())
                {
                    wc.Encoding = Encoding.UTF8;
                    return wc.DownloadString(url);
                }
            }
            catch (WebException ex)
            {
                HttpWebResponse r = ex.Response as HttpWebResponse;
                if (r != null && r.StatusCode == HttpStatusCode.NotFound) throw new Exception("No release has been published yet.");
                throw new Exception("The list of releases could not be read (" + ex.Message + ").");
            }
        }

        /// <summary>"0.10.1" is newer than "0.9.3".</summary>
        public static bool Newer(string candidate, string current)
        {
            string[] a = candidate.Split('-')[0].Split('.'), b = current.Split('-')[0].Split('.');
            for (int i = 0; i < Math.Max(a.Length, b.Length); i++)
            {
                int x = 0, y = 0;
                if (i < a.Length) int.TryParse(a[i], out x);
                if (i < b.Length) int.TryParse(b[i], out y);
                if (x != y) return x > y;
            }
            return false;
        }

        // ------------------------------------------------------------------ checking the download
        static void Verify(string file, string sha256)
        {
            byte[] head = new byte[2];
            long size;
            using (FileStream f = File.OpenRead(file))
            {
                size = f.Length;
                f.Read(head, 0, 2);
            }
            if (size < 100 * 1024 || size > 300L * 1024 * 1024 || head[0] != 'M' || head[1] != 'Z') Reject(file, "The download is not a Windows setup.");
            if (!string.IsNullOrEmpty(sha256))
            {
                string actual;
                using (SHA256 h = SHA256.Create())
                using (FileStream f = File.OpenRead(file)) actual = BitConverter.ToString(h.ComputeHash(f)).Replace("-", "");
                if (!string.Equals(actual, sha256.Trim(), StringComparison.OrdinalIgnoreCase)) Reject(file, "The download is damaged (its checksum does not match).");
            }
            // a signed copy accepts only a setup signed by the same publisher
            string mine = Signer(System.Reflection.Assembly.GetExecutingAssembly().Location);
            if (mine != null)
            {
                if (VerifySignature(file) != 0 || Signer(file) != mine) Reject(file, "The download is not signed by the publisher of Pianissimo, so it was not installed.");
            }
        }

        static void Reject(string file, string why)
        {
            try { File.Delete(file); } catch { }
            throw new Exception(why);
        }

        /// <summary>The subject of a file's Authenticode certificate, or null when unsigned.</summary>
        public static string Signer(string file)
        {
            try { return X509Certificate.CreateFromSignedFile(file).Subject; }
            catch (Exception) { return null; }
        }

        // WinVerifyTrust: checks the signature itself (the file was not changed) and the certificate chain.
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        class WinTrustFileInfo
        {
            public uint cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustFileInfo));
            [MarshalAs(UnmanagedType.LPWStr)] public string pcwszFilePath;
            public IntPtr hFile = IntPtr.Zero;
            public IntPtr pgKnownSubject = IntPtr.Zero;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        class TrustData : IDisposable
        {
            public uint cbStruct = (uint)Marshal.SizeOf(typeof(TrustData));
            public IntPtr pPolicyCallbackData = IntPtr.Zero;
            public IntPtr pSIPClientData = IntPtr.Zero;
            public uint dwUIChoice = 2;            // WTD_UI_NONE
            public uint fdwRevocationChecks = 0;   // WTD_REVOKE_NONE
            public uint dwUnionChoice = 1;         // WTD_CHOICE_FILE
            public IntPtr pFile;
            public uint dwStateAction = 0;
            public IntPtr hWVTStateData = IntPtr.Zero;
            public IntPtr pwszURLReference = IntPtr.Zero;
            public uint dwProvFlags = 0x00000080;  // WTD_REVOCATION_CHECK_NONE
            public uint dwUIContext = 0;

            public TrustData(string path)
            {
                WinTrustFileInfo info = new WinTrustFileInfo();
                info.pcwszFilePath = path;
                pFile = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WinTrustFileInfo)));
                Marshal.StructureToPtr(info, pFile, false);
            }

            public void Dispose()
            {
                if (pFile != IntPtr.Zero)
                {
                    Marshal.DestroyStructure(pFile, typeof(WinTrustFileInfo));
                    Marshal.FreeHGlobal(pFile);
                    pFile = IntPtr.Zero;
                }
            }
        }

        [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = false, CharSet = CharSet.Unicode)]
        static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid pgActionID, TrustData pWVTData);

        static readonly Guid GenericVerifyV2 = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

        /// <summary>0 when the file's signature is valid and trusted; an error code otherwise.</summary>
        public static int VerifySignature(string file)
        {
            using (TrustData data = new TrustData(file)) return WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, data);
        }
    }
}
