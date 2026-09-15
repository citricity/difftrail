# Diff Trail

A fast desktop Git diff viewer. Every changed file appears in **one continuous
scrolling document**, and Previous/Next Change step through every hunk in the
entire working-tree diff — crossing file boundaries without the reader having
to think about them.

That last part is the point. Traditional diff tools scope next/previous-change
navigation to the file you happen to have open; Diff Trail does not.

## Requirements

- Node 20.19+ and [pnpm](https://pnpm.io)
- Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform
- Git on your `PATH`

## Getting started

```bash
pnpm install
pnpm tauri dev          # desktop app against the current repository
```

`pnpm dev` alone runs the UI in a browser against sample data, which is handy
for working on the interface without the desktop shell.

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

Lines do not wrap; long lines scroll horizontally while the line-number gutter
stays pinned.

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
