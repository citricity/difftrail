# Diff Trek — Project Overview

## Purpose

**Diff Trek** is a simple, fast desktop Git diff viewer designed to improve on the workflow of tools such as Beyond Compare when reviewing a whole working-tree diff.

The key UX requirement is:

> Show the diffs for multiple changed files in one continuous scrolling view, while allowing the user to step through every individual change across every file using global Previous/Next Change controls.

Diff Trek should feel closer to a modern code-review interface than a traditional file-by-file diff application.

---

## Technology

### Desktop shell

Use **Tauri**.

The project was initially considered as an Electron/web application, but Tauri was chosen because it provides a lightweight desktop shell while still allowing the UI to be built using normal web technologies.

### Frontend

Use a **modern React setup**.

Required frontend stack:

- React
- TypeScript
- Vite
- pnpm

Use current, idiomatic React patterns.

Prefer:

- functional components
- hooks
- TypeScript throughout
- ES modules
- modern browser APIs
- small, focused components
- clear separation between UI state and Tauri/backend integration

Avoid:

- Create React App
- npm or Yarn unless there is a specific technical reason
- class components
- CommonJS in frontend code
- unnecessarily old React patterns
- unnecessary framework abstractions

The frontend should be created and maintained as a normal Vite application rather than relying on custom or legacy bundling infrastructure.

Use `pnpm` for dependency installation, package management, scripts, lockfile management, and workspace support if the project later becomes a monorepo.

`pnpm-lock.yaml` should be committed.

Prefer standard package scripts such as:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  }
}
```

Exact scripts can evolve as the project develops.

---

## UI stack

Keep the UI stack deliberately small.

Use:

- native HTML elements wherever practical
- CSS Modules or similarly lightweight plain CSS
- Lucide React for icons
- Base UI only for complex accessible primitives where native HTML is insufficient

Examples of appropriate Base UI usage include:

- menus
- context menus
- tooltips
- dialogs
- popovers
- selects

Do not treat Base UI as the foundation of the application. Most of Diff Trek's interface should be built using ordinary React components and CSS.

For example, a toolbar button should normally just be a native button:

```tsx
<button aria-label="Next change">
  <ChevronDown />
</button>
```

Do not introduce a UI framework merely to provide basic buttons, panels, toolbars, spacing or typography.

### Do not add by default

Do not introduce any of the following unless a concrete requirement clearly justifies it:

- Tailwind CSS
- shadcn/ui
- Material UI
- Chakra UI
- Bootstrap
- Ant Design
- styled-components
- Emotion
- another general-purpose component framework
- another CSS-in-JS system

The application is intentionally small enough that a large design system would create more complexity than value.

### Visual style

Diff Trek should look like a focused desktop developer tool rather than a web application.

Good visual references are:

- Zed
- GitHub's diff views
- lightweight native macOS developer utilities

Aim for:

- compact toolbar
- system UI font for application chrome
- monospace font for code
- subtle borders
- restrained use of shadows
- small border radius
- neutral greys
- familiar red/green Git diff colours
- good dark mode
- icon-led controls where labels are obvious
- minimal visual nesting
- high information density without clutter

Avoid overly rounded, card-heavy, dashboard-style UI.

### Styling approach

Prefer CSS Modules.

Keep styling explicit and easy to follow.

A small set of application-wide CSS custom properties should act as the project's lightweight design system.

For example:

```css
:root {
  --bg: #ffffff;
  --surface: #f6f8fa;
  --surface-hover: #eef1f4;

  --text: #1f2328;
  --text-muted: #656d76;

  --border: #d0d7de;

  --diff-add-bg: #dafbe1;
  --diff-add-text: #116329;

  --diff-remove-bg: #ffebe9;
  --diff-remove-text: #82071e;

  --accent: #0969da;

  --radius: 4px;
}
```

These exact values can change.

The important point is to keep the visual system small, explicit and owned by Diff Trek rather than outsourcing it to a large third-party design system.

---

## Diff rendering

The current preferred diff rendering library is:

**react-virtualized-diff**

Repository:

https://github.com/Zhang-JiahangH/react-virtualized-diff

It was preferred over:

- react-diff-viewer-continued
- react-diff-view

The main reason is virtualisation/performance for large diffs.

However, the architecture should avoid depending too heavily on a particular diff component. Diff Trek should own its diff/file model and treat the renderer as a replaceable UI layer.

---

## Code requirements

### TypeScript

Use TypeScript for all frontend application code.

Avoid `any` unless there is a specific and documented reason for using it.

Prefer explicit application/domain types for important concepts such as:

```text
Repository
ChangedFile
DiffFile
DiffHunk
DiffLine
ChangeLocation
RepositoryStatus
```

Types returned by Tauri commands should be represented explicitly in the frontend rather than passed around as untyped objects.

---

### React architecture

Keep React components primarily concerned with rendering and interaction.

Do not bury Git/domain logic inside UI components.

Prefer a structure along these lines:

```text
src/
  components/
  features/
    diff/
    navigation/
    repository/
  hooks/
  lib/
  services/
  types/
```

The exact structure can evolve naturally; do not create folders purely for architectural ceremony.

Prefer extracting logic when it is:

- reused
- independently testable
- complex enough to obscure a component
- part of the domain rather than presentation

Do not over-abstract simple code.

---

### State management

Start with normal React state and hooks.

Use:

```text
useState
useReducer
useMemo
useCallback
custom hooks
```

where appropriate.

Do **not** add Redux, MobX or another large state-management dependency by default.

If the application eventually needs a shared state library, choose a lightweight modern option based on an actual requirement.

The repository diff itself should have a clear logical model rather than deriving application state from DOM state.

---

### Linting and formatting

Use modern linting and formatting tooling.

Recommended:

- ESLint
- Prettier

Configure TypeScript-aware ESLint rules.

Keep the setup reasonably lightweight.

The goal is consistent, readable code rather than enforcing hundreds of stylistic rules.

Formatting should be automatic and deterministic.

---

### Testing

Tests should focus on behaviour that has real value.

Frontend unit/component tests may use:

- Vitest
- React Testing Library

Good testing candidates include:

```text
global next/previous change navigation
flattening files/hunks into navigation order
selection behaviour
lazy loading decisions
diff parsing/transformation
large-diff edge cases
Tauri API wrappers
```

Avoid tests that merely assert implementation details or duplicate what TypeScript already guarantees.

Rust/backend code should have unit tests around non-trivial Git parsing and domain logic where useful.

---

### Dependency philosophy

Keep dependencies deliberately small.

Before adding a library, consider whether the functionality can reasonably be implemented using React, TypeScript, CSS or browser APIs.

Dependencies are appropriate when they solve a meaningful problem well.

Avoid packages that:

- duplicate trivial functionality
- introduce large transitive dependency trees for small features
- lock the architecture into a particular framework unnecessarily
- are effectively abandoned

Prefer actively maintained libraries with modern ESM and TypeScript support.

Do not introduce Next.js, TanStack Router, Redux, Tailwind, shadcn or similar infrastructure unless an actual requirement appears that justifies it.

---

### Frontend/backend boundary

The frontend should communicate with Rust through Tauri commands.

Keep this boundary explicit.

For example:

```text
getRepositoryInfo()

getChangedFiles()

getFileDiff(path)
```

Frontend code should not know how Git commands are executed.

Likewise, Rust code should not contain presentation-specific logic.

Prefer:

```text
React
  ↓
typed frontend service
  ↓
Tauri invoke
  ↓
Rust command
  ↓
Git/filesystem/domain logic
```

rather than calling `invoke()` directly from dozens of React components.

A small TypeScript service/API layer should wrap Tauri calls.

---

### Async code

Use modern `async` / `await`.

Avoid deeply nested promise chains.

Async operations should expose meaningful loading and error state to the UI.

Where appropriate, operations should be cancellable or designed so that stale responses do not overwrite newer state.

This will become particularly important when users rapidly navigate between large files.

---

### Performance

Performance is a first-class requirement.

Avoid:

- rendering every file in the repository simultaneously
- storing redundant copies of very large strings
- unnecessary React re-renders
- parsing the same diff repeatedly
- tying navigation to rendered DOM elements

Prefer:

- lazy loading
- virtualisation
- memoised derived state where valuable
- stable logical IDs
- bounded caching
- incremental processing

Do not prematurely micro-optimise ordinary UI code, but architecture decisions should account for repositories with large diffs.

---

### Error handling

Do not silently swallow errors.

Backend errors should be converted into meaningful application-level errors where possible.

Examples include:

```text
not a Git repository
Git executable unavailable
repository has no changes
file disappeared while loading
binary file
permission denied
invalid diff data
```

User-facing messages should be concise.

Detailed diagnostic information can be logged for debugging.

---

### General code style

Optimise for clarity over cleverness.

Prefer:

```text
small functions
meaningful names
explicit domain types
simple control flow
early returns
composition
```

Avoid:

```text
deep inheritance
premature abstraction
generic utility layers with no concrete purpose
large multipurpose components
clever metaprogramming
```

Comments should explain **why**, not restate obvious code.

---

## How Diff Trek is launched

The intention is for installation to add a Git alias such as:

```bash
git dt
```

The command will launch Diff Trek using the **current working directory** as the repository to inspect.

For the MVP, assume the command is executed from somewhere inside a Git repository.

---

## Git behaviour

The MVP is intended primarily for reviewing **unstaged changes to already tracked files**.

Staged changes should normally be excluded.

Untracked files are explicitly considered a **v2 feature**.

The Git operation discussed as the basis for obtaining the working-tree state is:

```bash
git difftool --dir-diff --no-symlinks
```

Conceptually this produces two directory trees:

- A: the HEAD / repository version
- B: the current working-tree version

Diff Trek can then compare corresponding files.

It is not mandatory that the final implementation literally relies on the temporary directories created by `git difftool`; if direct Git commands produce a cleaner implementation, that is acceptable. Preserve the intended semantics rather than blindly preserving the command.

The important behaviour is:

```text
HEAD
  vs
working tree

excluding staged-only changes
```

---

## Diff data strategy

Do **not** load one gigantic repository-wide diff into the frontend.

The intended architecture is lazy and incremental.

Suggested flow:

```text
1. Discover changed files.
2. Return lightweight metadata for the complete file list.
3. Load the first file's diff.
4. Load additional file diffs as required.
5. Keep a small amount of neighbouring diff data prefetched/cached.
```

For very large files/diffs, the architecture should support chunked or incremental loading rather than requiring the complete file contents to be held/rendered at once.

An earlier idea was to process files in parallel batches, e.g. roughly five concurrent files, and cache generated diff data in a temporary directory. That is still a reasonable implementation technique, but should only be used where it actually improves performance.

Avoid eagerly diffing every large file before Diff Trek becomes usable.

Fast initial display is more important.

---

## Main UI

The UI should be deliberately simple.

The preferred layout is approximately:

```text
┌─────────────────────────────────────────────────────────────┐
│ Repository / branch          ↑ previous change ↓ next change│
├─────────────────────────────────────────────────────────────┤
│ src/foo.ts                                                  │
│ ----------------------------------------------------------- │
│ diff                                                        │
│ diff                                                        │
│ diff                                                        │
│                                                             │
│ src/bar.ts                                                  │
│ ----------------------------------------------------------- │
│ diff                                                        │
│ diff                                                        │
│                                                             │
│ src/utils/baz.ts                                            │
│ ----------------------------------------------------------- │
│ diff                                                        │
│ diff                                                        │
│ diff                                                        │
└─────────────────────────────────────────────────────────────┘
```

All changed files appear in **one long vertically scrolling document**.

This is preferable to opening each file in its own tab or forcing the user to repeatedly select files.

Individual files should have clear headers/separators.

A compact file navigation mechanism may eventually be useful, but it should not dominate the interface.

---

## Most important interaction: global diff navigation

The toolbar should contain controls equivalent to:

```text
Previous Change
Next Change
```

These controls operate across the **entire repository diff**, not merely within the currently visible file.

Example:

```text
foo.ts
  hunk 1
  hunk 2

bar.ts
  hunk 1

baz.ts
  hunk 1
  hunk 2
```

Repeatedly pressing Next Change should navigate:

```text
foo.ts / hunk 1
foo.ts / hunk 2
bar.ts / hunk 1
baz.ts / hunk 1
baz.ts / hunk 2
```

The transition between files should be invisible from the user's perspective: Diff Trek simply scrolls to the next changed block.

This behaviour is one of the primary reasons for building Diff Trek.

Traditional diff tools tend to scope next/previous-change navigation to the currently opened file, which is specifically what this project is trying to avoid.

Keyboard shortcuts should eventually support the same operation.

---

## Scrolling and virtualisation

The user should perceive Diff Trek as a single continuous document even if the implementation uses virtualisation underneath.

Because repositories can contain very large diffs, do not render every line of every file into the DOM simultaneously.

The frontend should therefore maintain a virtualised representation such as:

```text
Repository
  File
    Diff block / hunk
      Lines
```

Global change navigation should operate on the logical diff model, not by trying to inspect whatever DOM nodes happen to exist.

When navigating to a change that has not yet been rendered:

```text
Next Change
    ↓
identify target file/hunk
    ↓
ensure its diff data is loaded
    ↓
ask virtualised list to reveal target
    ↓
scroll/highlight target
```

This distinction is important.

---

## Suggested internal model

A model along these lines would be useful:

```ts
type RepositoryDiff = {
  files: DiffFile[];
};

type DiffFile = {
  id: string;
  path: string;
  oldPath?: string;

  status: 'modified' | 'added' | 'deleted' | 'renamed';

  additions?: number;
  deletions?: number;

  loaded: boolean;
  hunks?: DiffHunk[];
};

type DiffHunk = {
  id: string;

  oldStart: number;
  oldLines: number;

  newStart: number;
  newLines: number;

  lines: DiffLine[];
};

type DiffLine = {
  type: 'context' | 'add' | 'delete';

  oldLineNumber?: number;
  newLineNumber?: number;

  content: string;
};
```

The exact schema can change depending on the selected diff library.

The important part is that every navigable change/hunk should have a stable logical ID.

For example:

```text
src/foo.ts:hunk:0
src/foo.ts:hunk:1
src/bar.ts:hunk:0
```

Diff Trek can then maintain a flattened navigation index:

```ts
type ChangeLocation = {
  fileId: string;
  hunkId: string;
};
```

Example:

```ts
[
  { fileId: 'foo', hunkId: 'foo-0' },
  { fileId: 'foo', hunkId: 'foo-1' },
  { fileId: 'bar', hunkId: 'bar-0' },
  { fileId: 'baz', hunkId: 'baz-0' }
]
```

Global next/previous navigation then becomes straightforward.

---

## Backend responsibilities

The Tauri/Rust side should handle Git and filesystem interaction.

Likely responsibilities:

```text
repository discovery
Git command execution
changed-file discovery
reading HEAD versions
reading working-tree versions
generating/parsing diffs
temporary-file management
large-file safeguards
filesystem watching later if desired
```

Avoid making the React application execute Git commands directly.

Expose a relatively small API to the frontend.

For example:

```text
getRepositoryInfo()

getChangedFiles()

getFileDiff(path)

getFileContents(path, side)

possibly:
getDiffChunk(path, offset...)
```

Exact API design can evolve.

---

## Initial startup behaviour

Diff Trek should become useful quickly.

A good sequence would be:

```text
Launch Diff Trek

↓ approximately immediately

Repository header appears

↓
Changed file list discovered

↓
First file diff appears

↓
Remaining visible/nearby diffs progressively load
```

Do not make the user wait for every changed file to be fully processed before showing the UI.

---

## MVP scope

Include:

- Tauri desktop application
- React + TypeScript frontend
- Vite
- pnpm
- native HTML and CSS Modules for most UI
- Lucide React for icons
- Base UI selectively for complex accessible primitives
- open current Git repository
- inspect unstaged modifications to tracked files
- discover all changed files
- continuous multi-file diff view
- syntax-friendly code diff rendering
- virtualised rendering
- global Previous Change / Next Change
- lazy loading of diffs
- basic loading/error states
- handle modified/deleted/renamed tracked files sensibly

Potentially include added tracked files if they naturally fall out of the Git implementation.

Do not overcomplicate the MVP.

---

## Explicitly out of scope for MVP

Do not spend time initially implementing:

- untracked files
- staging/unstaging
- editing code
- merge conflict resolution
- commit creation
- Git history browsing
- branch management
- remote repository functionality
- GitHub/GitLab integration
- comments/code review
- complex preference screens
- plugin systems

Diff Trek is primarily a **diff viewer**, not a Git GUI.

---

## Design philosophy

Prefer simple UI and architecture.

Avoid the classic desktop diff-tool approach of:

```text
directory tree
→ open file
→ inspect file
→ close/select another file
→ inspect next file
```

Instead think:

```text
git diff

but extremely readable,
very fast,
and with excellent keyboard/navigation support.
```

The user should be able to sit down with a repository containing many changed files and review the entire change set almost as though it were one document.

---

## Reference behaviour

Useful mental references are:

- GitHub/GitLab pull-request diff pages
- `git diff`
- diff2html

`diff2html` was considered especially close to the desired output because it naturally renders multiple files sequentially in one document.

However, it is not a React component and is not necessarily the intended rendering dependency.

The UI concept is more important than reproducing any particular library.

---

## Key architectural constraint

Do not conflate these three concepts:

```text
files currently rendered
files whose diff data is loaded
files present in the repository diff
```

They are deliberately separate.

For example, a repository may contain:

```text
300 changed files
80 loaded diffs
6 currently represented in the virtualised viewport
```

Global next/previous change navigation must still behave as though the entire repository is one logical diff.

---

## Priorities

When making implementation decisions, optimise in roughly this order:

1. Correct Git semantics
2. Smooth global change navigation
3. Fast startup
4. Performance on large diffs
5. Simple UI
6. Maintainable architecture
7. Additional Git features

Avoid adding functionality simply because typical Git GUI applications contain it.

The narrowness of **Diff Trek** is intentional.

## AI change log

When you have finished a piece of work, record why you made each change.

1. Run `git dt --createchangelog="claude"` (use your own name if you are a
   different agent). It prints the path of a changelog file, and instructions.
   If you can't run git dt because you are in a sandboxed environment, curl -fsSL https://citricity.github.io/difftrek/difftrek-changelog.sh -o difftrek-changelog.sh
   and then run difftrek-changelog.sh directly.
2. That file is the diff with a placeholder after every hunk. Fill each one in
   with **why** that hunk exists — not what it does, the diff already shows that.
3. Where several hunks serve one intent, wrap them in a LOGICAL_CHANGE span and
   describe it in the LOGICAL_CHANGE_TABLE block.
4. Edit only inside the tag blocks. Never retype or reformat the diff itself:
   one altered space unmatches a hunk and loses its note.
