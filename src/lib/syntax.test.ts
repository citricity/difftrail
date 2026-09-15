import { describe, expect, it } from 'vitest';
import { buildRuns } from './runs.ts';
import { languageForPath } from './languages.ts';
import { prepareSyntax, tokensForContextLine, tokensForHunk } from './syntax.ts';
import type { DiffHunk, DiffLine, FileDiff, FileText } from '../types/index.ts';

const line = (kind: DiffLine['kind'], content: string): DiffLine => ({
  kind,
  content,
  oldLineNumber: kind === 'add' ? null : 1,
  newLineNumber: kind === 'delete' ? null : 1,
  noNewline: false,
});

function diff(path: string, lines: DiffLine[]): FileDiff {
  const hunk: DiffHunk = {
    id: `${path}:hunk:0`,
    oldStart: 1,
    oldLines: lines.length,
    newStart: 1,
    newLines: lines.length,
    heading: null,
    lines,
  };
  return {
    id: path,
    path,
    oldPath: null,
    status: 'modified',
    binary: false,
    truncated: false,
    additions: 0,
    deletions: 0,
    maxLineLength: 80,
    hunks: [hunk],
  };
}

const colours = (hunk: DiffHunk, index: number) =>
  (tokensForHunk(hunk)?.get(index) ?? []).map((t) => [t.text, t.color] as const);

describe('languageForPath', () => {
  it('maps by extension, by filename, and gives up gracefully', () => {
    expect(languageForPath('src/lib/syntax.ts')).toBe('typescript');
    expect(languageForPath('a/b/Component.tsx')).toBe('tsx');
    expect(languageForPath('src-tauri/src/git/parse.rs')).toBe('rust');
    expect(languageForPath('Dockerfile')).toBe('dockerfile');
    expect(languageForPath('deep/path/Makefile')).toBe('make');
    expect(languageForPath('LICENSE')).toBeNull();
    expect(languageForPath('assets/icon.png')).toBeNull();
    expect(languageForPath('.gitignore')).toBeNull();
  });
});

describe('prepareSyntax', () => {
  it('colours a TypeScript hunk', async () => {
    const file = diff('src/a.ts', [line('context', 'const n = 1; // note')]);
    await prepareSyntax(file, null);

    const got = colours(file.hunks[0], 0);
    expect(got).toContainEqual(['const', 'var(--syntax-keyword)']);
    expect(got).toContainEqual(['1', 'var(--syntax-number)']);
    expect(got).toContainEqual(['// note', 'var(--syntax-comment)']);
  });

  it('tokenises the old and new sides separately', async () => {
    // Interleaved -/+ lines are not one program. Highlighted as one text, the
    // unterminated string on the deleted line would swallow the added line.
    const file = diff('src/b.ts', [
      line('delete', 'const label = "unterminated'),
      line('add', 'const label = "fixed";'),
      line('context', 'const after = 2;'),
    ]);
    await prepareSyntax(file, null);

    const added = colours(file.hunks[0], 1);
    const after = colours(file.hunks[0], 2);

    expect(added).toContainEqual(['const', 'var(--syntax-keyword)']);
    expect(after).toContainEqual(['const', 'var(--syntax-keyword)']);
    expect(after).toContainEqual(['2', 'var(--syntax-number)']);
  });

  it('reproduces every line exactly once flattened into runs', async () => {
    const lines = [
      line('context', 'export class HttpFileProvider {'),
      line('delete', '    formData.append("file", fs.createReadStream(localPath), {'),
      line('add', '    const fileStream = fs.createReadStream(localPath);'),
      line('add', ''),
      line('add', '    throw new Error(`Failed to open ${localPath}`);'),
      line('context', '  }'),
    ];
    const file = diff('packages/file-system/src/HttpFileProvider.ts', lines);
    await prepareSyntax(file, null);

    const hunk = file.hunks[0];
    lines.forEach((source, index) => {
      const runs = buildRuns(
        source.content,
        tokensForHunk(hunk)?.get(index),
        undefined,
      );
      expect(runs.map((run) => run.text).join('')).toBe(source.content);
    });
  });

  it('leaves a file it has no grammar for alone, without throwing', async () => {
    const file = diff('notes.unknownext', [line('context', 'whatever')]);
    await expect(prepareSyntax(file, null)).resolves.toBeUndefined();
    expect(tokensForHunk(file.hunks[0])).toBeUndefined();
  });

  it('skips binary and truncated diffs', async () => {
    const binary = { ...diff('a.ts', [line('context', 'const a = 1;')]), binary: true };
    await prepareSyntax(binary, null);
    expect(tokensForHunk(binary.hunks[0])).toBeUndefined();
  });
});

describe('whole-file highlighting', () => {
  /**
   * A hunk wholly inside a block comment. Tokenised on its own, the word
   * `const` on that line reads as a keyword, because nothing in the fragment
   * says the comment ever opened. This is the case reading the whole file
   * exists to fix.
   */
  const working = ['/*', ' * const is here', ' */', 'const x = 1;'];
  const original = ['/*', ' * const was here', ' */', 'const x = 1;'];

  function commentDiff(): FileDiff {
    const hunk: DiffHunk = {
      id: 'a.ts:hunk:0',
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 1,
      heading: null,
      lines: [
        {
          ...line('delete', ' * const was here'),
          oldLineNumber: 2,
          newLineNumber: null,
        },
        { ...line('add', ' * const is here'), oldLineNumber: null, newLineNumber: 2 },
      ],
    };

    return {
      id: 'a.ts',
      path: 'a.ts',
      oldPath: null,
      status: 'modified',
      binary: false,
      truncated: false,
      additions: 1,
      deletions: 1,
      maxLineLength: 20,
      hunks: [hunk],
    };
  }

  it('mis-colours a comment when it only has the hunk', async () => {
    const file = commentDiff();
    await prepareSyntax(file, null);

    expect(colours(file.hunks[0], 1)).toContainEqual([
      'const',
      'var(--syntax-keyword)',
    ]);
  });

  it('colours it as a comment when it has the file', async () => {
    const file = commentDiff();
    await prepareSyntax(file, { original, working });

    const got = colours(file.hunks[0], 1);
    expect(got.every(([, colour]) => colour === 'var(--syntax-comment)')).toBe(true);
    expect(got).not.toContainEqual(['const', 'var(--syntax-keyword)']);
  });

  it('colours each side from its own file', async () => {
    const file = commentDiff();
    await prepareSyntax(file, { original, working });

    // The deleted line is read from the original, where it is also a comment.
    expect(
      colours(file.hunks[0], 0)
        .map(([text]) => text)
        .join(''),
    ).toBe(' * const was here');
  });

  it('colours context the reader has not expanded yet', async () => {
    // Line 4 is in no hunk; it is only ever seen by expanding, and its colours
    // are ready before the reader asks.
    const text: FileText = { original, working };
    await prepareSyntax(commentDiff(), text);

    expect(tokensForContextLine(text, 4)).toContainEqual({
      text: 'const',
      color: 'var(--syntax-keyword)',
    });
  });

  it('falls back to the hunk when the file is not available', async () => {
    const file = commentDiff();
    await prepareSyntax(file, null);

    expect(tokensForHunk(file.hunks[0])).toBeDefined();
  });
});
