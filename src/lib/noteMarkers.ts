/**
 * Where a logical change starts and stops in the document.
 *
 * The backend says which logical changes cover each hunk; it does not say
 * where a span begins, and it should not — spans are re-openable, so one
 * change can cover hunks 1 and 3 but not 2, and what counts as "the start" is a
 * question about the document on screen. A file that has not loaded has no
 * hunks here, so its markers appear when it does.
 */

import type { Direction, NavigationFilter } from './navigation.ts';
import type { ChangeLocation, ResolvedHunk } from '../types/index.ts';

export interface HunkMarkers {
  /** Logical changes whose run of hunks begins at this one. */
  starts: string[];
  /** Logical changes whose run of hunks ends at this one. */
  ends: string[];
  /** Covered, but neither the first hunk of the run nor the last. */
  inside: string[];
}

const NONE: HunkMarkers = { starts: [], ends: [], inside: [] };

export function noMarkers(): HunkMarkers {
  return NONE;
}

/**
 * Marks the ends of each logical change's runs, in document order.
 *
 * `order` is every hunk the document currently holds, in the order it shows
 * them; `hunks` is the resolved notes, keyed by hunk id.
 */
export function buildNoteMarkers(
  order: readonly string[],
  hunks: Readonly<Record<string, ResolvedHunk>>,
): Map<string, HunkMarkers> {
  const markers = new Map<string, HunkMarkers>();

  const covers = (index: number, change: string): boolean => {
    const id = order[index];
    if (id === undefined) return false;
    return hunks[id]?.logicalChangeIds.includes(change) ?? false;
  };

  order.forEach((id, index) => {
    const changes = hunks[id]?.logicalChangeIds ?? [];
    if (changes.length === 0) return;

    const starts: string[] = [];
    const ends: string[] = [];
    const inside: string[] = [];

    for (const change of changes) {
      const first = !covers(index - 1, change);
      const last = !covers(index + 1, change);

      if (first) starts.push(change);
      if (last) ends.push(change);
      if (!first && !last) inside.push(change);
    }

    markers.set(id, { starts, ends, inside });
  });

  return markers;
}

/**
 * The hunks one logical change covers, in document order.
 *
 * What the change's own dialog lists, what its arrows walk, and what focusing
 * it steps through — one list, so the three cannot disagree.
 */
export function hunksOfChange(
  order: readonly string[],
  hunks: Readonly<Record<string, ResolvedHunk>>,
  change: string,
): string[] {
  return order.filter((id) => hunks[id]?.logicalChangeIds.includes(change));
}

/**
 * The file a hunk id belongs to.
 *
 * Hunk ids are `<path>:hunk:<index>`, which `CLAUDE.md` names as the model's
 * stable logical id and the Rust parser builds. Splitting on the last `:hunk:`
 * rather than the first is what keeps a path containing `:hunk:` — unlikely,
 * but free to handle — from losing its tail.
 */
export function fileOfHunk(hunkId: string): string {
  const marker = hunkId.lastIndexOf(':hunk:');
  return marker === -1 ? hunkId : hunkId.slice(0, marker);
}

/**
 * Narrows Previous/Next to one logical change.
 *
 * Built from the changelog rather than from the document, so a file whose diff
 * has not loaded yet is still a stop when the change reaches into it — the
 * hunk ids say which file each one belongs to before the file itself arrives.
 */
export function focusFilter(
  hunks: Readonly<Record<string, ResolvedHunk>>,
  change: string,
): NavigationFilter {
  const focused = new Set(
    Object.entries(hunks)
      .filter(([, hunk]) => hunk.logicalChangeIds.includes(change))
      .map(([hunkId]) => hunkId),
  );

  const files = new Set([...focused].map(fileOfHunk));

  return {
    hunk: (hunkId) => focused.has(hunkId),
    file: (fileId) => files.has(fileId),
  };
}

/**
 * Every hunk the changelog knows, in the order the document shows them.
 *
 * Built from the file list rather than from the diffs, so a file whose diff
 * has not been read yet still contributes its hunks: the counter and the
 * contents list would otherwise grow under the reader as files load, and a
 * total that moves while you are reading it is worse than no total.
 */
export function documentOrder(
  fileOrder: readonly string[],
  hunks: Readonly<Record<string, ResolvedHunk>>,
): string[] {
  const at = new Map(fileOrder.map((fileId, index) => [fileId, index]));
  const position = (hunkId: string): number =>
    Number(hunkId.slice(hunkId.lastIndexOf(':') + 1));

  return Object.keys(hunks)
    .filter((hunkId) => at.has(fileOfHunk(hunkId)))
    .sort((left, right) => {
      const file =
        (at.get(fileOfHunk(left)) ?? 0) - (at.get(fileOfHunk(right)) ?? 0);
      return file !== 0 ? file : position(left) - position(right);
    });
}

/**
 * One logical change, as the document sees it.
 *
 * `hunkId` is the first hunk the change covers here, which is where stepping
 * to it lands and where its badge is drawn filled.
 */
export interface ChangeEntry {
  id: string;
  hunkId: string;
}

/**
 * Every logical change with a hunk on screen, in first-appearance order.
 *
 * First appearance rather than the order of the changelog's table, because the
 * bar and the contents list are about reading the diff top to bottom, and a
 * table written in any other order would send the reader backwards.
 */
export function changesInOrder(
  order: readonly string[],
  hunks: Readonly<Record<string, ResolvedHunk>>,
): ChangeEntry[] {
  const first = new Map<string, string>();

  for (const hunkId of order) {
    for (const change of hunks[hunkId]?.logicalChangeIds ?? []) {
      if (!first.has(change)) first.set(change, hunkId);
    }
  }

  return [...first].map(([id, hunkId]) => ({ id, hunkId }));
}

/**
 * The logical change a hunk reads as belonging to.
 *
 * A hunk may serve more than one intent; the first is the one the bar names,
 * and the rest are a click away in the hunk's own dialog.
 */
export function changeOfHunk(
  hunks: Readonly<Record<string, ResolvedHunk>>,
  hunkId: string | null,
): string | null {
  if (hunkId === null) return null;
  return hunks[hunkId]?.logicalChangeIds[0] ?? null;
}

/**
 * The change to step to, or null at the ends.
 *
 * Stepping moves change by change rather than span by span: a change that
 * re-opens later is one entry, so the arrows, the counter and the contents
 * list all tell the same story. Its later hunks are reached by stepping hunks,
 * or by focusing it.
 *
 * From a hunk no change covers — an older changelog, where coverage was not
 * required — there is no current change to move from, so the nearest one in
 * the direction of travel is the answer rather than nothing at all.
 *
 * `currentChange` is passed in rather than read back off the hunk, because a
 * hunk can serve two intents and the hunk alone cannot say which of them the
 * reader is on. Deriving it here would strand the second: stepping from the
 * first would land on the same hunk, the hunk would name the first again, and
 * the arrows would never reach the other.
 */
export function stepChange(
  changes: readonly ChangeEntry[],
  order: readonly string[],
  fileOrder: readonly string[],
  cursor: ChangeLocation | null,
  currentChange: string | null,
  direction: Direction,
): ChangeEntry | null {
  if (changes.length === 0) return null;

  // Nowhere yet: Next enters at the top of the document and Previous at the
  // bottom, which is what the hunk arrows do from the same state.
  if (cursor === null) {
    return (direction === 'next' ? changes[0] : changes[changes.length - 1]) ?? null;
  }

  const at =
    currentChange === null
      ? -1
      : changes.findIndex((entry) => entry.id === currentChange);

  if (at !== -1) {
    return changes[direction === 'next' ? at + 1 : at - 1] ?? null;
  }

  const position = cursorPosition(order, fileOrder, cursor);
  const positionOf = (entry: ChangeEntry) => order.indexOf(entry.hunkId);

  return direction === 'next'
    ? (changes.find((entry) => positionOf(entry) > position) ?? null)
    : ([...changes].reverse().find((entry) => positionOf(entry) < position) ?? null);
}

/** The hunk's place within its file, from `<path>:hunk:<index>`. */
function hunkIndex(hunkId: string): number {
  return Number(hunkId.slice(hunkId.lastIndexOf(':') + 1));
}

/**
 * Where the reader sits in the noted hunks, even when they are not on one.
 *
 * A cursor on a file header has no hunk, and a cursor on a hunk the changelog
 * never saw is not in `order` at all; treating either as "nowhere" would send
 * Next back to the top of the document from halfway down it. Both are placed
 * by file and hunk index instead, and land on a half — between the noted hunk
 * before them and the one after — so that Next finds the change ahead and
 * Previous the one behind, without either claiming the cursor's own place.
 */
function cursorPosition(
  order: readonly string[],
  fileOrder: readonly string[],
  cursor: ChangeLocation,
): number {
  if (cursor.hunkId !== null) {
    const at = order.indexOf(cursor.hunkId);
    if (at !== -1) return at;
  }

  const fileAt = new Map(fileOrder.map((fileId, index) => [fileId, index]));
  const cursorFile = fileAt.get(cursor.fileId) ?? fileOrder.length;
  // A file header sits before every hunk in its file.
  const cursorHunk = cursor.hunkId === null ? -1 : hunkIndex(cursor.hunkId);

  const before = order.filter((hunkId) => {
    const file = fileAt.get(fileOfHunk(hunkId)) ?? fileOrder.length;
    if (file !== cursorFile) return file < cursorFile;
    return hunkIndex(hunkId) < cursorHunk;
  }).length;

  return before - 0.5;
}

/**
 * Hunks the changelog knows about but places in no logical change.
 *
 * Under the current authoring rules there should be none; an older changelog,
 * written before coverage was asked for, will have some, and the contents list
 * says so rather than leaving the reader to wonder what is missing.
 */
export function ungroupedHunks(
  order: readonly string[],
  hunks: Readonly<Record<string, ResolvedHunk>>,
): number {
  return order.filter((id) => hunks[id]?.logicalChangeIds.length === 0).length;
}

/**
 * Labels for every logical change, in the order the reader meets them.
 *
 * First appearance rather than the changelog's table, because the labels are
 * read down the gutter and along the bar: a table written in another order
 * would open the document on B. Changes the table declares but the document
 * never shows are labelled after the rest, so they still have a name in a
 * dialog without taking a letter from a change that is on screen.
 */
export function labelChanges(
  changes: readonly ChangeEntry[],
  tableIds: readonly string[],
): Map<string, string> {
  const seen = changes.map((entry) => entry.id);
  const rest = tableIds.filter((id) => !seen.includes(id));

  return new Map([...seen, ...rest].map((id, index) => [id, changeLabel(index)]));
}

/**
 * A, B … Z, AA, AB … — spreadsheet columns.
 *
 * Bijective base 26, so the labels never run out. Wrapping at 26 would give
 * two changes the same badge and the same colour, with nothing to tell them
 * apart in the gutter.
 */
export function changeLabel(index: number): string {
  let label = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    label = String.fromCharCode(65 + (n % 26)) + label;
  }
  return label;
}

/** A label back to the position it was made from. */
export function laneOfLabel(label: string): number {
  let index = 0;
  for (const character of label) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

/**
 * A lane colour from the change's label, rather than from the order the UI
 * happened to draw things in. Past six they repeat, and the label is what
 * identifies a change.
 */
export function laneColour(label: string): string {
  const index = laneOfLabel(label);
  return `var(--note-lane-${((index % 6) + 6) % 6})`;
}
