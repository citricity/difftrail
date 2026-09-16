/**
 * Filtering the file list by what the reader types.
 *
 * Fuzzy in the way editors' "go to file" is: the query's characters must all
 * appear in the path, in order, but not necessarily together — so `dd` finds
 * `DiffDocument.tsx` and `ftrows` finds `features/…/rows.ts`. A plain substring
 * search would make the reader type the path the way it is spelled, which is
 * the thing they are trying to avoid.
 *
 * Matches are ranked, because a subsequence matches far too much to leave in
 * Git's order. What scores:
 *
 * - characters matched **consecutively**, since a typed run is usually a word;
 * - characters at the **start of a segment** — after `/`, `.`, `-`, `_`, or a
 *   lower-to-upper case change — since people type initials;
 * - characters in the **file name** rather than its directory, since the name
 *   is what people remember — and most of all the name's **first** character,
 *   so `rows` puts `rows.ts` above `DiffRows.module.css`.
 *
 * Among the ways a query can match one path, the best-scoring placement wins,
 * which is what puts `rows` on `rows.ts` rather than on the `r` of `src` and the
 * `ows` of some later word. Ties keep the original order.
 */

const CONSECUTIVE = 5;
const SEGMENT_START = 3;
const IN_NAME = 2;
const NAME_START = 4;
const BASE = 1;

export interface FileMatch<T> {
  item: T;
  /** Indices into the path of the characters the query matched, ascending. */
  positions: number[];
  score: number;
}

function isSegmentStart(path: string, index: number): boolean {
  if (index === 0) return true;
  const before = path[index - 1];
  if ('/._- '.includes(before)) return true;
  const here = path[index];
  return before === before.toLowerCase() && here !== here.toLowerCase();
}

/**
 * The best placement of `query` in `path`, or null if it does not match.
 *
 * Dynamic programming over (query character, path position): each cell holds
 * the best score for matching the query so far with its last character at that
 * position. A cell extends either the cell diagonally before it (consecutive)
 * or the best cell anywhere earlier in the previous row (a gap), which a
 * running maximum makes O(query × path) rather than cubic.
 */
export function matchPath(
  path: string,
  query: string,
): { positions: number[]; score: number } | null {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (needle.length === 0) return { positions: [], score: 0 };

  const hay = path.toLowerCase();
  const n = hay.length;
  const m = needle.length;
  if (m > n) return null;

  const nameStart = path.lastIndexOf('/') + 1;
  const NONE = -Infinity;

  // score[i][j]: best score with needle[i] matched at hay[j].
  // from[i][j]: where needle[i - 1] was matched on that best path.
  const score: Float64Array[] = [];
  const from: Int32Array[] = [];

  for (let i = 0; i < m; i += 1) {
    const row = new Float64Array(n).fill(NONE);
    const back = new Int32Array(n).fill(-1);
    const previous = i === 0 ? null : score[i - 1];

    // Best of previous[0..j-2], and where it was, as j advances.
    let gapBest = NONE;
    let gapAt = -1;

    for (let j = 0; j < n; j += 1) {
      if (previous !== null && j >= 2 && previous[j - 2] > gapBest) {
        gapBest = previous[j - 2];
        gapAt = j - 2;
      }

      if (hay[j] !== needle[i]) continue;

      const gain =
        BASE +
        (isSegmentStart(path, j) ? SEGMENT_START : 0) +
        (j >= nameStart ? IN_NAME : 0) +
        (j === nameStart ? NAME_START : 0);

      if (previous === null) {
        row[j] = gain;
        continue;
      }

      const viaGap = gapBest === NONE ? NONE : gapBest + gain;
      const viaRun =
        j >= 1 && previous[j - 1] !== NONE
          ? previous[j - 1] + gain + CONSECUTIVE
          : NONE;

      if (viaRun >= viaGap && viaRun !== NONE) {
        row[j] = viaRun;
        back[j] = j - 1;
      } else if (viaGap !== NONE) {
        row[j] = viaGap;
        back[j] = gapAt;
      }
    }

    score.push(row);
    from.push(back);
  }

  let end = -1;
  let best = NONE;
  const last = score[m - 1];
  for (let j = 0; j < n; j += 1) {
    if (last[j] > best) {
      best = last[j];
      end = j;
    }
  }
  if (end === -1) return null;

  const positions = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; i -= 1) {
    positions[i] = j;
    j = from[i][j];
  }

  return { positions, score: best };
}

/**
 * The items whose path matches, best first.
 *
 * An empty query matches everything, unranked, in the order given — which for
 * the file list is Git's order, the same order as the document.
 */
export function filterByPath<T>(
  items: readonly T[],
  query: string,
  pathOf: (item: T) => string,
): FileMatch<T>[] {
  const matches: Array<FileMatch<T> & { order: number }> = [];

  items.forEach((item, order) => {
    const match = matchPath(pathOf(item), query);
    if (match !== null) matches.push({ item, ...match, order });
  });

  matches.sort((a, b) => b.score - a.score || a.order - b.order);
  return matches.map(({ item, positions, score }) => ({ item, positions, score }));
}
