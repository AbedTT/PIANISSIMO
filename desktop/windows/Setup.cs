// Pianissimo-Setup.exe: installs Pianissimo for the current user (no administrator rights).
//
// The program files (Pianissimo.exe and the app folder) are embedded as payload.zip. Setup copies
// them to %LOCALAPPDATA%\Programs\Pianissimo, adds Start menu (and optionally desktop) shortcuts,
// "Open with" entries for score files and an entry in Settings > Apps for uninstalling. With the
// music scanner ticked (the default) it also downloads and unpacks Audiveris next to it
// (see ScannerSetup.cs), so scanning sheet music works straight away.
//
//   Pianissimo-Setup.exe        the setup window
//   Pianissimo-Setup.exe /S     silent install (for scripted roll-outs); /server=https://… sets the online server;
//                               /noscanner leaves out the music scanner
//   Pianissimo-Setup.exe /update  started by the app's "Update now": waits for Pianissimo to close,
//                                 installs over it (scores, settings and shortcuts stay) and opens it again
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Pianissimo
{
    static class Setup
    {
        [STAThread]
        static int Main(string[] args)
        {
            bool silent = false, update = false, noScanner = false;
            string serverArg = null;
            foreach (string a in args)
            {
                if (a == "/S" || a == "--silent") silent = true;
                else if (a == "/update") update = true;
                else if (a == "/noscanner") noScanner = true;
                else if (a.StartsWith("/server=")) serverArg = a.Substring(8);
            }
            if (update) return Update();
            if (silent)
            {
                try
                {
                    Install(true, serverArg, null);
                    if (!noScanner && ScannerSetup.Possible && ScannerSetup.FindIn(Common.InstallDir) == null)
                    {
                        // Pianissimo works without it: a failed download is not a failed install
                        try { ScannerSetup.Install(Common.InstallDir, null); } catch (Exception) { }
                    }
                    return 0;
                }
                catch (Exception)
                {
                    return 1;
                }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
            return 0;
        }

        /// <summary>The app asked for this update: let its window close, install, open it again.</summary>
        static int Update()
        {
            try
            {
                CloseAppWindows();
                // keep the desktop shortcut as it was; the server setting stays (null = keep)
                Install(File.Exists(Common.DesktopShortcut), null, null);
                Process.Start(Path.Combine(Common.InstallDir, "Pianissimo.exe"));
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "The update of Pianissimo could not be installed:\n\n" + ex.Message +
                    "\n\nYour scores are safe. Please download the new version and run its setup again.",
                    Common.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }

        /// <summary>The app window closes itself after asking for the update, so the browser can store
        /// everything; give it some seconds, then close what is left of Pianissimo's own browser profile.</summary>
        static void CloseAppWindows()
        {
            for (int i = 0; i < 30 && Common.ProfileInUse(); i++) Thread.Sleep(500);
            if (!Common.ProfileInUse()) return;
            string profile = Common.ProfileDir;
            try
            {
                using (ManagementObjectSearcher search = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'msedge.exe' OR Name = 'chrome.exe'"))
                {
                    foreach (ManagementObject p in search.Get())
                    {
                        string cmd = p["CommandLine"] as string;
                        // only the browser windows of Pianissimo's profile, never your own browser
                        if (cmd == null || cmd.IndexOf(profile, StringComparison.OrdinalIgnoreCase) < 0) continue;
                        try { Process.GetProcessById(Convert.ToInt32(p["ProcessId"])).Kill(); } catch { }
                    }
                }
            }
            catch (Exception) { }
            for (int i = 0; i < 10 && Common.ProfileInUse(); i++) Thread.Sleep(500);
        }

        public static void Install(bool desktopShortcut, string server, Action<int> progress)
        {
            string dir = Common.InstallDir;
            string root = dir.TrimEnd('\\') + "\\";
            // close a running copy, or its files are locked
            foreach (Process p in Process.GetProcessesByName("Pianissimo"))
            {
                try { p.Kill(); p.WaitForExit(3000); } catch { }
            }
            // a fresh app folder: old builds leave hashed files behind
            string appDir = Path.Combine(dir, "app");
            if (Directory.Exists(appDir)) Directory.Delete(appDir, true);
            Directory.CreateDirectory(dir);

            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (ZipArchive zip = new ZipArchive(payload, ZipArchiveMode.Read))
            {
                int total = zip.Entries.Count, done = 0;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(dir, e.FullName.Replace('/', '\\')));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                    if (e.FullName.EndsWith("/")) Directory.CreateDirectory(target);
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        e.ExtractToFile(target, true);
                    }
                    done++;
                    if (progress != null) progress(done * 90 / total);
                }
            }

            string exe = Path.Combine(dir, "Pianissimo.exe");
            Common.CreateShortcut(Common.StartMenuShortcut, exe, "Write sheet music as fast as you can type");
            if (desktopShortcut) Common.CreateShortcut(Common.DesktopShortcut, exe, "Write sheet music as fast as you can type");
            else if (File.Exists(Common.DesktopShortcut)) File.Delete(Common.DesktopShortcut);
            Common.RegisterFileTypes(exe);
            if (server != null || !File.Exists(Common.SettingsFile)) Common.WriteServer(server);
            if (progress != null) progress(96);

            long bytes = 0;
            foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) bytes += new FileInfo(f).Length;
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Common.UninstallKey))
            {
                k.SetValue("DisplayName", Common.AppName);
                k.SetValue("DisplayVersion", BuildInfo.Version);
                k.SetValue("Publisher", "Pianissimo");
                k.SetValue("DisplayIcon", "\"" + exe + "\",0");
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", "\"" + exe + "\" --uninstall");
                k.SetValue("QuietUninstallString", "\"" + exe + "\" --uninstall /S");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)(bytes / 1024), RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
            if (progress != null) progress(100);
        }
    }

    class SetupForm : Form
    {
        readonly Label intro = new Label();
        readonly CheckBox desktop = new CheckBox();
        readonly CheckBox launch = new CheckBox();
        readonly CheckBox scanner = new CheckBox();
        readonly Label scannerNote = new Label();
        readonly Label status = new Label();
        readonly Label serverLabel = new Label();
        readonly TextBox serverBox = new TextBox();
        readonly ProgressBar bar = new ProgressBar();
        readonly Button primary = new Button();
        readonly Button cancel = new Button();
        bool finished;

        public SetupForm()
        {
            bool update = Directory.Exists(Common.InstallDir);
            Text = "Pianissimo " + BuildInfo.Version + " Setup";
            Font = new Font("Segoe UI", 9.75f);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Font;
            int extra = update ? 40 : 0; // room for the "update" sentence
            bool hasScanner = ScannerSetup.FindIn(Common.InstallDir) != null;
            bool offerScanner = ScannerSetup.Possible;
            int room = (offerScanner ? 48 : 0) + 24; // room for the music scanner, and for the folder line
            ClientSize = new Size(520, 410 + extra + room);
            BackColor = Color.White;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            PictureBox logo = new PictureBox();
            logo.Bounds = new Rectangle(28, 26, 56, 56);
            logo.SizeMode = PictureBoxSizeMode.Zoom;
            try { logo.Image = new Icon(Icon, 64, 64).ToBitmap(); } catch { }
            Controls.Add(logo);

            Label title = new Label();
            title.Text = update ? "Update Pianissimo" : "Install Pianissimo";
            title.Font = new Font("Segoe UI Semibold", 17f);
            title.Bounds = new Rectangle(98, 24, 400, 36);
            Controls.Add(title);

            Label sub = new Label();
            sub.Text = "Version " + BuildInfo.Version;
            sub.ForeColor = Color.FromArgb(110, 110, 115);
            sub.Bounds = new Rectangle(100, 60, 400, 22);
            Controls.Add(sub);

            intro.Text = (update ? "A newer copy replaces the installed one. Your saved scores are kept.\r\n\r\n" : "") +
                "Pianissimo is installed for your user account only, so no administrator rights are needed.\r\n" +
                "Folder: " + Common.InstallDir;
            intro.Bounds = new Rectangle(28, 100, 470, 114 + extra);
            Controls.Add(intro);

            int y = 220 + extra;
            desktop.Text = "Add a shortcut to the desktop";
            desktop.Checked = !update || File.Exists(Common.DesktopShortcut);
            desktop.Bounds = new Rectangle(28, y, 470, 24);
            Controls.Add(desktop);
            launch.Text = "Open Pianissimo when setup finishes";
            launch.Checked = true;
            launch.Bounds = new Rectangle(28, y + 28, 470, 24);
            Controls.Add(launch);
            if (offerScanner)
            {
                scanner.Text = "Music scanner: turns PDFs and photos of sheet music into scores";
                scanner.Checked = true;
                scanner.Enabled = !hasScanner;
                scanner.Bounds = new Rectangle(28, y + 56, 470, 24);
                Controls.Add(scanner);
                scannerNote.Text = hasScanner ? "Already set up." : "Audiveris, free. Downloads " + ScannerSetup.DownloadMegabytes + " MB once.";
                scannerNote.ForeColor = Color.FromArgb(110, 110, 115);
                scannerNote.Bounds = new Rectangle(46, y + 80, 450, 20);
                Controls.Add(scannerNote);
                y += 48;
            }

            serverLabel.Text = "Online server (optional, for signing in and sharing)";
            serverLabel.ForeColor = Color.FromArgb(110, 110, 115);
            serverLabel.Bounds = new Rectangle(28, y + 64, 470, 20);
            Controls.Add(serverLabel);
            serverBox.Bounds = new Rectangle(30, y + 86, 460, 26);
            serverBox.Text = Common.ReadServer() ?? "";
            SetCue(serverBox, "https://your-pianissimo-site.example");
            Controls.Add(serverBox);

            status.Bounds = new Rectangle(28, 310 + extra + room, 464, 20);
            status.ForeColor = Color.FromArgb(110, 110, 115);
            Controls.Add(status);
            bar.Bounds = new Rectangle(28, 334 + extra + room, 464, 8);
            bar.Visible = false;
            Controls.Add(bar);

            Panel footer = new Panel();
            footer.Bounds = new Rectangle(0, 350 + extra + room, 520, 60);
            footer.BackColor = Color.FromArgb(242, 242, 247);
            Controls.Add(footer);
            primary.Text = update ? "Update" : "Install";
            primary.Bounds = new Rectangle(300, 14, 100, 32);
            primary.FlatStyle = FlatStyle.Flat;
            primary.FlatAppearance.BorderSize = 0;
            primary.BackColor = Color.FromArgb(0, 122, 255);
            primary.ForeColor = Color.White;
            primary.Click += OnPrimary;
            footer.Controls.Add(primary);
            cancel.Text = "Cancel";
            cancel.Bounds = new Rectangle(408, 14, 92, 32);
            cancel.Click += delegate { Close(); };
            footer.Controls.Add(cancel);
            AcceptButton = primary;
            CancelButton = cancel;
        }

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, string lParam);
        static void SetCue(TextBox box, string text)
        {
            box.HandleCreated += delegate { SendMessage(box.Handle, 0x1501, (IntPtr)1, text); };
        }

        void OnPrimary(object sender, EventArgs e)
        {
            if (finished)
            {
                if (launch.Checked)
                {
                    try { Process.Start(Path.Combine(Common.InstallDir, "Pianissimo.exe")); } catch { }
                }
                Close();
                return;
            }
            string server = serverBox.Text.Trim();
            if (server.Length > 0 && !Common.ValidServer(server))
            {
                MessageBox.Show(this, "The online server must be a web address starting with https:// (or http://).", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                serverBox.Focus();
                return;
            }
            primary.Enabled = cancel.Enabled = desktop.Enabled = serverBox.Enabled = scanner.Enabled = false;
            bar.Visible = true;
            bool wantDesktop = desktop.Checked;
            bool wantScanner = scanner.Visible && scanner.Checked && ScannerSetup.FindIn(Common.InstallDir) == null;
            Thread worker = new Thread(delegate ()
            {
                try
                {
                    // Pianissimo itself first (a third of the bar when the scanner follows)
                    int share = wantScanner ? 30 : 100;
                    Setup.Install(wantDesktop, server, delegate (int p) { BeginInvoke((Action)delegate { bar.Value = Math.Min(100, p * share / 100); }); });
                    string scannerError = null;
                    if (wantScanner)
                    {
                        try
                        {
                            ScannerSetup.Install(Common.InstallDir, delegate (int p, string what)
                            {
                                BeginInvoke((Action)delegate { bar.Value = Math.Min(100, 30 + p * 70 / 100); status.Text = what; });
                            });
                        }
                        catch (Exception ex)
                        {
                            scannerError = ex is System.Net.WebException ? "it could not be downloaded (no internet connection?)" : ex.Message;
                        }
                    }
                    BeginInvoke((Action)delegate { Done(wantScanner, scannerError); });
                }
                catch (Exception ex)
                {
                    BeginInvoke((Action)delegate
                    {
                        MessageBox.Show(this, "Setup could not finish:\n\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                        primary.Enabled = cancel.Enabled = desktop.Enabled = serverBox.Enabled = true;
                        scanner.Enabled = ScannerSetup.FindIn(Common.InstallDir) == null;
                        bar.Visible = false;
                    });
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        void Done(bool withScanner, string scannerError)
        {
            finished = true;
            string scannerText = !withScanner ? "" : scannerError == null
                ? "\r\n\r\nThe music scanner is ready: in Pianissimo, use Import > Scan a page."
                : "\r\n\r\nThe music scanner was not set up: " + scannerError + ". Pianissimo works without it, and you can set it up later from Import > Scan a page.";
            intro.Text = "Pianissimo is installed. Find it in the Start menu" + (desktop.Checked ? " and on your desktop" : "") + "." +
                scannerText + "\r\n\r\nTo remove it later, use Settings > Apps > Installed apps.";
            intro.Height = 150;
            desktop.Visible = serverLabel.Visible = serverBox.Visible = scanner.Visible = scannerNote.Visible = status.Visible = false;
            launch.Top = intro.Bottom + 10;
            bar.Value = 100;
            primary.Text = "Finish";
            primary.Enabled = true;
            cancel.Visible = false;
        }
    }
}
