import { describe, expect, it } from 'vitest';
import { documentReducer, initialState, summarise } from './documentState.ts';
import type { DocumentState } from './documentState.ts';
import { makeDiff, makeMeta } from '../test/factories.ts';
import { AppError } from '../types/index.ts';

function withFiles(paths: string[]): DocumentState {
  return documentReducer(initialState, {
    type: 'filesLoaded',
    files: paths.map((path) => makeMeta(path)),
  });
}

describe('documentReducer', () => {
  it('becomes ready once the file list arrives, with every file unloaded', () => {
    const state = withFiles(['a.ts', 'b.ts']);

    expect(state.phase).toBe('ready');
    expect(state.files.map((file) => file.status)).toEqual(['idle', 'idle']);
    expect(state.files.map((file) => file.meta.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('is ready even when the repository has no changes', () => {
    const state = documentReducer(initialState, { type: 'filesLoaded', files: [] });

    expect(state.phase).toBe('ready');
    expect(state.files).toEqual([]);
  });

  it('attaches a diff to the file it belongs to and leaves the others alone', () => {
    const before = withFiles(['a.ts', 'b.ts']);
    const after = documentReducer(before, {
      type: 'fileLoaded',
      fileId: 'a.ts',
      diff: makeDiff('a.ts', 2),
      text: null,
    });

    expect(after.files[0].status).toBe('loaded');
    expect(after.files[0].diff?.hunks).toHaveLength(2);
    expect(after.files[1]).toBe(before.files[1]);
  });

  it('records a per-file failure without failing the whole document', () => {
    const state = documentReducer(withFiles(['a.ts']), {
      type: 'fileFailed',
      fileId: 'a.ts',
      message: 'permission denied',
    });

    expect(state.phase).toBe('ready');
    expect(state.files[0].status).toBe('error');
    expect(state.files[0].error).toBe('permission denied');
  });

  it('clears a previous error when the file is retried', () => {
    const failed = documentReducer(withFiles(['a.ts']), {
      type: 'fileFailed',
      fileId: 'a.ts',
      message: 'boom',
    });
    const retrying = documentReducer(failed, { type: 'fileLoadStarted', fileId: 'a.ts' });

    expect(retrying.files[0].status).toBe('loading');
    expect(retrying.files[0].error).toBeNull();
  });

  it('returns the same array when an action names a file that is gone', () => {
    // Identity matters: the row model and navigation index are memoised on it.
    const state = withFiles(['a.ts']);
    const after = documentReducer(state, {
      type: 'fileLoaded',
      fileId: 'ghost.ts',
      diff: makeDiff('ghost.ts', 1),
      text: null,
    });

    expect(after.files).toBe(state.files);
  });

  it('toggles collapse back and forth', () => {
    const state = withFiles(['a.ts']);
    const collapsed = documentReducer(state, {
      type: 'fileCollapseToggled',
      fileId: 'a.ts',
    });
    const expanded = documentReducer(collapsed, {
      type: 'fileCollapseToggled',
      fileId: 'a.ts',
    });

    expect(collapsed.files[0].collapsed).toBe(true);
    expect(expanded.files[0].collapsed).toBe(false);
  });

  it('records a fatal startup error', () => {
    const error = new AppError({
      kind: 'notARepository',
      message: 'nope',
      detail: null,
    });
    const state = documentReducer(initialState, { type: 'startupFailed', error });

    expect(state.phase).toBe('failed');
    expect(state.error).toBe(error);
  });
});

describe('summarise', () => {
  it('totals the counts across every file', () => {
    const state = documentReducer(initialState, {
      type: 'filesLoaded',
      files: [
        makeMeta('a.ts', { additions: 3, deletions: 1 }),
        makeMeta('b.ts', { additions: 10, deletions: 0 }),
      ],
    });

    expect(summarise(state.files)).toEqual({ files: 2, additions: 13, deletions: 1 });
  });

  it('counts a binary file without inventing line counts for it', () => {
    const state = documentReducer(initialState, {
      type: 'filesLoaded',
      files: [
        makeMeta('a.ts', { additions: 2, deletions: 2 }),
        makeMeta('logo.png', { additions: null, deletions: null, binary: true }),
      ],
    });

    expect(summarise(state.files)).toEqual({ files: 2, additions: 2, deletions: 2 });
  });
});
