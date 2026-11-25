#!/bin/zsh
cd "$(dirname "$0")"
APP="$PWD/release/mac-arm64/Claude Panel.app"
exec "$APP/Contents/MacOS/Claude Panel"
