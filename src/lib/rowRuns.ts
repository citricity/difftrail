/**
 * Cached render runs per hunk.
 *
 * The same arrangement as `segments.ts`, and for the same reason: a hunk's
 * lines never change once loaded, so the flattening is done at most once and
 * the array identity stays stable across renders. A `WeakMap` keyed by the
 * hunk needs no eviction — entries go when the diff they belong to does.
 *
 * Safe to fill lazily because syntax tokens are computed *before* a diff is
 * dispatched (see `prepareSyntax`): by the time a row can ask for its runs,
 * highlighting has either finished or been declined for good.
 */

import type { DiffHunk, FileText } from '../types/index.ts';
import { buildRuns } from './runs.ts';
import type { LineRun } from './runs.ts';
import { segmentsForHunk } from './segments.ts';
import { tokensForContextLine, tokensForHunk } from './syntax.ts';

const cache = new WeakMap<DiffHunk, Map<number, LineRun[]>>();
const contextCache = new WeakMap<FileText, Map<number, LineRun[]>>();

export function runsForLine(hunk: DiffHunk, lineIndex: number): LineRun[] {
  let lines = cache.get(hunk);
  if (lines === undefined) {
    lines = new Map<number, LineRun[]>();
    cache.set(hunk, lines);
  }

  const existing = lines.get(lineIndex);
  if (existing !== undefined) return existing;

  const line = hunk.lines[lineIndex];
  const runs = buildRuns(
    line.content,
    tokensForHunk(hunk)?.get(lineIndex),
    segmentsForHunk(hunk).get(lineIndex),
  );

  lines.set(lineIndex, runs);
  return runs;
}

/**
 * Runs for a line of unchanged context the reader expanded into view.
 *
 * There is no word diffing to merge here — nothing on this line changed — so
 * it is syntax colour alone, keyed by the file rather than by a hunk.
 */
export function runsForContextLine(text: FileText, lineNumber: number): LineRun[] {
  let lines = contextCache.get(text);
  if (lines === undefined) {
    lines = new Map<number, LineRun[]>();
    contextCache.set(text, lines);
  }

  const existing = lines.get(lineNumber);
  if (existing !== undefined) return existing;

  const content = text.working?.[lineNumber - 1] ?? '';
  const runs = buildRuns(content, tokensForContextLine(text, lineNumber), undefined);

  lines.set(lineNumber, runs);
  return runs;
}
