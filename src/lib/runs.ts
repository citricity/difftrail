/**
 * Flattening a diff line into what the DOM actually renders.
 *
 * Two independent layers want to mark up the same line: syntax highlighting
 * colours it by grammar, word diffing shades the words that changed. Their
 * boundaries do not line up — a replaced identifier can sit inside one syntax
 * token, and one changed word can span several — so neither can be expressed
 * by nesting the other's spans.
 *
 * The answer is to stop treating them as spans at all. Both layers are read as
 * boundary sets over the line, merged into the union, and emitted as one flat
 * list of runs, each carrying a colour and whether it changed. One pass, no
 * nesting, and a span per run.
 */

import type { Segment } from './wordDiff.ts';
import type { SyntaxToken } from './syntax.ts';

export interface LineRun {
  text: string;
  /** A CSS custom property reference, or null to inherit the line's colour. */
  color: string | null;
  /** Part of a word-level change, so it takes the changed-word background. */
  changed: boolean;
}

interface Layer<T> {
  items: T[];
  /** Index of the item covering the cursor. */
  at: number;
  /** Offset at which the item at `at` ends. */
  end: number;
}

function begin<T extends { text: string }>(items: T[]): Layer<T> {
  return { items, at: 0, end: items.length === 0 ? 0 : items[0].text.length };
}

/** Advances a layer past any items that end at or before `offset`. */
function advance<T extends { text: string }>(layer: Layer<T>, offset: number): void {
  while (layer.at < layer.items.length && layer.end <= offset) {
    layer.at += 1;
    if (layer.at < layer.items.length) {
      layer.end += layer.items[layer.at].text.length;
    }
  }
}

function current<T extends { text: string }>(layer: Layer<T>): T | undefined {
  return layer.items[layer.at];
}

/** The next boundary at or after `offset`, given both layers' current items. */
function nextBoundary(
  offset: number,
  limit: number,
  layers: Array<Layer<{ text: string }>>,
): number {
  let boundary = limit;

  for (const layer of layers) {
    if (layer.at < layer.items.length && layer.end > offset) {
      boundary = Math.min(boundary, layer.end);
    }
  }

  return boundary;
}

/**
 * Combines the two layers over one line.
 *
 * Either may be absent — an unhighlighted file, an unchanged line — and a
 * layer whose lengths disagree with the line simply stops applying past where
 * it ran out, which is what keeps a mis-tokenised line rendering as plain text
 * rather than as nothing.
 */
export function buildRuns(
  content: string,
  tokens: SyntaxToken[] | undefined,
  segments: Segment[] | undefined,
): LineRun[] {
  if (content === '') return [];

  const hasTokens = tokens !== undefined && tokens.length > 0;
  const hasSegments = segments !== undefined && segments.length > 0;
  if (!hasTokens && !hasSegments) {
    return [{ text: content, color: null, changed: false }];
  }

  const syntax = begin(tokens ?? []);
  const words = begin(segments ?? []);
  const runs: LineRun[] = [];

  let offset = 0;
  while (offset < content.length) {
    advance(syntax, offset);
    advance(words, offset);

    const boundary = nextBoundary(offset, content.length, [syntax, words]);
    const text = content.slice(offset, boundary);

    const token = syntax.end > offset ? current(syntax) : undefined;
    const segment = words.end > offset ? current(words) : undefined;

    const color = token?.color ?? null;
    const changed = segment?.changed ?? false;

    // Runs only ever split because *some* boundary fell here, so neighbouring
    // runs frequently agree. Merging them keeps the span count near the number
    // of visible colour changes rather than the number of boundaries.
    const previous = runs[runs.length - 1];
    if (
      previous !== undefined &&
      previous.color === color &&
      previous.changed === changed
    ) {
      previous.text += text;
    } else {
      runs.push({ text, color, changed });
    }

    offset = boundary;
  }

  return runs;
}
