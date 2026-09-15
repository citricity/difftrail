/** Small presentation helpers shared by the header and file rows. */

import type { ChangedFile, FileStatus } from '../types/index.ts';

const STATUS_LABEL: Record<FileStatus, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  typechanged: 'Type changed',
};

const STATUS_LETTER: Record<FileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechanged: 'T',
};

export function statusLabel(status: FileStatus): string {
  return STATUS_LABEL[status];
}

export function statusLetter(status: FileStatus): string {
  return STATUS_LETTER[status];
}

/** Splits a path so the filename can be emphasised against its directory. */
export function splitPath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf('/');
  return index === -1
    ? { directory: '', name: path }
    : { directory: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/** `old/name.ts → new/name.ts` for renames, plain path otherwise. */
export function displayPath(file: ChangedFile): string {
  return file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`;
}

export function pluralise(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}
