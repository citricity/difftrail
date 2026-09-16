import { describe, expect, it } from 'vitest';
import { buildRuns } from './runs.ts';
import type { SyntaxToken } from './syntax.ts';
import type { Segment } from './wordDiff.ts';

const token = (text: string, color: string | null): SyntaxToken => ({ text, color });
const segment = (text: string, changed: boolean): Segment => ({ text, changed });

describe('buildRuns', () => {
  it('returns one plain run when neither layer has anything to say', () => {
    expect(buildRuns('const a = 1;', undefined, undefined)).toEqual([
      { text: 'const a = 1;', color: null, changed: false },
    ]);
  });

  it('returns nothing for an empty line', () => {
    expect(buildRuns('', undefined, undefined)).toEqual([]);
  });

  it('carries syntax colours through on their own', () => {
    const runs = buildRuns('let a', [token('let', 'kw'), token(' a', null)], undefined);

    expect(runs).toEqual([
      { text: 'let', color: 'kw', changed: false },
      { text: ' a', color: null, changed: false },
    ]);
  });

  it('carries changed words through on their own', () => {
    const runs = buildRuns('let a', undefined, [
      segment('let ', false),
      segment('a', true),
    ]);

    expect(runs).toEqual([
      { text: 'let ', color: null, changed: false },
      { text: 'a', color: null, changed: true },
    ]);
  });

  it('splits a syntax token that is only partly changed', () => {
    // One token, two segments: the run boundary has to come from the word
    // layer even though the colour is constant across it.
    const runs = buildRuns(
      'oldName',
      [token('oldName', 'var')],
      [segment('old', true), segment('Name', false)],
    );

    expect(runs).toEqual([
      { text: 'old', color: 'var', changed: true },
      { text: 'Name', color: 'var', changed: false },
    ]);
  });

  it('splits a changed word that spans several syntax tokens', () => {
    const runs = buildRuns(
      'fs.read',
      [token('fs', 'var'), token('.read', 'fn')],
      [segment('fs.read', true)],
    );

    expect(runs).toEqual([
      { text: 'fs', color: 'var', changed: true },
      { text: '.read', color: 'fn', changed: true },
    ]);
  });

  it('merges neighbouring runs that agree', () => {
    // Three tokens, one colour between them: the reader sees one span.
    const runs = buildRuns(
      'a+b',
      [token('a', 'x'), token('+', 'x'), token('b', 'x')],
      undefined,
    );

    expect(runs).toEqual([{ text: 'a+b', color: 'x', changed: false }]);
  });

  it('reproduces the line exactly, whatever the boundaries', () => {
    const content = 'const fileStream = fs.createReadStream(localPath);';
    const runs = buildRuns(
      content,
      [
        token('const', 'kw'),
        token(' ', null),
        token('fileStream', 'var'),
        token(' = ', null),
        token('fs', 'var'),
        token('.createReadStream', 'fn'),
        token('(localPath);', null),
      ],
      [
        segment('const fileStream = fs.', false),
        segment('createReadStream', true),
        segment('(localPath);', false),
      ],
    );

    expect(runs.map((run) => run.text).join('')).toBe(content);
    expect(
      runs
        .filter((run) => run.changed)
        .map((run) => run.text)
        .join(''),
    ).toBe('createReadStream');
  });

  it('stops applying a layer that runs out before the line does', () => {
    const runs = buildRuns('abcdef', [token('abc', 'kw')], undefined);

    expect(runs).toEqual([
      { text: 'abc', color: 'kw', changed: false },
      { text: 'def', color: null, changed: false },
    ]);
  });

  it('ignores a layer that overruns the line', () => {
    const runs = buildRuns('ab', [token('abcdef', 'kw')], undefined);

    expect(runs).toEqual([{ text: 'ab', color: 'kw', changed: false }]);
  });
});
