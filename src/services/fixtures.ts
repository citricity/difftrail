/**
 * Sample data for running the UI in a plain browser (`pnpm dev`).
 *
 * This exists so the interface can be worked on without launching the desktop
 * shell. It is never reached inside Tauri — see `isTauri` in `backend.ts`.
 */

import { AppError } from '../types/index.ts';
import type {
  ChangedFile,
  DiffHunk,
  DiffLine,
  FileDiff,
  RepositoryInfo,
} from '../types/index.ts';

/** Simulated backend latency, so loading states are visible in development. */
const LATENCY_MS = 120;

function line(
  kind: DiffLine['kind'],
  content: string,
  oldLineNumber: number | null,
  newLineNumber: number | null,
): DiffLine {
  return { kind, content, oldLineNumber, newLineNumber, noNewline: false };
}

function hunk(
  path: string,
  index: number,
  start: number,
  heading: string | null,
  lines: DiffLine[],
): DiffHunk {
  return {
    id: `${path}:hunk:${index}`,
    oldStart: start,
    oldLines: lines.filter((entry) => entry.kind !== 'add').length,
    newStart: start,
    newLines: lines.filter((entry) => entry.kind !== 'delete').length,
    heading,
    lines,
  };
}

const FILES: ChangedFile[] = [
  {
    id: 'src/features/diff/DiffDocument.tsx',
    path: 'src/features/diff/DiffDocument.tsx',
    oldPath: null,
    status: 'modified',
    additions: 4,
    deletions: 2,
    binary: false,
  },
  {
    id: 'src/lib/navigation.ts',
    path: 'src/lib/navigation.ts',
    oldPath: null,
    status: 'modified',
    additions: 3,
    deletions: 1,
    binary: false,
  },
  {
    id: 'src/styles/tokens.css',
    path: 'src/styles/tokens.css',
    oldPath: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
  },
  {
    id: 'assets/icon.png',
    path: 'assets/icon.png',
    oldPath: null,
    status: 'modified',
    additions: null,
    deletions: null,
    binary: true,
  },
  {
    id: 'src/legacy/removed.ts',
    path: 'src/legacy/removed.ts',
    oldPath: null,
    status: 'deleted',
    additions: 0,
    deletions: 3,
    binary: false,
  },
];

const DIFFS: Record<string, FileDiff> = {
  'src/features/diff/DiffDocument.tsx': {
    id: 'src/features/diff/DiffDocument.tsx',
    path: 'src/features/diff/DiffDocument.tsx',
    oldPath: null,
    status: 'modified',
    binary: false,
    truncated: false,
    additions: 4,
    deletions: 2,
    maxLineLength: 72,
    hunks: [
      hunk('src/features/diff/DiffDocument.tsx', 0, 18, 'function DiffDocument()', [
        line('context', '  const [scrollTop, setScrollTop] = useState(0);', 18, 18),
        line('context', '', 19, 19),
        line('delete', '  const rows = buildRowModel(files);', 20, null),
        line('add', '  const rows = useMemo(() => buildRowModel(files, metrics), [files, metrics]);', null, 20),
        line('context', '', 21, 21),
        line('context', '  return (', 22, 22),
      ]),
      hunk('src/features/diff/DiffDocument.tsx', 1, 64, 'function DiffDocument()', [
        line('context', '      {visible.map((row) => (', 64, 64),
        line('delete', '        <DiffRow key={row.id} row={row} />', 65, null),
        line('add', '        <DiffRow key={row.id} row={row} active={row.hunkId === activeHunk} />', null, 65),
        line('add', '        // highlight follows the global navigation cursor', null, 66),
        line('add', '', null, 67),
        line('context', '      ))}', 66, 68),
      ]),
    ],
  },
  'src/lib/navigation.ts': {
    id: 'src/lib/navigation.ts',
    path: 'src/lib/navigation.ts',
    oldPath: null,
    status: 'modified',
    binary: false,
    truncated: false,
    additions: 3,
    deletions: 1,
    maxLineLength: 64,
    hunks: [
      hunk('src/lib/navigation.ts', 0, 31, 'buildNavigationIndex()', [
        line('context', 'export function buildNavigationIndex(files) {', 31, 31),
        line('delete', '  return files.flatMap((file) => file.hunks);', 32, null),
        line('add', '  return files.flatMap((file) =>', null, 32),
        line('add', '    file.loaded ? file.hunks : [{ kind: "file", id: file.id }],', null, 33),
        line('add', '  );', null, 34),
        line('context', '}', 33, 35),
      ]),
    ],
  },
  'src/styles/tokens.css': {
    id: 'src/styles/tokens.css',
    path: 'src/styles/tokens.css',
    oldPath: null,
    status: 'modified',
    binary: false,
    truncated: false,
    additions: 1,
    deletions: 1,
    maxLineLength: 34,
    hunks: [
      hunk('src/styles/tokens.css', 0, 8, ':root', [
        line('context', '  --border: #d0d7de;', 8, 8),
        line('delete', '  --accent: #0969da;', 9, null),
        line('add', '  --accent: #1f6feb;', null, 9),
        line('context', '  --radius: 4px;', 10, 10),
      ]),
    ],
  },
  'assets/icon.png': {
    id: 'assets/icon.png',
    path: 'assets/icon.png',
    oldPath: null,
    status: 'modified',
    binary: true,
    truncated: false,
    additions: 0,
    deletions: 0,
    maxLineLength: 0,
    hunks: [],
  },
  'src/legacy/removed.ts': {
    id: 'src/legacy/removed.ts',
    path: 'src/legacy/removed.ts',
    oldPath: null,
    status: 'deleted',
    binary: false,
    truncated: false,
    additions: 0,
    deletions: 3,
    maxLineLength: 38,
    hunks: [
      hunk('src/legacy/removed.ts', 0, 1, null, [
        line('delete', 'export const legacy = true;', 1, null),
        line('delete', '', 2, null),
        line('delete', 'export default legacy;', 3, null),
      ]),
    ],
  },
};

const REPOSITORY: RepositoryInfo = {
  root: '/Users/you/Development/difftrail',
  name: 'difftrail',
  branch: 'main',
  head: 'a1b2c3d',
  detached: false,
};

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

async function resolveFixture(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  switch (command) {
    case 'get_repository_info':
      return delay(REPOSITORY);

    case 'get_changed_files':
      return delay(FILES);

    case 'get_file_diff': {
      const path = typeof args?.path === 'string' ? args.path : '';
      const diff = DIFFS[path];
      if (diff === undefined) {
        throw new AppError({
          kind: 'fileNotFound',
          message: `${path} is no longer part of the working tree diff.`,
          detail: null,
        });
      }
      return delay(diff);
    }

    case 'get_file_contents':
      return delay('');

    default:
      throw new AppError({
        kind: 'gitCommandFailed',
        message: `No fixture for ${command}.`,
        detail: null,
      });
  }
}

export async function fixtureCall<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  // The fixtures stand in for a backend whose real responses are only checked
  // at the boundary anyway, so one cast here keeps the callers honest.
  return (await resolveFixture(command, args)) as T;
}
