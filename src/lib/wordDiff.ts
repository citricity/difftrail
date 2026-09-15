/**
 * Intra-line (word-level) diffing.
 *
 * Git tells us a line was replaced; it does not tell us which part of it
 * changed. Highlighting just the changed words is what makes a one-character
 * edit in a long line readable, and it is the single biggest legibility win
 * available without pulling in a syntax highlighter.
 *
 * Deliberately bounded: pathological lines fall back to highlighting the whole
 * line rather than running a quadratic algorithm over them.
 */

/** Above this token count the LCS table is not worth building. */
const MAX_TOKENS = 400;

/**
 * Below this proportion of shared tokens the two lines are treated as
 * unrelated, and highlighting every word would be noise rather than signal.
 */
const MIN_SIMILARITY = 0.25;

export interface Segment {
  text: string;
  changed: boolean;
}

/**
 * Splits a line into diffable tokens: runs of word characters, and every other
 * character on its own.
 *
 * Keeping punctuation and whitespace as separate tokens means an edit inside
 * `foo.bar(baz)` highlights the identifier that changed rather than the whole
 * expression.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let word = '';

  for (const char of line) {
    if (/[\w$]/.test(char)) {
      word += char;
    } else {
      if (word !== '') {
        tokens.push(word);
        word = '';
      }
      tokens.push(char);
    }
  }

  if (word !== '') tokens.push(word);
  return tokens;
}

/**
 * Longest common subsequence over tokens, returned as a backtracked list of
 * operations. Classic DP: O(n·m) time and space, which is why the caller
 * bounds the input.
 */
function lcsOps(
  a: string[],
  b: string[],
): Array<{ op: 'equal' | 'remove' | 'insert'; token: string }> {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }

  const ops: Array<{ op: 'equal' | 'remove' | 'insert'; token: string }> = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ op: 'equal', token: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      ops.push({ op: 'remove', token: a[i] });
      i += 1;
    } else {
      ops.push({ op: 'insert', token: b[j] });
      j += 1;
    }
  }

  while (i < a.length) {
    ops.push({ op: 'remove', token: a[i] });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ op: 'insert', token: b[j] });
    j += 1;
  }

  return ops;
}

/** Merges neighbouring segments that share a `changed` flag. */
function coalesce(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];

  for (const segment of segments) {
    if (segment.text === '') continue;

    const last = merged[merged.length - 1];
    if (last !== undefined && last.changed === segment.changed) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

export interface LinePairDiff {
  removed: Segment[];
  added: Segment[];
}

/** The whole line as a single unchanged segment. */
function plain(line: string): Segment[] {
  return line === '' ? [] : [{ text: line, changed: false }];
}

/** The whole line as a single changed segment. */
function allChanged(line: string): Segment[] {
  return line === '' ? [] : [{ text: line, changed: true }];
}

/**
 * Diffs a removed line against the added line that replaced it.
 *
 * Returns segments for each side; `changed` marks the parts to emphasise.
 */
export function diffLinePair(oldLine: string, newLine: string): LinePairDiff {
  if (oldLine === newLine) {
    return { removed: plain(oldLine), added: plain(newLine) };
  }

  const a = tokenize(oldLine);
  const b = tokenize(newLine);

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return { removed: allChanged(oldLine), added: allChanged(newLine) };
  }

  const ops = lcsOps(a, b);

  const common = ops.reduce(
    (total, entry) => (entry.op === 'equal' ? total + entry.token.length : total),
    0,
  );
  const longest = Math.max(oldLine.length, newLine.length);

  // Two lines that share almost nothing are a replacement, not an edit.
  if (longest > 0 && common / longest < MIN_SIMILARITY) {
    return { removed: allChanged(oldLine), added: allChanged(newLine) };
  }

  const removed: Segment[] = [];
  const added: Segment[] = [];

  for (const { op, token } of ops) {
    if (op === 'equal') {
      removed.push({ text: token, changed: false });
      added.push({ text: token, changed: false });
    } else if (op === 'remove') {
      removed.push({ text: token, changed: true });
    } else {
      added.push({ text: token, changed: true });
    }
  }

  return { removed: coalesce(removed), added: coalesce(added) };
}

/**
 * Pairs the removed and added lines of one hunk so each replacement can be
 * word-diffed.
 *
 * Git emits a change as a run of `-` lines followed by a run of `+` lines.
 * Pairing them by position within those runs is what a reviewer reads them as,
 * and matches how GitHub presents the same hunk.
 *
 * Returns a map from line index (within the hunk) to that line's segments.
 */
export function buildHunkSegments(
  lines: Array<{ kind: 'context' | 'add' | 'delete'; content: string }>,
): Map<number, Segment[]> {
  const segments = new Map<number, Segment[]>();

  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind !== 'delete') {
      index += 1;
      continue;
    }

    const removedStart = index;
    while (index < lines.length && lines[index].kind === 'delete') index += 1;

    const addedStart = index;
    while (index < lines.length && lines[index].kind === 'add') index += 1;

    const removedCount = addedStart - removedStart;
    const addedCount = index - addedStart;
    const pairs = Math.min(removedCount, addedCount);

    for (let offset = 0; offset < pairs; offset += 1) {
      const removedIndex = removedStart + offset;
      const addedIndex = addedStart + offset;

      const { removed, added } = diffLinePair(
        lines[removedIndex].content,
        lines[addedIndex].content,
      );

      segments.set(removedIndex, removed);
      segments.set(addedIndex, added);
    }
  }

  return segments;
}
