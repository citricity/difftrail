#!/usr/bin/env sh
#
# Creates a Diff Trek AI changelog: the current diff, with a placeholder after
# every hunk for the reason that hunk exists.
#
# This is what `git dt --createchangelog="claude"` does, in a form that runs
# anywhere `git` and `sh` do. An agent working in a container has the
# repository but not the desktop app — and often no network to fetch it — so
# the same job has to be doable with nothing but a shell.
#
# Usage:
#   scripts/difftrek-changelog.sh --author="claude" [revisions...]
#
#   --author   Who is writing the notes. Shown in Diff Trek, so a reader knows
#              whose account of the change they are reading.
#   revisions  Optional, passed to `git diff` (e.g. `main...HEAD`). The working
#              tree is the default.
#
# Writes the file, prints its path on the first line of stdout, and the
# instructions for filling it in after that. Everything else goes to stderr, so
# a caller can take the path with `head -1`.

set -eu

# --- pinned capture -----------------------------------------------------------
#
# Diff Trek matches a changelog against the diff Git reports *now*, so both have
# to be produced identically — and much of `git diff` output is configurable.
# These two lists are checked against src-tauri/src/ai_changelog/capture.rs by
# `pinned_flags_match_the_script` in the Rust tests: change one and that test
# fails until the other follows.

GIT_CONFIG_ARGS="-c diff.renames=true -c diff.suppressBlankEmpty=false"

GIT_DIFF_FLAGS="--no-color --no-ext-diff --no-textconv --full-index \
--unified=3 --inter-hunk-context=0 --indent-heuristic \
--diff-algorithm=myers --find-renames=50% -l1000 \
--src-prefix=a/ --dst-prefix=b/ --no-relative \
--submodule=short --ignore-submodules=none"

# `top` matters as much as `exclude`: pathspecs resolve against the current
# directory, and this is normally run from somewhere inside the repository.
EXCLUDE_PATHSPEC=':(top,exclude,literal).difftrek'

CHANGELOG_DIR=".difftrek/ai_changelog"
FORMAT_VERSION=1
MARKER="~~DIFFTREK_AI"

usage() {
  sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'
}

author=""
while [ $# -gt 0 ]; do
  case "$1" in
    --author=*) author="${1#--author=}"; shift ;;
    --author)
      author="${2:-}"
      shift
      if [ $# -gt 0 ]; then shift; fi
      ;;
    -h | --help) usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) break ;;
  esac
done

if [ -z "$author" ]; then
  echo "Name whoever is writing the notes, so a reader knows whose account" >&2
  echo "of the change they are reading:" >&2
  echo >&2
  echo "    $0 --author=\"claude\"" >&2
  exit 2
fi

root=$(git rev-parse --show-toplevel) || exit 1
cd "$root"

# --- the changelog folder has to stay out of the repository --------------------
#
# An untracked folder never reaches a diff, but the first `git add -A` would
# commit every changelog, and from then on they appear in diffs — including the
# diff of the change being annotated.
#
# The exclusion goes in .git/info/exclude, never .gitignore: .gitignore is
# tracked, so editing it would put a change into the very diff under review, and
# it is shared with everyone else on the project.

if [ -n "$(git ls-files -- .difftrek)" ]; then
  echo ".difftrek/ is already tracked by git, so ignoring it has no effect." >&2
  echo "Remove it from the index first:  git rm -r --cached .difftrek" >&2
  exit 1
fi

# Asked about a file *inside* the folder: `check-ignore` decides whether a name
# is a directory by looking on disk, so before the folder exists a `.difftrek/`
# rule would not match the bare name.
if ! git check-ignore -q -- "$CHANGELOG_DIR/probe.log"; then
  # `--git-common-dir` because .git is a file in a worktree or submodule, and a
  # linked worktree keeps info/exclude in the directory it shares.
  common=$(git rev-parse --path-format=absolute --git-common-dir)
  exclude="$common/info/exclude"

  mkdir -p "$common/info"
  if ! grep -qx '\.difftrek/' "$exclude" 2>/dev/null; then
    # Git's own default file often ends without a trailing newline. Written as
    # an `if` rather than an `&&` chain: under `set -e` the exit status of a
    # bare chain is the script's, and this one is false most of the time.
    if [ -s "$exclude" ] && [ -n "$(tail -c 1 "$exclude")" ]; then
      echo >> "$exclude"
    fi
    printf '\n# Diff Trek AI changelogs\n.difftrek/\n' >> "$exclude"
    echo "Added .difftrek/ to $exclude — local to this clone, and invisible to every diff." >&2
    echo >&2
  fi
fi

# --- capture ------------------------------------------------------------------

# Word splitting is what the two flag lists above are for.
# shellcheck disable=SC2086
diff=$(LC_ALL=C git $GIT_CONFIG_ARGS diff $GIT_DIFF_FLAGS "$@" -- "$EXCLUDE_PATHSPEC")

if [ -z "$diff" ]; then
  echo "There are no changes to write a changelog for." >&2
  exit 1
fi

# --- nonce --------------------------------------------------------------------
#
# Every tag carries it, so a line that looks like a tag but does not match is
# diff content — which is what lets a change to this format's own documentation
# be annotated at all. Because the diff is already in hand, "does not occur in
# it" can be guaranteed rather than hoped for.
#
# One case only: the nonce is also the file name, and macOS filesystems are
# case-insensitive. I, O, 0 and 1 are left out because people read these aloud.

nonce=""
length=6
while [ -z "$nonce" ]; do
  attempts=0
  while [ "$attempts" -lt 8 ]; do
    candidate=$(LC_ALL=C tr -dc 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' < /dev/urandom \
      | dd bs=1 count="$length" 2>/dev/null)
    attempts=$((attempts + 1))
    case "$diff" in
      *"$candidate"*) ;;
      *) nonce="$candidate"; break ;;
    esac
  done
  length=$((length + 1))
done

# --- write it -----------------------------------------------------------------

# Only the working tree is recorded. Diff Trek's own comparison kinds are
# "workingTree" and "commits" — and "commits" carries the two object ids it
# resolved, which means repeating its rules for `A..B`, `A...B`, `X^!` and root
# commits here. Inventing a third kind would be worse than saying nothing: the
# app treats a kind it does not know as a different comparison and ignores the
# changelog entirely. Left out, matching decides on content, as it does for any
# changelog written before this field existed.
if [ "$#" -eq 0 ]; then
  captured_against='  "capturedAgainst": {
    "kind": "workingTree"
  },'
else
  captured_against=""
fi

capture_args=$(
  for arg in $GIT_CONFIG_ARGS $GIT_DIFF_FLAGS; do
    printf '    "%s",\n' "$arg"
  done | sed '$ s/,$//'
)

mkdir -p "$CHANGELOG_DIR"
path="$CHANGELOG_DIR/$nonce.log"

{
  printf '%s v%s %s~~\n' "$MARKER" "$FORMAT_VERSION" "$nonce"

  printf '%s:%s:CHANGE_INFO~~\n' "$MARKER" "$nonce"
  printf '{\n'
  printf '  "author": "%s",\n' "$author"
  if [ -n "$captured_against" ]; then printf '%s\n' "$captured_against"; fi
  printf '  "captureArgs": [\n%s\n  ],\n' "$capture_args"
  printf '  "toolVersion": "difftrek-changelog.sh",\n'
  printf '  "createdAt": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '}\n'
  printf '%s:%s:/CHANGE_INFO~~\n' "$MARKER" "$nonce"

  printf '%s:%s:LOGICAL_CHANGE_TABLE~~\n[]\n%s:%s:/LOGICAL_CHANGE_TABLE~~\n' \
    "$MARKER" "$nonce" "$MARKER" "$nonce"

  # The diff, with an empty placeholder after every hunk header. Each one is
  # uniquely identified so an author can fill it in by exact match rather than
  # rewriting the file — which is how whole diffs get mangled.
  printf '%s\n' "$diff" | awk -v marker="$MARKER" -v nonce="$nonce" '
    { print }
    /^@@ / {
      id = "h" (++placeholder)
      print marker ":" nonce ":HUNK_REASON id=" id "~~"
      print marker ":" nonce ":/HUNK_REASON id=" id "~~"
    }
  '

  printf '%s:%s:END~~\n' "$MARKER" "$nonce"
} > "$path"

hunks=$(printf '%s\n' "$diff" | grep -c '^@@ ' || true)

printf '%s/%s\n\n' "$root" "$path"

cat <<INSTRUCTIONS
$hunks hunk(s) to explain. Fill in each placeholder:

    $MARKER:$nonce:HUNK_REASON id=hN~~
    why this hunk exists — not what it does, the diff shows that
    $MARKER:$nonce:/HUNK_REASON id=hN~~

Group the hunks belonging to one intent by wrapping them in
    $MARKER:$nonce:LOGICAL_CHANGE_START id=0 /~~ … $MARKER:$nonce:LOGICAL_CHANGE_END id=0 /~~
and describe each id in the LOGICAL_CHANGE_TABLE block. A span may open
and close more than once, which is how one intent covers hunks 1 and 3
but not 2, and how it gets markers in each file it touches.

Edit only inside the tag blocks. Never retype the diff — one altered
space unmatches a hunk and loses its note — and do not quote a live
$nonce tag inside a reason, which would end the block early.
INSTRUCTIONS
