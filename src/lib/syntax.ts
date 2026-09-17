/**
 * Syntax highlighting for diff lines.
 *
 * Shiki tokenises; `syntaxTheme.ts` decides the colours. The work happens once
 * per hunk, while its diff is loading, and the result is cached against the
 * hunk object — so the render path stays synchronous and `DiffLineRow` stays a
 * memoised function of its props, exactly as it was before highlighting
 * existed.
 *
 * There are two paths. When the whole file could be read and matched to the
 * diff (`loadFileText`), each side is tokenised once as the complete program
 * it is, and every diff line takes the colours of the file line it came from —
 * so a hunk opening inside a block comment colours correctly, and the expanded
 * context around it is already coloured too.
 *
 * Otherwise it falls back to tokenising hunks on their own. That is
 * best-effort by construction, but it still avoids the worse and entirely
 * avoidable fragment problem: the old and new sides are tokenised
 * *separately*, because a hunk's interleaved `-`/`+` lines are not a program
 * and highlighting them as one would mis-colour both.
 */

import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { HighlighterCore } from 'shiki/core';
import type { DiffHunk, DiffLine, FileDiff, FileText } from '../types/index.ts';
import { grammarLoader, languageForPath } from './languages.ts';
import { SYNTAX_THEME_NAME, syntaxTheme } from './syntaxTheme.ts';

/** One coloured run within a line. `color` is a CSS custom property reference. */
export interface SyntaxToken {
  text: string;
  color: string | null;
}

/**
 * Lines per file above which highlighting is skipped.
 *
 * Highlighting runs before a diff is shown, so it must never be the reason a
 * file feels slow to open. A diff this large is being skimmed, not read.
 */
const MAX_HIGHLIGHTED_LINES = 20000;

const cache = new WeakMap<DiffHunk, Map<number, SyntaxToken[]>>();

/** Tokens for a hunk's lines, or undefined if it was never highlighted. */
export function tokensForHunk(hunk: DiffHunk): Map<number, SyntaxToken[]> | undefined {
  return cache.get(hunk);
}

/** Whole-file tokens, by line number, for each side that exists. */
interface FileTokens {
  original: Map<number, SyntaxToken[]> | null;
  working: Map<number, SyntaxToken[]> | null;
}

const fileCache = new WeakMap<FileText, FileTokens>();

/**
 * Tokens for a line of the working file, for context the reader expanded.
 *
 * Expansion only ever happens on the working side: gaps are the lines a hunk
 * left out, and a file with no working side (a deletion) has no gaps, because
 * its diff covers all of it.
 */
export function tokensForContextLine(
  text: FileText,
  lineNumber: number,
): SyntaxToken[] | undefined {
  return fileCache.get(text)?.working?.get(lineNumber);
}

let highlighter: Promise<HighlighterCore> | null = null;

function core(): Promise<HighlighterCore> {
  const existing = highlighter;
  if (existing !== null) return existing;

  const created = createHighlighterCore({
    themes: [syntaxTheme],
    langs: [],
    // The JavaScript engine rather than the Oniguruma one: it handles every
    // grammar in `languages.ts`, and skips shipping and instantiating a WASM
    // binary to do it. `forgiving` drops the rare pattern it cannot compile
    // instead of failing the whole grammar.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });

  highlighter = created;
  return created;
}

/** One load per grammar, however many files ask for it at once. */
const grammars = new Map<string, Promise<boolean>>();

function ensureGrammar(language: string): Promise<boolean> {
  const existing = grammars.get(language);
  if (existing !== undefined) return existing;

  const loading = (async () => {
    const loader = grammarLoader(language);
    if (loader === undefined) return false;

    const [highlighterCore, grammar] = await Promise.all([core(), loader()]);
    await highlighterCore.loadLanguage(
      grammar.default as Parameters<HighlighterCore['loadLanguage']>[0],
    );
    return true;
  })();

  grammars.set(language, loading);
  return loading;
}

/**
 * Highlights one side of a hunk.
 *
 * `indices` says which of the hunk's lines this side contains, so the tokens
 * come back attached to the right rows.
 */
function highlightSide(
  highlighterCore: HighlighterCore,
  language: string,
  lines: string[],
  indices: number[],
  into: Map<number, SyntaxToken[]>,
): void {
  const { tokens } = highlighterCore.codeToTokens(lines.join('\n'), {
    lang: language,
    theme: SYNTAX_THEME_NAME,
  });

  // Shiki splits on newlines, so this should always hold. If a grammar ever
  // makes it not hold, uncoloured lines beat misaligned ones.
  if (tokens.length !== indices.length) return;

  tokens.forEach((lineTokens, position) => {
    into.set(
      indices[position],
      lineTokens.map((token) => ({
        text: token.content,
        color: token.color ?? null,
      })),
    );
  });
}

/** Tokenises one complete side, keyed by its line numbers. */
function tokeniseFileSide(
  highlighterCore: HighlighterCore,
  language: string,
  lines: string[],
): Map<number, SyntaxToken[]> {
  const byLine = new Map<number, SyntaxToken[]>();
  if (lines.length === 0) return byLine;

  const { tokens } = highlighterCore.codeToTokens(lines.join('\n'), {
    lang: language,
    theme: SYNTAX_THEME_NAME,
  });

  tokens.forEach((lineTokens, index) => {
    byLine.set(
      index + 1,
      lineTokens.map((token) => ({ text: token.content, color: token.color ?? null })),
    );
  });

  return byLine;
}

/** The side a diff line was read from, and its line number there. */
function sourceOf(
  line: DiffLine,
  tokens: FileTokens,
): Map<number, SyntaxToken[]> | null {
  return line.kind === 'delete' ? tokens.original : tokens.working;
}

function lineNumberOf(line: DiffLine): number | null {
  return line.kind === 'delete' ? line.oldLineNumber : line.newLineNumber;
}

/**
 * Colours a diff from its files rather than from its hunks.
 *
 * The hunk cache is still what the rows read, so nothing downstream has to
 * know which path produced it — this just fills it from better tokens.
 */
function highlightFromText(
  highlighterCore: HighlighterCore,
  language: string,
  diff: FileDiff,
  text: FileText,
): void {
  const tokens: FileTokens = {
    original:
      text.original === null
        ? null
        : tokeniseFileSide(highlighterCore, language, text.original),
    working:
      text.working === null
        ? null
        : tokeniseFileSide(highlighterCore, language, text.working),
  };

  fileCache.set(text, tokens);

  for (const hunk of diff.hunks) {
    const byIndex = new Map<number, SyntaxToken[]>();

    hunk.lines.forEach((line, index) => {
      const side = sourceOf(line, tokens);
      const number = lineNumberOf(line);
      const lineTokens =
        side === null || number === null ? undefined : side.get(number);

      if (lineTokens !== undefined) byIndex.set(index, lineTokens);
    });

    cache.set(hunk, byIndex);
  }
}

function highlightHunk(
  highlighterCore: HighlighterCore,
  language: string,
  hunk: DiffHunk,
): void {
  const oldIndices: number[] = [];
  const newIndices: number[] = [];

  hunk.lines.forEach((line, index) => {
    if (line.kind !== 'add') oldIndices.push(index);
    if (line.kind !== 'delete') newIndices.push(index);
  });

  const tokens = new Map<number, SyntaxToken[]>();
  const hasDeletions = oldIndices.length !== hunk.lines.length;
  const hasAdditions = newIndices.length !== hunk.lines.length;

  // A hunk with changes on one side only is one program, not two: tokenise it
  // once. The new side goes last so context lines take their colours from it,
  // which is the side the reader is looking at.
  if (hasDeletions) {
    highlightSide(
      highlighterCore,
      language,
      oldIndices.map((index) => hunk.lines[index].content),
      oldIndices,
      tokens,
    );
  }

  if (hasAdditions || !hasDeletions) {
    highlightSide(
      highlighterCore,
      language,
      newIndices.map((index) => hunk.lines[index].content),
      newIndices,
      tokens,
    );
  }

  cache.set(hunk, tokens);
}

/**
 * Highlights a freshly loaded diff, before it is shown.
 *
 * Never rejects and never throws: a missing grammar, an unhighlightable file
 * or a broken tokeniser all end the same way, with the diff rendering
 * uncoloured. Highlighting is a nicety and must not cost anyone their diff.
 */
export async function prepareSyntax(
  diff: FileDiff,
  text: FileText | null,
): Promise<void> {
  try {
    if (diff.binary || diff.truncated || diff.hunks.length === 0) return;

    const language = languageForPath(diff.path);
    if (language === null) return;

    const lines = diff.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
    if (text === null && lines > MAX_HIGHLIGHTED_LINES) return;

    if (!(await ensureGrammar(language))) return;

    const highlighterCore = await core();

    if (text !== null) {
      highlightFromText(highlighterCore, language, diff, text);
      return;
    }

    for (const hunk of diff.hunks) {
      highlightHunk(highlighterCore, language, hunk);
    }
  } catch (thrown) {
    console.error(`[difftrek] highlighting ${diff.path} failed`, thrown);
  }
}
