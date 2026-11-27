# Installing Pianissimo on a computer

Pianissimo runs in a web browser, but it can also be installed like any other program: with a Start
menu entry, its own window and taskbar icon, and "Open with" for score files. Once installed it works
without an internet connection, and scores are saved on the computer.

| System | Download | How to install |
| --- | --- | --- |
| Windows 10 / 11 | `Pianissimo-Setup-<version>.exe` | Double-click, then **Install** |
| Windows (no install) | `Pianissimo-<version>-windows-portable.zip` | Unzip, double-click `Pianissimo.exe` |
| macOS 10.13+ | `Pianissimo-<version>-macos-linux.tar.gz` | Unpack, then `sh install.sh` in Terminal |
| Linux | `Pianissimo-<version>-macos-linux.tar.gz` | Unpack, then `sh install.sh` |
| Any (Chrome, Edge, Android, ChromeOS, iPhone, iPad) | the website | Use the browser's **Install app** / **Add to Home Screen** |

## Windows

1. Run `Pianissimo-Setup-<version>.exe`.
2. Choose whether you want a desktop shortcut, then click **Install**.

Setup installs for your user account only (in `%LOCALAPPDATA%\Programs\Pianissimo`), so it does not
ask for administrator rights. Start Pianissimo from the Start menu or the desktop.

- **The window.** Pianissimo opens in its own window, shown by Microsoft Edge (part of Windows) or Google
  Chrome, with a separate profile. Your normal browser, its tabs and its history are not touched.
- **Score files.** `.pianissimo` files open in Pianissimo when double-clicked. MusicXML (`.musicxml`,
  `.mxl`) and MIDI (`.mid`) files get **Open with → Pianissimo**; the program you already use for
  them stays the default.
- **Your scores.** **Save** (Ctrl+S) puts the score in **My scores**, the library on this computer; from
  then on it saves itself as you edit. Open **My scores** to switch between scores, duplicate or delete
  them. No account or server is needed. **Back up all…** there writes every score to one file (keep it on
  a USB stick or in the cloud); **Restore…** or **Open** adds them back, also on another computer.
- **Scanning sheet music.** *Import ▾ → Scan a page* turns a PDF or photo of printed music into a score,
  read on this computer by **Audiveris** (free, open source, AGPL-3.0). Setup installs it with Pianissimo
  (the *Music scanner* box, ticked by default): it downloads the official Audiveris release (about 81 MB,
  checked against its SHA-256) and unpacks it into `%LOCALAPPDATA%\Programs\Pianissimo\scanner`, without
  administrator rights or a separate installer. Updates keep it; uninstalling removes it. Left it out, or
  updated from an older version? *Scan a page* offers **Set up the scanner**: one click does the same. A
  separately installed Audiveris is found too, or set `audiveris=C:\path\to\Audiveris` in `settings.ini`.
  Scripted installs: `/noscanner` leaves it out.
- **Updates.** Each time it starts (and once a day while it stays open) Pianissimo checks whether a new version is out. If so, a bar at the top shows
  what is new, with **Update now**: it saves your work, downloads the new setup, checks it, installs it and
  opens Pianissimo again (your scores and settings stay). **Later** waits for the next version. You can
  also run *Check for updates* from the command search (Ctrl+Shift+P). The portable copy, and the Mac and
  Linux versions, show a **Download** button instead. Running a newer setup by hand works too.
- **Removing.** Go to *Settings → Apps → Installed apps → Pianissimo → Uninstall*. You are asked whether
  to keep the scores saved on the computer.
- **"Windows protected your PC".** Unless the release was signed (see *Signing*), SmartScreen may warn
  the first time. Click **More info → Run anyway**.
- **Scripted installs.** `Pianissimo-Setup-<version>.exe /S` installs silently, and
  `/server=https://…` sets the online server. Uninstall silently with
  `"%LOCALAPPDATA%\Programs\Pianissimo\Pianissimo.exe" --uninstall /S`.

## macOS

1. Unpack `Pianissimo-<version>-macos-linux.tar.gz` (double-click it in Finder).
2. In Terminal, run `sh ~/Downloads/Pianissimo-<version>/install.sh`, adjusting the path if needed.

This creates **Pianissimo** in `~/Applications`, so Launchpad and Spotlight find it. Because you
installed it yourself, the script removes the download's quarantine flag and gives the app a local
signature, so Gatekeeper opens it without the "developer cannot be verified" dialog.

- **Python.** Pianissimo needs Python 3, which comes with Apple's Command Line Tools. If it is missing,
  the script starts their installer (`xcode-select --install`); run the script again afterwards.
- **The window.** With Chrome, Edge, Chromium or Brave installed, Pianissimo opens in its own window.
  Otherwise it opens in your default browser (Safari works too).
- **Scanning sheet music.** Install Audiveris from [its releases page](https://github.com/Audiveris/audiveris/releases/latest)
  (the `.dmg` for your Mac: arm64 for Apple silicon, x86_64 for Intel) into Applications.
- **Opening files.** Use **Open** in Pianissimo. Double-clicking score files in Finder is not
  supported on the Mac yet.
- **Removing.** Run `sh ~/Applications/Pianissimo.app/Contents/Resources/uninstall.sh`. Add `--purge` to
  delete the saved scores as well.

## Linux

1. Unpack the archive: `tar xzf Pianissimo-<version>-macos-linux.tar.gz`.
2. Run `sh Pianissimo-<version>/install.sh`. No sudo is needed.

Pianissimo then appears in the applications menu, with "Open with" for MusicXML, MIDI and `.pianissimo`
files. The `pianissimo` command also works if `~/.local/bin` is on your PATH.

- **Requirements.** Python 3.7+, which almost every desktop distribution includes. Any browser works;
  with Chrome, Chromium, Edge or Brave, Pianissimo gets its own window.
- **Scanning sheet music.** Install Audiveris (the `.deb` from [its releases page](https://github.com/Audiveris/audiveris/releases/latest),
  or from Flathub). Pianissimo looks for `/opt/audiveris/bin/Audiveris` and `audiveris` on the PATH; set
  `audiveris=` in `settings.ini` for anywhere else.
- **Removing.** Run `sh ~/.local/share/pianissimo/program/uninstall.sh`. Add `--purge` to delete the
  saved scores as well.
- **Without installing.** You can also run `python3 pianissimo.py` from the unpacked folder.

## Publishing an update

People who installed Pianissimo are told about a new version by the app itself. The app looks at the
latest release of the GitHub repository in `package.json` (`"pianissimo": { "updateFeed": "github:AbedTT/PIANISSIMO" }`);
the repository must be public. To release:

1. Raise `"version"` in `package.json` (e.g. `0.4.0` → `0.5.0`): only a higher version counts as an update.
2. `npm run package` (signed, if you set up signing).
3. On GitHub: **Releases → Draft a new release**, tag `v0.5.0`, write what is new (people see this text
   in the app under *What's new*), and attach the three files from `release/`. Publish.

Within a day every copy checks and offers it. Windows installs it with **Update now**: it accepts only a
`Pianissimo-Setup-*.exe` from that repository's releases, compares it with the SHA-256 that GitHub
publishes for each file, and, once your releases are signed, requires the same publisher's signature.

**Without GitHub.** Set `updateFeed` to the address of a `latest.json` on your own website
(`https://music.example.com/downloads/latest.json`). `npm run package` writes that file into `release/`
(with checksums); put it and the three files in that folder. Set `PIANISSIMO_RELEASE_NOTES` while
packaging to include the notes.

## Signing in, sharing and the online library

The installed app keeps everything on the computer. To sign in, share links, use the online library,
classes or editing together, connect it to a Pianissimo website, which you host yourself
(see [DEPLOY.md](DEPLOY.md)):

- **Windows.** Type the website's address in setup's *Online server* box.
- **Any system.** Edit `settings.ini` and add a line `server=https://your-pianissimo-site.example`.
  The file is in `%LOCALAPPDATA%\Pianissimo` on Windows, `~/Library/Application Support/Pianissimo` on
  macOS and `~/.local/share/pianissimo` on Linux.

Then restart Pianissimo. The app talks to that server through its own local address, so signing in
works as it does on the website.

## How it works

The desktop app is the same build as the website, served from the computer:

- **The launcher.**
  - On Windows it is `Pianissimo.exe` ([desktop/windows/Launcher.cs](../desktop/windows/Launcher.cs)).
  - On macOS and Linux it is `pianissimo.py` ([desktop/unix/pianissimo.py](../desktop/unix/pianissimo.py)).
  - It serves the app on `http://127.0.0.1:47831`, a fixed port, because the browser keeps saved scores
    per address.
  - It opens the app in a browser app window with its own profile, and exits when the last window closes.
- **Starting it again** opens another window in the running copy, and hands over any file that was
  double-clicked.
- **Safety.**
  - The local server answers only requests addressed to `127.0.0.1` or `localhost`, which blocks DNS
    rebinding.
  - Handing over files needs a secret token that is stored in the user's own folder.
  - An opened file can only be read through an unguessable link.
- **The online server.** `/server/…` requests go to the server in `settings.ini`, with its session
  cookie kept for the local address. Without a server they answer with a message explaining how to
  connect one.

## Building the installers

```
npm run package
```

This builds the web app, then writes three files to `release/`:

- `Pianissimo-Setup-<version>.exe`
- `Pianissimo-<version>-windows-portable.zip`
- `Pianissimo-<version>-macos-linux.tar.gz`

No extra tools or npm packages are needed:

- The Windows programs are compiled with the C# compiler that is part of the .NET Framework 4 in every
  Windows 10/11, so build the Windows files on Windows. On macOS or Linux only the `.tar.gz` is made.
- The zip, tar.gz and icon files are written by [scripts/package.mjs](../scripts/package.mjs).
- The version comes from `package.json`.

## Signing

Unsigned Windows programs make SmartScreen say **"Windows protected your PC … unknown publisher"**.
Signed ones show your name as the publisher.

1. Buy a code-signing certificate from a certificate authority (Sectigo, DigiCert, SSL.com, Certum…),
   or use Azure Trusted Signing. An **EV** certificate removes the SmartScreen warning at once; a standard
   (OV) one does so after enough people have installed signed releases.
2. Install the Windows SDK, which includes `signtool.exe` (or set `SIGNTOOL` to its path).
3. Build with the certificate. `npm run package` signs `Pianissimo.exe` (before it goes into the setup
   and the zip) and the setup, with a timestamp so the signature stays valid after the certificate expires:

   ```powershell
   $env:PIANISSIMO_SIGN_PFX = 'C:\keys\pianissimo.pfx'      # a certificate file …
   $env:PIANISSIMO_SIGN_PASSWORD = '…'
   # … or one in the Windows certificate store / on a USB token:
   # $env:PIANISSIMO_SIGN_THUMBPRINT = '<sha1 thumbprint>'
   npm run package
   ```

   Optional: `PIANISSIMO_SIGN_TIMESTAMP` (another timestamp server) and `PIANISSIMO_SIGN_URL`
   (the "more information" link shown with the signature).
4. Check it: right-click the setup → **Properties → Digital Signatures**, or
   `Get-AuthenticodeSignature release\Pianissimo-Setup-<version>.exe` in PowerShell.

Keep the certificate and its password out of the repository (an environment variable or a secret in CI).

**macOS.** The `.tar.gz` contains no compiled program: `install.sh` builds the app on the Mac from
scripts, clears the quarantine flag and signs it locally (ad hoc), so no Apple Developer ID is needed.
If you ever ship a ready-made `.app` or `.dmg` instead, sign it with a Developer ID certificate
(`codesign --options runtime`) and notarize it (`xcrun notarytool submit … --wait`, then
`xcrun stapler staple`).
