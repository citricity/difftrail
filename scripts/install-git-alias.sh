#!/usr/bin/env bash
#
# Installs the `git dt` alias.
#
# The alias passes the current working directory explicitly rather than relying
# on the process inheriting it: a macOS .app bundle is launched by the window
# server, so its working directory is not the shell's.

set -euo pipefail

SCOPE="--global"
BINARY=""

usage() {
  cat <<'USAGE'
Usage: install-git-alias.sh [--local] [--binary PATH]

  --local        Install the alias for the current repository only.
  --binary PATH  Path to the Diff Trek executable. Auto-detected if omitted.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) SCOPE="--local"; shift ;;
    --binary) BINARY="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$BINARY" ]]; then
  CANDIDATES=(
    "/Applications/Diff Trek.app/Contents/MacOS/diff-trek"
    "$HOME/Applications/Diff Trek.app/Contents/MacOS/diff-trek"
    "$(dirname "$0")/../src-tauri/target/release/diff-trek"
    "$(dirname "$0")/../src-tauri/target/debug/diff-trek"
  )

  for candidate in "${CANDIDATES[@]}"; do
    if [[ -x "$candidate" ]]; then
      BINARY="$candidate"
      break
    fi
  done
fi

if [[ -z "$BINARY" ]]; then
  echo "Could not find the Diff Trek executable." >&2
  echo "Build it with 'pnpm tauri build', or pass --binary PATH." >&2
  exit 1
fi

if [[ ! -x "$BINARY" ]]; then
  echo "Not executable: $BINARY" >&2
  exit 1
fi

# `!f() { ...; }; f` is git's idiom for an alias that needs a real shell.
# `git rev-parse --show-toplevel` fails outside a repository, which is the
# error the user should see rather than an empty window. "$@" forwards the
# alias's own arguments, so `git dt main...HEAD` opens that range.
#
# Inside a .app bundle, launch through `open -n`: macOS refuses focus to an app
# whose executable the terminal ran directly, so its window would open behind
# the terminal. Keep in step with `alias_value` in src-tauri/src/git_alias.rs.
#
# An argument starting with `-` is a command-line request (`git dt
# --createchangelog="claude"`), not a window, so the executable runs in the
# foreground with its output left alone — neither window launch below could
# hand anything back to the terminal.
if [[ "$BINARY" =~ ^(.+\.app)/Contents/MacOS/[^/]+$ ]]; then
  BUNDLE="${BASH_REMATCH[1]}"
  WINDOW="open -n \"$BUNDLE\" --args \"\$root\" \"\$@\""
else
  WINDOW="\"$BINARY\" \"\$root\" \"\$@\" >/dev/null 2>&1 &"
fi

git config "$SCOPE" alias.dt \
  "!f() { root=\$(git rev-parse --show-toplevel) || exit 1; case \"\$1\" in -*) \"$BINARY\" \"\$root\" \"\$@\";; *) $WINDOW ;; esac; }; f"

echo "Installed: git dt"
echo "  binary: $BINARY"
echo "  scope:  ${SCOPE#--}"
