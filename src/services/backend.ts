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
  AiChangelog,
  ChangedFile,
  FileDiff,
  FileSide,
  GitAliasStatus,
  LaunchOptions,
  RepositoryInfo,
  Settings,
  ZoomDirection,
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
 * `difftrek --example` serves the built-in sample diff instead of a
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
      console.error('[difftrek] get_launch_options failed', thrown);
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
    console.error(`[difftrek] ${command} failed`, error.detail ?? error.message);
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
 * Subscribes to one of the shell's menu items.
 *
 * The menu belongs to the desktop shell and the dialogs belong to the webview,
 * so the two meet here rather than either knowing about the other. Resolves
 * with the unsubscribe; outside Tauri there is no menu and nothing to unhook.
 */
async function onMenuEvent(event: string, handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;

  return listen(event, () => {
    handler();
  });
}

/** Diff Trek > Settings… */
export function onSettingsRequested(handler: () => void): Promise<() => void> {
  return onMenuEvent('settings-requested', handler);
}

/** Diff Trek > Install 'git dt' Command… */
export function onGitAliasRequested(handler: () => void): Promise<() => void> {
  return onMenuEvent('git-alias-requested', handler);
}

/**
 * Whether a zoom level will reach a window to scale.
 *
 * False in a plain browser, where there is no shell to scale anything and the
 * browser's own zoom is right there, and under `--example`, where the fixtures
 * answer the settings write and it never reaches the backend. In both, the
 * keys are better left unhandled than swallowed to no effect.
 */
export async function canZoomWindow(): Promise<boolean> {
  return isTauri() && !(await getLaunchOptions()).example;
}

/**
 * View > Zoom In / Zoom Out / Actual Size.
 *
 * Carries a payload, unlike the two above: the menu says which way to move,
 * and the levels themselves are this side's business.
 */
export function onZoomRequested(
  handler: (direction: ZoomDirection) => void,
): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => undefined);

  return listen<ZoomDirection>('zoom-requested', (event) => {
    handler(event.payload);
  });
}

/**
 * Calls a command that acts on the user's machine rather than on a repository.
 *
 * Unlike `call`, example mode does not reroute it: `--example` swaps the
 * repository for a sample, but the executable running and the user's Git
 * configuration are real either way. Only outside Tauri, where there is no
 * machine to act on, does the sample answer.
 */
async function callNative<T>(command: string): Promise<T> {
  if (!isTauri()) return fixtureCall<T>(command);

  try {
    return await invoke<T>(command);
  } catch (thrown) {
    const error = AppError.from(thrown);
    console.error(`[difftrek] ${command} failed`, error.detail ?? error.message);
    throw error;
  }
}

/**
 * The AI changelog describing what is on screen, or `null` when there is none.
 *
 * Null is the ordinary case, not an error: most diffs have no changelog. One
 * that only partly matches is still returned — a developer editing the code
 * after the notes were written is normal — with a summary of how much of it
 * still applies.
 */
export function getAiChangelog(): Promise<AiChangelog | null> {
  return call<AiChangelog | null>('get_ai_changelog');
}

/** What installing `git dt` would do, without doing it. */
export function getGitAliasStatus(): Promise<GitAliasStatus> {
  return callNative<GitAliasStatus>('get_git_alias_status');
}

/** Installs `git dt` in the global Git configuration. */
export function installGitAlias(): Promise<GitAliasStatus> {
  return callNative<GitAliasStatus>('install_git_alias');
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
