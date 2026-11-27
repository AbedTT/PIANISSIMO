#!/bin/sh
# Installs Pianissimo for the current user on macOS or Linux (no sudo needed).
#
#   sh install.sh
#
# macOS: creates ~/Applications/Pianissimo.app (Launchpad and Spotlight find it).
# Linux: copies the program to ~/.local/share/pianissimo/program, adds "Pianissimo" to the
#        applications menu (with "Open with" for score files) and a `pianissimo` command.
# Needs Python 3 and, for the app window, Chrome, Chromium, Edge or Brave (any browser works without).
set -eu

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
VERSION=$(cat "$HERE/VERSION" 2>/dev/null || echo "")

say() { printf '%s\n' "$*"; }
fail() { printf 'Pianissimo: %s\n' "$*" >&2; exit 1; }

[ -f "$HERE/app/app.html" ] || fail "run this script from the unpacked Pianissimo folder (app/ is missing)."

find_python() {
  for p in python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3 /usr/bin/python3; do
    if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' >/dev/null 2>&1; then
      command -v "$p"
      return 0
    fi
  done
  return 1
}

if [ "$(uname -s)" = "Darwin" ]; then
  # On macOS, /usr/bin/python3 only works once the Command Line Tools are installed
  if ! find_python >/dev/null; then
    say "Pianissimo needs Python 3. Install Apple's Command Line Tools (a dialog opens), then run this script again:"
    say "  xcode-select --install"
    xcode-select --install >/dev/null 2>&1 || true
    exit 1
  fi
  APP="$HOME/Applications/Pianissimo.app"
  say "Installing Pianissimo $VERSION to $APP"
  mkdir -p "$HOME/Applications"
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  cp -R "$HERE/app" "$HERE/pianissimo.py" "$HERE/uninstall.sh" "$HERE/icon.png" "$APP/Contents/Resources/"
  [ -f "$HERE/VERSION" ] && cp "$HERE/VERSION" "$APP/Contents/Resources/"
  cat > "$APP/Contents/MacOS/Pianissimo" <<'EOF'
#!/bin/sh
# Finder starts apps with a short PATH: look for Python 3 where installers put it
DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/../Resources" && pwd)
for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3 /usr/bin/python3; do
  if [ -x "$p" ] && "$p" -c 'import sys' >/dev/null 2>&1; then exec "$p" "$DIR/pianissimo.py" "$@"; fi
done
osascript -e 'display alert "Pianissimo needs Python 3" message "Install Apple'"'"'s Command Line Tools (run: xcode-select --install in Terminal) and open Pianissimo again."' >/dev/null 2>&1
exit 1
EOF
  chmod 755 "$APP/Contents/MacOS/Pianissimo" "$APP/Contents/Resources/pianissimo.py" "$APP/Contents/Resources/uninstall.sh"
  # app icon from the PNG, with the tools every Mac has
  ICONSET=$(mktemp -d)/Pianissimo.iconset
  mkdir -p "$ICONSET"
  for s in 16 32 128 256; do
    sips -z $s $s "$HERE/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
    d=$((s * 2))
    sips -z $d $d "$HERE/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Pianissimo.icns" >/dev/null 2>&1 || true
  cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Pianissimo</string>
  <key>CFBundleDisplayName</key><string>Pianissimo</string>
  <key>CFBundleIdentifier</key><string>app.pianissimo.desktop</string>
  <key>CFBundleVersion</key><string>${VERSION:-1.0}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION:-1.0}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Pianissimo</string>
  <key>CFBundleIconFile</key><string>Pianissimo</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF
  # files from a download carry Apple's quarantine flag, which makes Gatekeeper refuse to open the
  # app ("cannot be opened because the developer cannot be verified"). You chose to install it by
  # running this script, so clear the flag, and give the app a local (ad-hoc) signature.
  xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
  touch "$APP"
  say "Done. Open Pianissimo from Launchpad, Spotlight or ~/Applications."
  say "To remove it: sh \"$APP/Contents/Resources/uninstall.sh\""
  exit 0
fi

# ------------------------------------------------------------------ Linux and other Unix desktops
PY=$(find_python) || fail "Python 3.7 or newer is needed (install the python3 package of your distribution)."
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
PROGRAM="$DATA/pianissimo/program"
say "Installing Pianissimo $VERSION to $PROGRAM"
rm -rf "$PROGRAM"
mkdir -p "$PROGRAM" "$HOME/.local/bin" "$DATA/applications" "$DATA/icons/hicolor/512x512/apps" "$DATA/mime/packages"
cp -R "$HERE/app" "$HERE/pianissimo.py" "$HERE/uninstall.sh" "$HERE/icon.png" "$PROGRAM/"
[ -f "$HERE/VERSION" ] && cp "$HERE/VERSION" "$PROGRAM/"
chmod 755 "$PROGRAM/pianissimo.py" "$PROGRAM/uninstall.sh"
cat > "$HOME/.local/bin/pianissimo" <<EOF
#!/bin/sh
exec "$PY" "$PROGRAM/pianissimo.py" "\$@"
EOF
chmod 755 "$HOME/.local/bin/pianissimo"
cp "$HERE/icon.png" "$DATA/icons/hicolor/512x512/apps/pianissimo.png"

cat > "$DATA/mime/packages/pianissimo.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-pianissimo">
    <comment>Pianissimo score</comment>
    <glob pattern="*.pianissimo"/>
  </mime-type>
</mime-info>
EOF

cat > "$DATA/applications/pianissimo.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Pianissimo
GenericName=Music notation editor
Comment=Write sheet music as fast as you can type
Exec="$HOME/.local/bin/pianissimo" %F
Icon=pianissimo
Terminal=false
Categories=AudioVideo;Audio;Music;Education;
Keywords=sheet music;notation;score;composer;midi;musicxml;
MimeType=application/x-pianissimo;application/vnd.recordare.musicxml+xml;application/vnd.recordare.musicxml;audio/midi;audio/x-midi;
StartupNotify=true
EOF

command -v update-mime-database >/dev/null 2>&1 && update-mime-database "$DATA/mime" >/dev/null 2>&1 || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$DATA/icons/hicolor" >/dev/null 2>&1 || true

say "Done. Start Pianissimo from your applications menu, or run: pianissimo"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "(Add ~/.local/bin to your PATH to use the pianissimo command.)" ;; esac
say "To remove it: sh \"$PROGRAM/uninstall.sh\""
