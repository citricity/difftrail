/**
 * Following the scroll position with the current change.
 */

import { describe, expect, it } from 'vitest';
import { buildNavigationIndex } from './navigation.ts';
import { buildRowModel } from './rows.ts';
import type { RowMetrics } from './rows.ts';
import {
  buildScrollStops,
  changeInView,
  followedStopReplaced,
} from './scrollFollow.ts';
import { loadedFile, pendingFile } from '../test/factories.ts';
import type { DocumentFile } from '../types/index.ts';

const METRICS: RowMetrics = {
  lineHeight: 20,
  fileHeaderHeight: 40,
  expanderHeight: 24,
  noticeHeight: 50,
  placeholderHeight: 60,
  imageHeight: 240,
  fileGap: 10,
  charWidth: 8,
  gutterWidth: 100,
  contentPadding: 16,
};

function stopsFor(files: DocumentFile[]) {
  const model = buildRowModel(files, METRICS);
  return { model, stops: buildScrollStops(model, buildNavigationIndex(files)) };
}

describe('buildScrollStops', () => {
  it('spans each hunk from its header to its last line, in document order', () => {
    const { model, stops } = stopsFor([loadedFile('a.ts', 2)]);

    // file-header, hunk-header, line, line, hunk-header, line, line, spacer
    expect(stops).toEqual([
      {
        location: { fileId: 'a.ts', hunkId: 'a.ts:hunk:0' },
        top: model.offsets[1],
        bottom: model.offsets[4],
      },
      {
        location: { fileId: 'a.ts', hunkId: 'a.ts:hunk:1' },
        top: model.offsets[4],
        bottom: model.offsets[7],
      },
    ]);
  });

  it('gives a file with no hunks yet a stop of its own', () => {
    const { model, stops } = stopsFor([pendingFile('b.ts')]);

    expect(stops).toEqual([
      { location: { fileId: 'b.ts', hunkId: null }, top: 0, bottom: model.offsets[2] },
    ]);
  });

  it('leaves out the hunks of a collapsed file, which have no rows', () => {
    const collapsed = { ...loadedFile('a.ts', 2), collapsed: true };
    const { stops } = stopsFor([collapsed, loadedFile('b.ts', 1)]);

    expect(stops.map((stop) => stop.location.hunkId)).toEqual(['b.ts:hunk:0']);
  });
});

describe('changeInView', () => {
  const { model, stops } = stopsFor([loadedFile('a.ts', 2), loadedFile('b.ts', 1)]);
  const hunk = (id: string) => model.offsets[model.hunkRowIndex.get(id)!];

  it('names the change the reading line is inside', () => {
    const line = hunk('a.ts:hunk:1') + 5;
    expect(changeInView(stops, line, line + 1000)?.hunkId).toBe('a.ts:hunk:1');
  });

  it('moves on as soon as the next change reaches the reading line', () => {
    const line = hunk('a.ts:hunk:1');
    expect(changeInView(stops, line, line + 20)?.hunkId).toBe('a.ts:hunk:1');
    expect(changeInView(stops, line - 1, line + 20)?.hunkId).toBe('a.ts:hunk:0');
  });

  it('takes the next change once it is visible when the reading line is in a gap', () => {
    // In a.ts's spacer, between its last hunk and b.ts's header.
    const line = model.offsets[model.fileRowIndex.get('b.ts')!] - 2;
    const next = hunk('b.ts:hunk:0');

    expect(changeInView(stops, line, next + 1)?.hunkId).toBe('b.ts:hunk:0');
    expect(changeInView(stops, line, next)?.hunkId).toBe('a.ts:hunk:1');
  });

  it('names the first change at the top of the document once it is in view', () => {
    expect(changeInView(stops, 10, 500)?.hunkId).toBe('a.ts:hunk:0');
    expect(changeInView(stops, 10, 30)).toBeNull();
  });

  it('has nothing to say about an empty document', () => {
    expect(changeInView([], 0, 500)).toBeNull();
  });
});

describe('followedStopReplaced', () => {
  const pending = stopsFor([pendingFile('a.ts'), loadedFile('b.ts', 1)]).stops;
  const loaded = stopsFor([loadedFile('a.ts', 2), loadedFile('b.ts', 1)]).stops;
  const fileStop = { fileId: 'a.ts', hunkId: null };

  it('is true once a followed pending file has expanded into its hunks', () => {
    expect(followedStopReplaced(fileStop, fileStop, pending)).toBe(false);
    expect(followedStopReplaced(fileStop, fileStop, loaded)).toBe(true);
  });

  it('leaves alone a location navigation has chosen since', () => {
    const hunk = { fileId: 'b.ts', hunkId: 'b.ts:hunk:0' };
    expect(followedStopReplaced(fileStop, hunk, loaded)).toBe(false);
    expect(followedStopReplaced(null, fileStop, loaded)).toBe(false);
  });

  it('only concerns file-level stops', () => {
    const hunk = { fileId: 'a.ts', hunkId: 'a.ts:hunk:0' };
    expect(followedStopReplaced(hunk, hunk, pending)).toBe(false);
  });
});
