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
- **Updating.** Run the newer setup; your scores are kept.
- **Removing.** Go to *Settings → Apps → Installed apps → Pianissimo → Uninstall*. You are asked whether
  to keep the scores saved on the computer.
- **"Windows protected your PC".** The setup file is not code-signed yet, so SmartScreen may warn the
  first time. Click **More info → Run anyway**. Signing it with a code-signing certificate removes the
  warning (see *Building the installers*).
- **Scripted installs.** `Pianissimo-Setup-<version>.exe /S` installs silently, and
  `/server=https://…` sets the online server. Uninstall silently with
  `"%LOCALAPPDATA%\Programs\Pianissimo\Pianissimo.exe" --uninstall /S`.

## macOS

1. Unpack `Pianissimo-<version>-macos-linux.tar.gz` (double-click it in Finder).
2. In Terminal, run `sh ~/Downloads/Pianissimo-<version>/install.sh`, adjusting the path if needed.

This creates **Pianissimo** in `~/Applications`, so Launchpad and Spotlight find it.

- **Python.** Pianissimo needs Python 3, which comes with Apple's Command Line Tools. If it is missing,
  the script starts their installer (`xcode-select --install`); run the script again afterwards.
- **The window.** With Chrome, Edge, Chromium or Brave installed, Pianissimo opens in its own window.
  Otherwise it opens in your default browser (Safari works too).
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
- **Removing.** Run `sh ~/.local/share/pianissimo/program/uninstall.sh`. Add `--purge` to delete the
  saved scores as well.
- **Without installing.** You can also run `python3 pianissimo.py` from the unpacked folder.

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

**Code signing.** To sign the Windows files, run `signtool sign /fd sha256 /a /tr <timestamp-url> /td sha256 <file>`
on `Pianissimo-Setup-<version>.exe`, using a code-signing certificate. Signing removes the SmartScreen
warning once the certificate has built up a reputation.
