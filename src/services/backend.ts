/**
 * The whole frontend/backend boundary.
 *
 * Nothing else in the app calls `invoke`. React components talk to hooks,
 * hooks talk to this module, and only this module knows that Git lives on the
 * other side of a Tauri command.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AppError } from '../types/index.ts';
import type {
  ChangedFile,
  FileDiff,
  FileSide,
  LaunchOptions,
  RepositoryInfo,
  Settings,
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

/**
 * How the backend was launched, read once.
 *
 * `difftrail --example` serves the built-in sample diff instead of a
 * repository — useful for a demo, a screenshot, or working on the UI without
 * arranging a working tree full of changes. Answering it here rather than in
 * Rust means there is one sample to maintain, the one `pnpm dev` already uses,
 * and that the Git commands are never called at all: example mode opens
 * anywhere, repository or not.
 *
 * The answer cannot change while the process runs, so the first call's promise
 * is what every later call awaits. A backend too old to know the command falls
 * back to normal operation rather than passing sample data off as real.
 */
let launchOptions: Promise<LaunchOptions> | null = null;

function getLaunchOptions(): Promise<LaunchOptions> {
  launchOptions ??= invoke<LaunchOptions>('get_launch_options').catch(
    (thrown: unknown) => {
      console.error('[difftrail] get_launch_options failed', thrown);
      return { example: false };
    },
  );

  return launchOptions;
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri() || (await getLaunchOptions()).example) {
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

/**
 * Subscribes to the shell's Settings menu item.
 *
 * The menu belongs to the desktop shell and the dialog belongs to the webview,
 * so the two meet here rather than either knowing about the other. Resolves
 * with the unsubscribe; outside Tauri there is no menu and nothing to unhook.
 */
export async function onSettingsRequested(
  handler: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;

  return listen('settings-requested', () => {
    handler();
  });
}

/**
 * One side of a changed image, as bytes.
 *
 * The backend sends a raw binary body, which arrives as an `ArrayBuffer`. A
 * transport that falls back to JSON delivers the same bytes as an array of
 * numbers, so both are accepted.
 */
export async function getImageBytes(
  path: string,
  side: FileSide,
): Promise<Uint8Array> {
  const body = await call<ArrayBuffer | number[]>('get_image_bytes', { path, side });
  return body instanceof ArrayBuffer ? new Uint8Array(body) : Uint8Array.from(body);
}

export function getSettings(): Promise<Settings> {
  return call<Settings>('get_settings');
}

/** Stores preferences and resolves with what was actually stored. */
export function setSettings(settings: Settings): Promise<Settings> {
  return call<Settings>('set_settings', { settings });
}
