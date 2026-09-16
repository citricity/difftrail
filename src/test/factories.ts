/** Builders for test fixtures, so tests state only what they care about. */

import type {
  ChangedFile,
  DiffHunk,
  DiffLine,
  DocumentFile,
  FileDiff,
  LineKind,
} from '../types/index.ts';

export function makeLine(
  kind: LineKind,
  content = 'x',
  numbers: { old?: number; new?: number } = {},
): DiffLine {
  return {
    kind,
    content,
    oldLineNumber: numbers.old ?? null,
    newLineNumber: numbers.new ?? null,
    noNewline: false,
  };
}

export function makeHunk(
  path: string,
  index: number,
  lines: DiffLine[] = [makeLine('delete'), makeLine('add')],
): DiffHunk {
  return {
    id: `${path}:hunk:${index}`,
    oldStart: index * 10 + 1,
    oldLines: lines.filter((line) => line.kind !== 'add').length,
    newStart: index * 10 + 1,
    newLines: lines.filter((line) => line.kind !== 'delete').length,
    heading: null,
    lines,
  };
}

export function makeMeta(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    id: path,
    path,
    oldPath: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    ...overrides,
  };
}

export function makeDiff(
  path: string,
  hunkCount: number,
  overrides: Partial<FileDiff> = {},
): FileDiff {
  const hunks = Array.from({ length: hunkCount }, (_, index) => makeHunk(path, index));

  return {
    id: path,
    path,
    oldPath: null,
    status: 'modified',
    binary: false,
    truncated: false,
    additions: hunkCount,
    deletions: hunkCount,
    maxLineLength: 20,
    hunks,
    ...overrides,
  };
}

/** A file whose diff has arrived, with `hunkCount` hunks. */
export function loadedFile(path: string, hunkCount: number): DocumentFile {
  return {
    meta: makeMeta(path),
    status: 'loaded',
    diff: makeDiff(path, hunkCount),
    error: null,
    collapsed: false,
    text: null,
    revealed: [],
  };
}

/** A file that is in the diff but whose body has not been read yet. */
export function pendingFile(path: string): DocumentFile {
  return {
    meta: makeMeta(path),
    status: 'idle',
    diff: null,
    error: null,
    collapsed: false,
    text: null,
    revealed: [],
  };
}
