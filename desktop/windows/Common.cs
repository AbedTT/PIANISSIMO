// Shared by the Windows launcher (Pianissimo.exe) and the installer (Pianissimo-Setup.exe).
// Built with the C# 5 compiler that ships with the .NET Framework 4.x in every Windows 10/11,
// so no SDK is needed: see scripts/package.mjs. Keep to C# 5 syntax (no $"", ?. or => members).
using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Pianissimo
{
    static class Common
    {
        public const string AppName = "Pianissimo";
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Pianissimo";
        public const string ProgId = "Pianissimo.Score";
        /// <summary>Score files Pianissimo offers to open. Only .pianissimo is claimed as ours; the
        /// others get an "Open with" entry and keep whatever program the user already uses.</summary>
        public static readonly string[] OpenWithExtensions = { ".musicxml", ".mxl", ".mid", ".midi" };

        static string LocalAppData { get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); } }
        /// <summary>Per-user program folder: installing needs no administrator rights.</summary>
        public static string InstallDir { get { return Path.Combine(Path.Combine(LocalAppData, "Programs"), AppName); } }
        /// <summary>Settings and the app window's browser profile (which holds the scores saved on this computer).</summary>
        public static string DataDir { get { return Path.Combine(LocalAppData, AppName); } }
        public static string ProfileDir { get { return Path.Combine(DataDir, "Profile"); } }
        public static string SettingsFile { get { return Path.Combine(DataDir, "settings.ini"); } }
        public static string StartMenuShortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk"); } }
        public static string DesktopShortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"); } }

        public static bool SamePath(string a, string b)
        {
            return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>The optional online server ("server=https://…" in settings.ini, or PIANISSIMO_SERVER).</summary>
        public static string ReadServer()
        {
            string value = Environment.GetEnvironmentVariable("PIANISSIMO_SERVER");
            if (string.IsNullOrEmpty(value)) value = ReadSetting("server");
            return ValidServer(value) ? value.TrimEnd('/') : null;
        }

        /// <summary>A "name=value" line of settings.ini (the last one wins), or null.</summary>
        public static string ReadSetting(string name)
        {
            string value = null;
            try
            {
                if (!File.Exists(SettingsFile)) return null;
                foreach (string line in File.ReadAllLines(SettingsFile))
                {
                    string t = line.Trim();
                    if (t.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase)) value = t.Substring(name.Length + 1).Trim();
                }
            }
            catch (Exception) { }
            return value;
        }

        public static bool ValidServer(string value)
        {
            Uri uri;
            return !string.IsNullOrEmpty(value) && Uri.TryCreate(value.Trim(), UriKind.Absolute, out uri) && (uri.Scheme == "http" || uri.Scheme == "https");
        }

        public static void WriteServer(string value)
        {
            Directory.CreateDirectory(DataDir);
            // other settings (such as audiveris=) stay as they are
            StringBuilder others = new StringBuilder();
            if (File.Exists(SettingsFile))
            {
                foreach (string line in File.ReadAllLines(SettingsFile))
                {
                    string t = line.Trim();
                    if (t.Length == 0 || t.StartsWith(";") || t.StartsWith("server=", StringComparison.OrdinalIgnoreCase)) continue;
                    others.Append(t).Append("\r\n");
                }
            }
            File.WriteAllText(SettingsFile,
                "; Pianissimo desktop settings\r\n" +
                "; server = the address of a Pianissimo website (with its PHP API) to sign in, share and sync with.\r\n" +
                "; Leave it empty to keep everything on this computer.\r\n" +
                "; audiveris = where Audiveris.exe is, if it is not in its usual folder (for scanning sheet music).\r\n" +
                "server=" + (ValidServer(value) ? value.Trim().TrimEnd('/') : "") + "\r\n" + others);
        }

        /// <summary>True while a browser window is using Pianissimo's profile. Chromium keeps
        /// "lockfile" open (no write sharing) for as long as it runs and deletes it on exit.</summary>
        public static bool ProfileInUse()
        {
            string lockFile = Path.Combine(ProfileDir, "lockfile");
            if (!File.Exists(lockFile)) return false;
            try
            {
                using (new FileStream(lockFile, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete)) { }
                return false;
            }
            catch (IOException)
            {
                return true;
            }
            catch (UnauthorizedAccessException)
            {
                return true;
            }
        }

        // ------------------------------------------------------------------ shortcuts
        public static void CreateShortcut(string lnkPath, string target, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            try
            {
                object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                Type t = lnk.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
                t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { Path.GetDirectoryName(target) });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { description });
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { target + ",0" });
                t.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
                Marshal.FinalReleaseComObject(lnk);
            }
            finally
            {
                Marshal.FinalReleaseComObject(shell);
            }
        }

        public static void RemoveShortcuts()
        {
            foreach (string lnk in new[] { StartMenuShortcut, DesktopShortcut })
            {
                try { if (File.Exists(lnk)) File.Delete(lnk); } catch { }
            }
        }

        // ------------------------------------------------------------------ file types (current user only)
        [DllImport("shell32.dll")]
        static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
        const int SHCNE_ASSOCCHANGED = 0x08000000;

        public static void RegisterFileTypes(string exe)
        {
            using (RegistryKey prog = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ProgId))
            {
                prog.SetValue("", "Pianissimo score");
                using (RegistryKey icon = prog.CreateSubKey("DefaultIcon")) icon.SetValue("", "\"" + exe + "\",0");
                using (RegistryKey cmd = prog.CreateSubKey(@"shell\open\command")) cmd.SetValue("", "\"" + exe + "\" \"%1\"");
            }
            using (RegistryKey ext = Registry.CurrentUser.CreateSubKey(@"Software\Classes\.pianissimo"))
            {
                ext.SetValue("", ProgId);
                using (RegistryKey with = ext.CreateSubKey("OpenWithProgids")) with.SetValue(ProgId, new byte[0], RegistryValueKind.None);
            }
            foreach (string e in OpenWithExtensions)
            {
                using (RegistryKey with = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + e + @"\OpenWithProgids"))
                    with.SetValue(ProgId, new byte[0], RegistryValueKind.None);
            }
            // "Open with" also lists the app by its executable name
            using (RegistryKey app = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\Pianissimo.exe"))
            {
                app.SetValue("FriendlyAppName", AppName);
                using (RegistryKey cmd = app.CreateSubKey(@"shell\open\command")) cmd.SetValue("", "\"" + exe + "\" \"%1\"");
                using (RegistryKey types = app.CreateSubKey("SupportedTypes"))
                {
                    types.SetValue(".pianissimo", "");
                    foreach (string e in OpenWithExtensions) types.SetValue(e, "");
                }
            }
            SHChangeNotify(SHCNE_ASSOCCHANGED, 0, IntPtr.Zero, IntPtr.Zero);
        }

        public static void UnregisterFileTypes()
        {
            RegistryKey classes = Registry.CurrentUser.OpenSubKey(@"Software\Classes", true);
            if (classes == null) return;
            using (classes)
            {
                classes.DeleteSubKeyTree(ProgId, false);
                classes.DeleteSubKeyTree(@"Applications\Pianissimo.exe", false);
                using (RegistryKey ext = classes.OpenSubKey(".pianissimo", true))
                {
                    if (ext != null && ProgId.Equals(ext.GetValue("") as string)) ext.DeleteValue("", false);
                }
                classes.DeleteSubKeyTree(".pianissimo", false);
                foreach (string e in OpenWithExtensions)
                {
                    using (RegistryKey with = classes.OpenSubKey(e + @"\OpenWithProgids", true))
                    {
                        if (with != null) with.DeleteValue(ProgId, false);
                    }
                }
            }
            SHChangeNotify(SHCNE_ASSOCCHANGED, 0, IntPtr.Zero, IntPtr.Zero);
        }
    }
}
