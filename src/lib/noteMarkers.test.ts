import { describe, expect, it } from 'vitest';
import {
  buildNoteMarkers,
  changeLabel,
  changeOfHunk,
  changesInOrder,
  fileOfHunk,
  labelChanges,
  focusFilter,
  hunksOfChange,
  laneColour,
  stepChange,
  ungroupedHunks,
} from './noteMarkers.ts';
import type { ResolvedHunk } from '../types/index.ts';

function hunk(logicalChangeIds: string[]): ResolvedHunk {
  return {
    hunkId: '',
    reasons: [],
    logicalChangeIds,
    ambiguous: false,
    partial: false,
  };
}

function markersFor(order: string[], membership: Record<string, string[]>) {
  const hunks = Object.fromEntries(
    Object.entries(membership).map(([id, changes]) => [id, hunk(changes)]),
  );

  return Object.fromEntries(buildNoteMarkers(order, hunks));
}

describe('buildNoteMarkers', () => {
  it('marks both ends of a run that covers several hunks', () => {
    const markers = markersFor(['a', 'b', 'c'], {
      a: ['0'],
      b: ['0'],
      c: ['0'],
    });

    expect(markers.a).toMatchObject({ starts: ['0'], ends: [], inside: [] });
    expect(markers.b).toMatchObject({ starts: [], ends: [], inside: ['0'] });
    expect(markers.c).toMatchObject({ starts: [], ends: ['0'], inside: [] });
  });

  it('starts and ends a single-hunk change on the same hunk', () => {
    const markers = markersFor(['a'], { a: ['0'] });
    expect(markers.a).toMatchObject({ starts: ['0'], ends: ['0'], inside: [] });
  });

  it('gives a re-opened span a marker at each end of each run', () => {
    // "Hunks 1 and 3 but not 2" — which is the whole reason spans re-open.
    const markers = markersFor(['a', 'b', 'c'], { a: ['0'], c: ['0'] });

    expect(markers.a).toMatchObject({ starts: ['0'], ends: ['0'], inside: [] });
    expect(markers.b).toBeUndefined();
    expect(markers.c).toMatchObject({ starts: ['0'], ends: ['0'], inside: [] });
  });

  it('keeps overlapping changes apart', () => {
    const markers = markersFor(['a', 'b', 'c'], {
      a: ['0'],
      b: ['0', '1'],
      c: ['1'],
    });

    expect(markers.a).toMatchObject({ starts: ['0'], ends: [], inside: [] });
    expect(markers.b).toMatchObject({ starts: ['1'], ends: ['0'], inside: [] });
    expect(markers.c).toMatchObject({ starts: [], ends: ['1'], inside: [] });
  });

  it('has nothing to say about a hunk no change covers', () => {
    const markers = markersFor(['a', 'b'], { a: [], b: [] });
    expect(markers).toEqual({});
  });

  it('treats a gap in the order as a gap', () => {
    // The middle file has not loaded, so its hunks are not in the document.
    // The change still shows where it begins and ends among what is here.
    const markers = markersFor(['a', 'z'], { a: ['0'], z: ['0'] });

    expect(markers.a.starts).toEqual(['0']);
    expect(markers.z.ends).toEqual(['0']);
  });
});

describe('hunksOfChange', () => {
  it('lists the hunks a change covers, in document order', () => {
    const hunks = {
      a: hunk(['0']),
      b: hunk(['1']),
      c: hunk(['0', '1']),
    };

    expect(hunksOfChange(['a', 'b', 'c'], hunks, '0')).toEqual(['a', 'c']);
    expect(hunksOfChange(['a', 'b', 'c'], hunks, '1')).toEqual(['b', 'c']);
    expect(hunksOfChange(['a', 'b', 'c'], hunks, '2')).toEqual([]);
  });
});

describe('fileOfHunk', () => {
  it('reads the file out of a hunk id', () => {
    expect(fileOfHunk('src/lib/rows.ts:hunk:3')).toBe('src/lib/rows.ts');
    expect(fileOfHunk('a.ts:hunk:0')).toBe('a.ts');
  });

  it('keeps a path that contains the separator intact', () => {
    expect(fileOfHunk('weird/:hunk:/name.ts:hunk:1')).toBe('weird/:hunk:/name.ts');
  });

  it('leaves something that is not a hunk id alone', () => {
    expect(fileOfHunk('src/lib/rows.ts')).toBe('src/lib/rows.ts');
  });
});

describe('focusFilter', () => {
  const hunks = {
    'src/one.ts:hunk:0': hunk(['0']),
    'src/one.ts:hunk:1': hunk(['1']),
    'src/two.ts:hunk:0': hunk(['0']),
  };

  it('keeps the hunks one change covers, and nothing else', () => {
    const filter = focusFilter(hunks, '0');

    expect(filter.hunk('src/one.ts:hunk:0')).toBe(true);
    expect(filter.hunk('src/two.ts:hunk:0')).toBe(true);
    expect(filter.hunk('src/one.ts:hunk:1')).toBe(false);
  });

  it('keeps a file the change reaches into, so an unloaded one is still a stop', () => {
    const filter = focusFilter(hunks, '0');

    expect(filter.file('src/one.ts')).toBe(true);
    expect(filter.file('src/two.ts')).toBe(true);
    expect(filter.file('src/three.ts')).toBe(false);
  });

  it('keeps nothing for a change nothing belongs to', () => {
    const filter = focusFilter(hunks, 'missing');

    expect(filter.hunk('src/one.ts:hunk:0')).toBe(false);
    expect(filter.file('src/one.ts')).toBe(false);
  });
});

describe('changesInOrder', () => {
  const hunks = {
    a: hunk([]),
    b: hunk(['1']),
    c: hunk(['0', '1']),
    d: hunk(['0']),
  };

  it('lists each change once, where it first appears', () => {
    expect(changesInOrder(['a', 'b', 'c', 'd'], hunks)).toEqual([
      { id: '1', hunkId: 'b' },
      { id: '0', hunkId: 'c' },
    ]);
  });

  it('follows the document, not the changelog table', () => {
    expect(changesInOrder(['d', 'b'], hunks)).toEqual([
      { id: '0', hunkId: 'd' },
      { id: '1', hunkId: 'b' },
    ]);
  });

  it('counts the hunks no change covers', () => {
    expect(ungroupedHunks(['a', 'b', 'c', 'd'], hunks)).toBe(1);
  });

  it('names the first of several changes as the one a hunk reads as', () => {
    expect(changeOfHunk(hunks, 'c')).toBe('0');
    expect(changeOfHunk(hunks, 'a')).toBeNull();
    expect(changeOfHunk(hunks, null)).toBeNull();
  });
});

describe('stepChange', () => {
  const hunks = {
    a: hunk(['0']),
    b: hunk([]),
    c: hunk(['1']),
    d: hunk(['2']),
  };
  const order = ['a', 'b', 'c', 'd'];
  const changes = changesInOrder(order, hunks);

  const files = ['a', 'b', 'c', 'd'];
  const cursor = (hunkId: string | null) =>
    hunkId === null ? null : { fileId: hunkId, hunkId };

  const step = (from: string | null, direction: 'next' | 'previous') =>
    stepChange(
      changes,
      order,
      files,
      cursor(from),
      changeOfHunk(hunks, from),
      direction,
    )?.id ?? null;

  it('moves change by change, not span by span', () => {
    expect(step('a', 'next')).toBe('1');
    expect(step('c', 'previous')).toBe('0');
  });

  it('stops at the ends rather than wrapping, as the hunk arrows do', () => {
    expect(step('d', 'next')).toBeNull();
    expect(step('a', 'previous')).toBeNull();
  });

  it('enters at the top or the bottom when nothing is selected yet', () => {
    expect(step(null, 'next')).toBe('0');
    expect(step(null, 'previous')).toBe('2');
  });

  it('steps to the nearest change from a hunk that belongs to none', () => {
    expect(step('b', 'next')).toBe('1');
    expect(step('b', 'previous')).toBe('0');
  });

  it('reaches the second intent on a hunk that serves two', () => {
    const shared = { a: hunk(['0']), b: hunk(['0', '1']) };
    const order = ['a', 'b'];
    const entries = changesInOrder(order, shared);

    // Both changes are on hunk b, so the hunk cannot say which one is being
    // read. Told the first, stepping must reach the second rather than
    // returning b again and leaving the reader stuck on it.
    const at = (hunkId: string) => ({ fileId: hunkId, hunkId });

    expect(stepChange(entries, order, order, at('b'), '0', 'next')?.id).toBe('1');
    expect(stepChange(entries, order, order, at('b'), '1', 'next')).toBeNull();
    expect(stepChange(entries, order, order, at('b'), '1', 'previous')?.id).toBe(
      '0',
    );
  });

  // A cursor on a file header, or on a hunk the changelog never saw, is not in
  // the noted order at all. Treating either as "nowhere" sent Next back to the
  // top of the document from halfway down it.
  describe('a cursor that is not on a noted hunk', () => {
    const noted = {
      'one.ts:hunk:0': hunk(['0']),
      'three.ts:hunk:0': hunk(['1']),
    };
    const order = ['one.ts:hunk:0', 'three.ts:hunk:0'];
    const files = ['one.ts', 'two.ts', 'three.ts'];
    const entries = changesInOrder(order, noted);

    const from = (cursor: { fileId: string; hunkId: string | null }) => ({
      next: stepChange(entries, order, files, cursor, null, 'next')?.id ?? null,
      previous:
        stepChange(entries, order, files, cursor, null, 'previous')?.id ?? null,
    });

    it('steps on from the file header it is sitting on', () => {
      expect(from({ fileId: 'two.ts', hunkId: null })).toEqual({
        next: '1',
        previous: '0',
      });
    });

    it('steps on from a hunk the changelog has never seen', () => {
      expect(from({ fileId: 'two.ts', hunkId: 'two.ts:hunk:3' })).toEqual({
        next: '1',
        previous: '0',
      });
    });

    it('does not count the cursor\'s own file as behind it', () => {
      expect(from({ fileId: 'one.ts', hunkId: null })).toEqual({
        next: '0',
        previous: null,
      });
    });
  });
});

describe('changeLabel', () => {
  it('runs past Z rather than starting again at A', () => {
    expect(changeLabel(0)).toBe('A');
    expect(changeLabel(25)).toBe('Z');
    expect(changeLabel(26)).toBe('AA');
    expect(changeLabel(27)).toBe('AB');
    expect(changeLabel(51)).toBe('AZ');
    expect(changeLabel(52)).toBe('BA');
  });

  it('gives a two-letter label a lane of its own, not the lane of its first letter', () => {
    expect(laneColour(changeLabel(0))).toBe('var(--note-lane-0)');
    expect(laneColour(changeLabel(26))).toBe(
      `var(--note-lane-${26 % 6})`,
    );
    expect(laneColour(changeLabel(26))).not.toBe(laneColour(changeLabel(0)));
  });
});

describe('labelChanges', () => {
  const entry = (id: string, hunkId: string) => ({ id, hunkId });

  // The labels are read down the gutter and along the bar, so they follow the
  // document. Taking them from the changelog's table opened a diff on B.
  it('labels in the order the reader meets them, not the table order', () => {
    const labels = labelChanges(
      [entry('2', 'a'), entry('0', 'b'), entry('1', 'c')],
      ['0', '1', '2'],
    );

    expect(labels.get('2')).toBe('A');
    expect(labels.get('0')).toBe('B');
    expect(labels.get('1')).toBe('C');
  });

  it('still names a change the document never shows, after the rest', () => {
    const labels = labelChanges([entry('1', 'a')], ['0', '1', '2']);

    expect(labels.get('1')).toBe('A');
    expect(labels.get('0')).toBe('B');
    expect(labels.get('2')).toBe('C');
  });
});
