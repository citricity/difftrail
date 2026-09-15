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
  --binary PATH  Path to the Diff Trail executable. Auto-detected if omitted.
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
    "/Applications/Diff Trail.app/Contents/MacOS/diff-trail"
    "$HOME/Applications/Diff Trail.app/Contents/MacOS/diff-trail"
    "$(dirname "$0")/../src-tauri/target/release/diff-trail"
    "$(dirname "$0")/../src-tauri/target/debug/diff-trail"
  )

  for candidate in "${CANDIDATES[@]}"; do
    if [[ -x "$candidate" ]]; then
      BINARY="$candidate"
      break
    fi
  done
fi

if [[ -z "$BINARY" ]]; then
  echo "Could not find the Diff Trail executable." >&2
  echo "Build it with 'pnpm tauri build', or pass --binary PATH." >&2
  exit 1
fi

if [[ ! -x "$BINARY" ]]; then
  echo "Not executable: $BINARY" >&2
  exit 1
fi

# `!f() { ...; }; f` is git's idiom for an alias that needs a real shell.
# `git rev-parse --show-toplevel` fails outside a repository, which is the
# error the user should see rather than an empty window.
git config "$SCOPE" alias.dt \
  "!f() { root=\$(git rev-parse --show-toplevel) || exit 1; \"$BINARY\" \"\$root\" >/dev/null 2>&1 & }; f"

echo "Installed: git dt"
echo "  binary: $BINARY"
echo "  scope:  ${SCOPE#--}"
