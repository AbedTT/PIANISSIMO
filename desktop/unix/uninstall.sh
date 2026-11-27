#!/bin/sh
# Removes Pianissimo installed by install.sh.
#
#   sh uninstall.sh          remove the program, keep the scores saved on this computer
#   sh uninstall.sh --purge  also delete the saved scores and settings
set -eu
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

if [ "$(uname -s)" = "Darwin" ]; then
  rm -rf "$HOME/Applications/Pianissimo.app"
  [ $PURGE = 1 ] && rm -rf "$HOME/Library/Application Support/Pianissimo"
else
  DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
  rm -rf "$DATA/pianissimo/program"
  rm -f "$HOME/.local/bin/pianissimo" "$DATA/applications/pianissimo.desktop" \
    "$DATA/icons/hicolor/512x512/apps/pianissimo.png" "$DATA/mime/packages/pianissimo.xml"
  command -v update-mime-database >/dev/null 2>&1 && update-mime-database "$DATA/mime" >/dev/null 2>&1 || true
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
  [ $PURGE = 1 ] && rm -rf "$DATA/pianissimo"
fi
if [ $PURGE = 1 ]; then
  echo "Pianissimo and its saved scores were removed."
else
  echo "Pianissimo was removed. Your saved scores are kept (sh uninstall.sh --purge deletes them)."
fi
