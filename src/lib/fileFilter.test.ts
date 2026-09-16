import { describe, expect, it } from 'vitest';
import { filterByPath, matchPath } from './fileFilter.ts';

const PATHS = [
  'README.md',
  'src/App.tsx',
  'src/features/diff/DiffDocument.tsx',
  'src/features/diff/DiffRows.module.css',
  'src/features/settings/SettingsDialog.tsx',
  'src/lib/rows.ts',
  'src/lib/rows.test.ts',
  'src-tauri/src/settings.rs',
];

const paths = (query: string): string[] =>
  filterByPath(PATHS, query, (path) => path).map((match) => match.item);

describe('matchPath', () => {
  it('matches characters in order, with gaps', () => {
    expect(matchPath('src/lib/rows.ts', 'lrt')).not.toBeNull();
  });

  it('does not match characters out of order', () => {
    expect(matchPath('src/lib/rows.ts', 'tsr')).toBeNull();
  });

  it('ignores case and whitespace in the query', () => {
    expect(matchPath('src/App.tsx', 'AP P')?.positions).toEqual([4, 5, 6]);
  });

  it('matches everything with an empty query', () => {
    expect(matchPath('anything', '')).toEqual({ positions: [], score: 0 });
  });

  it('places the match on the file name rather than scattered through the path', () => {
    // "rows" could take the r of "src" — the best placement is the word itself.
    const path = 'src/lib/rows.ts';
    expect(matchPath(path, 'rows')?.positions).toEqual([8, 9, 10, 11]);
  });

  it('reports positions that spell the query', () => {
    const path = 'src/features/diff/DiffDocument.tsx';
    const match = matchPath(path, 'dd');
    expect(match).not.toBeNull();
    expect(match!.positions.map((i) => path[i].toLowerCase()).join('')).toBe('dd');
  });
});

describe('filterByPath', () => {
  it('keeps the original order when there is no query', () => {
    expect(paths('')).toEqual(PATHS);
  });

  it('drops what does not match', () => {
    expect(paths('settings')).toEqual([
      'src/features/settings/SettingsDialog.tsx',
      'src-tauri/src/settings.rs',
    ]);
  });

  it('ranks a match in the file name above one in the directory', () => {
    // Both live in diff/ and both can spell "diffdoc"; only one has it in its
    // name, in a single run.
    expect(paths('diffdoc')[0]).toBe('src/features/diff/DiffDocument.tsx');
  });

  it('ranks initials at word starts highly', () => {
    expect(paths('dd')[0]).toBe('src/features/diff/DiffDocument.tsx');
  });

  it('ranks a consecutive run above the same letters spread out', () => {
    expect(paths('rows')[0]).toBe('src/lib/rows.ts');
  });

  it('breaks ties by original order', () => {
    const ranked = paths('rows.t');
    expect(ranked.indexOf('src/lib/rows.ts')).toBeLessThan(
      ranked.indexOf('src/lib/rows.test.ts'),
    );
  });
});
