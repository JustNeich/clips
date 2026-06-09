#!/bin/sh
set -eu

APP_DATA_DIR="${APP_DATA_DIR:-/var/data/app}"
CODEX_SESSIONS_DIR="${CODEX_SESSIONS_DIR:-/var/data/codex-sessions}"
HOME="${HOME:-/home/clips}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
PORT="${PORT:-10000}"

export APP_DATA_DIR CODEX_SESSIONS_DIR HOME XDG_CACHE_HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME

mkdir -p "$APP_DATA_DIR" "$CODEX_SESSIONS_DIR" "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"

if [ "$(id -u)" = "0" ]; then
  chown -R clips:clips "$APP_DATA_DIR" "$CODEX_SESSIONS_DIR" "$HOME"
  exec gosu clips ./node_modules/.bin/next start -H 0.0.0.0 -p "$PORT"
fi

exec ./node_modules/.bin/next start -H 0.0.0.0 -p "$PORT"
