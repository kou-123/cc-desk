#!/bin/zsh
# Offline-friendly Electron binary install (npmmirror → GitHub fallback)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VER="$(node -p "require('./node_modules/electron/package.json').version")"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PLATFORM=darwin-arm64 ;;
  x86_64) PLATFORM=darwin-x64 ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac
ZIP="electron-v${VER}-${PLATFORM}.zip"
CACHE="${ELECTRON_CACHE:-$HOME/Library/Caches/electron}"
mkdir -p "$CACHE" node_modules/electron/dist
OUT="$CACHE/$ZIP"
if [[ ! -f "$OUT" ]]; then
  URL1="https://npmmirror.com/mirrors/electron/v${VER}/${ZIP}"
  URL2="https://github.com/electron/electron/releases/download/v${VER}/${ZIP}"
  echo "Downloading $URL1"
  curl -L --fail --retry 3 -o "$OUT" "$URL1" || curl -L --fail --retry 3 -o "$OUT" "$URL2"
fi
rm -rf node_modules/electron/dist
mkdir -p node_modules/electron/dist
unzip -q -o "$OUT" -d node_modules/electron/dist
printf '%s' 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
printf '%s' "$VER" > node_modules/electron/dist/version
echo "Electron $VER ready → $(node -e "console.log(require('electron'))")"
