/**
 * The document reducer.
 *
 * Kept out of the hook so the state transitions can be tested directly, and so
 * that "what the document is" stays separate from "how it gets loaded".
 */

import type { AppError, ChangedFile, DocumentFile, FileDiff, RepositoryInfo } from '../types/index.ts';

export type Phase = 'starting' | 'ready' | 'failed';

export interface DocumentState {
  phase: Phase;
  repository: RepositoryInfo | null;
  files: DocumentFile[];
  /** Fatal startup error. Per-file failures live on the file. */
  error: AppError | null;
}

export const initialState: DocumentState = {
  phase: 'starting',
  repository: null,
  files: [],
  error: null,
};

export type DocumentAction =
  | { type: 'repositoryLoaded'; repository: RepositoryInfo }
  | { type: 'filesLoaded'; files: ChangedFile[] }
  | { type: 'fileLoadStarted'; fileId: string }
  | { type: 'fileLoaded'; fileId: string; diff: FileDiff }
  | { type: 'fileFailed'; fileId: string; message: string }
  | { type: 'fileCollapseToggled'; fileId: string }
  | { type: 'startupFailed'; error: AppError };

function updateFile(
  files: DocumentFile[],
  fileId: string,
  update: (file: DocumentFile) => DocumentFile,
): DocumentFile[] {
  let changed = false;

  const next = files.map((file) => {
    if (file.meta.id !== fileId) return file;
    changed = true;
    return update(file);
  });

  // Returning the original array when nothing matched keeps memoised
  // consumers (the row model, the navigation index) from rebuilding.
  return changed ? next : files;
}

export function documentReducer(
  state: DocumentState,
  action: DocumentAction,
): DocumentState {
  switch (action.type) {
    case 'repositoryLoaded':
      return { ...state, repository: action.repository };

    case 'filesLoaded':
      return {
        ...state,
        phase: 'ready',
        files: action.files.map((meta) => ({
          meta,
          status: 'idle',
          diff: null,
          error: null,
          collapsed: false,
        })),
      };

    case 'fileLoadStarted':
      return {
        ...state,
        files: updateFile(state.files, action.fileId, (file) =>
          file.status === 'loading'
            ? file
            : { ...file, status: 'loading', error: null },
        ),
      };

    case 'fileLoaded':
      return {
        ...state,
        files: updateFile(state.files, action.fileId, (file) => ({
          ...file,
          status: 'loaded',
          diff: action.diff,
          error: null,
        })),
      };

    case 'fileFailed':
      return {
        ...state,
        files: updateFile(state.files, action.fileId, (file) => ({
          ...file,
          status: 'error',
          error: action.message,
        })),
      };

    case 'fileCollapseToggled':
      return {
        ...state,
        files: updateFile(state.files, action.fileId, (file) => ({
          ...file,
          collapsed: !file.collapsed,
        })),
      };

    case 'startupFailed':
      return { ...state, phase: 'failed', error: action.error };
  }
}

/** Totals for the repository header. */
export function summarise(files: DocumentFile[]): {
  files: number;
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;

  for (const file of files) {
    additions += file.meta.additions ?? 0;
    deletions += file.meta.deletions ?? 0;
  }

  return { files: files.length, additions, deletions };
}
