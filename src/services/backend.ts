/**
 * The whole frontend/backend boundary.
 *
 * Nothing else in the app calls `invoke`. React components talk to hooks,
 * hooks talk to this module, and only this module knows that Git lives on the
 * other side of a Tauri command.
 */

import { invoke } from '@tauri-apps/api/core';
import { AppError } from '../types/index.ts';
import type {
  ChangedFile,
  FileDiff,
  FileSide,
  RepositoryInfo,
} from '../types/index.ts';
import { fixtureCall } from './fixtures.ts';

/**
 * True when running inside the Tauri shell.
 *
 * `pnpm dev` in a plain browser is a useful way to work on the UI, so outside
 * Tauri the service serves fixtures instead of failing.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    return fixtureCall<T>(command, args);
  }

  try {
    return await invoke<T>(command, args);
  } catch (thrown) {
    const error = AppError.from(thrown);
    // Keep the full diagnostic out of the UI but available in the console.
    console.error(`[difftrail] ${command} failed`, error.detail ?? error.message);
    throw error;
  }
}

export function getRepositoryInfo(): Promise<RepositoryInfo> {
  return call<RepositoryInfo>('get_repository_info');
}

export function getChangedFiles(): Promise<ChangedFile[]> {
  return call<ChangedFile[]>('get_changed_files');
}

/**
 * Loads one file's diff.
 *
 * `maxBytes` re-requests a diff that came back `truncated`, without raising
 * the budget for every other file.
 */
export function getFileDiff(
  path: string,
  maxBytes?: number,
): Promise<FileDiff> {
  return call<FileDiff>('get_file_diff', { path, maxBytes });
}

export function getFileContents(
  path: string,
  side: FileSide,
): Promise<string> {
  return call<string>('get_file_contents', { path, side });
}
