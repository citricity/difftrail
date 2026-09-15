# Diff Trail

A fast desktop Git diff viewer. Every changed file appears in **one continuous
scrolling document**, and Previous/Next Change step through every hunk in the
entire working-tree diff — crossing file boundaries without the reader having
to think about them.

That last part is the point. Traditional diff tools scope next/previous-change
navigation to the file you happen to have open; Diff Trail does not.

## Requirements

- Node 20.19+, 22.13+ or 24+, and [pnpm](https://pnpm.io)
- Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform
- Git on your `PATH`

## Getting started

```bash
pnpm install
pnpm tauri dev          # desktop app against the current repository
```

`pnpm dev` alone runs the UI in a browser against sample data, which is handy
for working on the interface without the desktop shell.

Passing `--example` shows that same sample diff in the desktop app instead of
reading a repository, so it opens anywhere — no Git working tree required:

```bash
difftrail --example
pnpm tauri dev -- -- --example   # the same, during development
```

The sample is several files, one of them with two hunks, plus a binary file and
a deleted one — enough to try continuous scrolling and global Previous/Next
Change against. The repository name reads `difftrail (example)` so it is never
mistaken for real changes.

To build and install the `git dt` alias:

```bash
pnpm tauri build
./scripts/install-git-alias.sh
```

`git dt` then opens Diff Trail on whichever repository you are standing in. The
alias resolves the repository root itself and passes it as an argument, because
a macOS `.app` bundle does not inherit the shell's working directory.

## What it shows

Diff Trail reviews **unstaged changes to tracked files** — exactly what a bare
`git diff` reports, the index compared against the working tree. So:

- staged changes are excluded; if a file is partly staged you see only the
  unstaged remainder
- untracked files never appear (a v2 feature)
- modified, deleted, renamed and type-changed tracked files all show up

## Settings

**Diff Trail → Settings…** (⌘,) on macOS, or the gear in the toolbar. They live
in `settings.json` in the platform's
own config directory, written through the backend rather than kept in the
webview, and a missing or damaged file reads as the defaults rather than as an
error — a preference is never worth an error screen in front of the diff.

The rest of the macOS menu bar is Tauri's own default, which it installs when
the builder is given no menu — that is where ⌘C, ⌘W, Hide and About already
come from. Only the Settings item is ours, because a settings item is the one
thing `PredefinedMenuItem` cannot supply: the OS knows what About and Quit do,
but only the app knows what Settings opens. Other platforms get no menu from
Tauri, so there the gear is the way in.

The item follows macOS 13, which renamed Preferences to Settings; the dialog,
the Rust module and `settings.json` all use the same word.

Deliberately small: `CLAUDE.md` puts complex preference screens out of scope.

## Keyboard

| Key       | Action          |
| --------- | --------------- |
| `n` / `j` | Next change     |
| `p` / `k` | Previous change |

## Architecture

```
React
  ↓
useRepositoryDiff / useDiffNavigation      hooks own loading and navigation
  ↓
services/backend.ts                        the only module that calls invoke()
  ↓
Tauri command
  ↓
src-tauri/src/git/                         git execution, parsing, domain logic
```

Three things are kept deliberately separate, and conflating them is the bug
this design exists to prevent:

| Concept                    | Where it lives                      |
| -------------------------- | ----------------------------------- |
| Files in the diff          | `state.files` — the complete list    |
| Files whose diff is loaded | `DocumentFile.diff !== null`         |
| Files currently rendered   | `visibleRange()` in the virtualiser  |

A repository might have 300 changed files, 80 loaded diffs and 6 rows on
screen. Global navigation still behaves as though the whole repository is one
logical document, because it resolves against the model (`lib/navigation.ts`)
and never against the DOM.

### Rendering

The diff renderer is Diff Trail's own (`features/diff/`), roughly 250 lines
over a handful of components. Every row has a known height — a diff line is
exactly one line tall — so scroll offsets are exact arithmetic rather than
estimates, and revealing a hunk needs no measurement pass.

The geometry is read at runtime from the CSS custom properties in
`styles/tokens.css`, so changing a row height or the code font size is a
one-line change with no matching edit in TypeScript.

By default lines do not wrap: long ones scroll horizontally while the
line-number gutter stays pinned. Turning wrapping on in Settings wraps them
at a fixed column instead — see below.

### Syntax colours

Code is coloured by [Shiki](https://shiki.style), using the same TextMate
grammars VS Code does. Grammars load on demand, one chunk per language, so a
session only fetches what it looked at.

The colours are not Shiki's. `lib/syntaxTheme.ts` maps every scope to a CSS
custom property, and `styles/tokens.css` defines them — values modelled on
VS Code's default Light+ and Dark+, sitting alongside the existing diff greens
and reds. So the palette is retuned in CSS, switches with `prefers-color-scheme`
without re-tokenising anything, and stays part of Diff Trail's own small design
system rather than a bundled editor theme.

Three details do the real work:

- Each side is tokenised as the **whole file** it is, not as the hunks it was
  cut into. A hunk that opens inside a block comment has no way to know that
  from its own text, and would colour the comment as code.
- The old and new sides are tokenised **separately**. Interleaved `-`/`+` lines
  are not a program either, and highlighting them as one text lets an
  unterminated string on a deleted line bleed into the line that replaced it.
- Syntax colour and word-level change shading are merged into one flat list of
  spans per line (`lib/runs.ts`) rather than nested. Their boundaries do not
  line up — a changed word can span several tokens, and one token can be
  partly changed — so neither can wrap the other.

Highlighting happens while a diff loads, before it is shown, which keeps the
render path synchronous. It is strictly a nicety: a missing grammar, an
unrecognised extension or a tokeniser failure all end with the diff rendering
uncoloured rather than not at all.

### Wrapping

Wrapping is off by default and switched on in Settings, where the column it
wraps at is stored separately, so turning wrapping off and on again does not
forget it.

Diff Trail does the wrapping itself rather than handing it to CSS, and the
reason is the scroll model. `white-space: pre-wrap` breaks at word boundaries
where it can, so the number of visual lines depends on where the spaces fall
and only the DOM would know it — which is exactly the measurement the
virtualiser exists to avoid. Wrapping at a fixed column keeps it arithmetic: a
line is `ceil(length / column)` rows tall, and `lib/wrap.ts` splits its spans to
match, preserving colour and change shading across the break.

A continuation row carries no line number on either side. That is unambiguous
on its own — every real diff line has at least one, an addition lacking only the
old number and a deletion only the new — but it is quiet, so continuations also
show a faint `↪` where the `+`/`-` marker would be.

### Expanding context

The lines between two hunks are not gone, just not shown. Each gap carries an
expander: one click reveals twenty lines towards the change on that side, or
the whole gap once twenty lines or fewer remain. Expanding the middle of a gap
leaves an expander either side of the new context, so repeated clicks converge
on the whole file.

Expanded context does not join the Previous/Next Change sequence. It is
context, not a change.

This and whole-file highlighting share one source. Both sides of a file are
read via `get_file_contents` alongside its diff — lazily, like the diff itself,
so the cost tracks what you scroll to rather than the size of the repository —
and then **every diff line is checked against the file it claims to come
from**. A single disagreement, which is what a working tree edited mid-review
looks like, withdraws the file from both features rather than showing
surrounding lines that are quietly wrong.

### Lazy loading

```
1. Discover changed files          (two cheap git calls, no diff bodies)
2. Render the document skeleton    (header and file list appear immediately)
3. Load the first few diffs
4. Load neighbours as they approach the viewport
```

At most five diffs are read concurrently. Diffs above 2 MB come back marked
`truncated` and are rendered as a "Load anyway" notice rather than stalling
startup; that cap is also what bounds the size of the row model.

## Development

```bash
pnpm check          # typecheck, lint, frontend tests, Rust tests
pnpm typecheck
pnpm lint
pnpm test
pnpm test:rust
pnpm format
```

### The application icon

`app-icon.png` at the repository root is the source: 1024×1024, transparent
outside the rounded rectangle, no baked-in shadow. `src-tauri/icons/` is
generated from it.

`app-icon-small.png` is the same drawing with four of the seven bars removed.
Below about 48px seven bars stop being shapes and become texture, so the
small entries — `32x32.png`, and the 16, 32 and 48 entries inside `icon.ico`
and `icon.icns` — come from that one instead. The geometry is identical; only
the bar count differs.

One thing to know before regenerating with `pnpm tauri icon app-icon.png`:
`icon.icns` is **not** full-bleed. macOS draws its own shadow and expects the
rounded rectangle to sit inside a margin — 824 of 1024, as Apple's own icons do
— or it stands a head taller than everything else in the Dock. Every other size
is full-bleed. `tauri icon` does not know about that margin and will flatten it.

Tests concentrate on behaviour with real value: global navigation order,
flattening files and hunks into that order, the row/offset arithmetic, word
diffing, error mapping, and — on the Rust side — unified diff parsing plus
integration tests that build actual repositories and assert the staged versus
unstaged semantics.

## Out of scope

Diff Trail is a diff viewer, not a Git GUI. No staging, committing, editing,
history browsing, branch management or remote integration.

## Licence

MIT — see [LICENSE](./LICENSE).
