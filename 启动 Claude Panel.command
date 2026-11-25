#!/bin/zsh
cd "$(dirname "$0")" || exit 1
APP="$PWD/release/mac-arm64/CC Desk.app"
if [[ -x "$APP/Contents/MacOS/CC Desk" ]]; then
  exec "$APP/Contents/MacOS/CC Desk"
fi
exec npm run electron:dev
