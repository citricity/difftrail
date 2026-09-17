/**
 * Diff Trek's syntax theme.
 *
 * Shiki does the parsing; the colours stay ours. Every scope below resolves to
 * a CSS custom property declared in `styles/tokens.css`, so the palette is part
 * of the same small design system as the diff greens and reds, switches with
 * `prefers-color-scheme` without re-tokenising anything, and can be retuned
 * without touching TypeScript.
 *
 * The scope groupings are modelled on VS Code's default Light+ and Dark+
 * themes, which is what makes the result read as familiar rather than merely
 * colourful. Ordering matters: TextMate resolves the most specific selector, so
 * the narrow rules at the end deliberately follow the broad ones they refine.
 *
 * Font styles are omitted on purpose — the VS Code defaults barely use them,
 * and italics in a dense diff are noise.
 */

import type { ThemeRegistration } from 'shiki/core';

const colour = (name: string): string => `var(--syntax-${name})`;

export const SYNTAX_THEME_NAME = 'difftrek';

export const syntaxTheme: ThemeRegistration = {
  name: SYNTAX_THEME_NAME,
  type: 'dark',
  colors: {
    'editor.foreground': colour('plain'),
    'editor.background': 'transparent',
  },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: colour('comment') },
    },
    {
      scope: ['string', 'punctuation.definition.string', 'string.template'],
      settings: { foreground: colour('string') },
    },
    {
      scope: ['constant.character.escape', 'string.regexp', 'constant.regexp'],
      settings: { foreground: colour('escape') },
    },
    {
      scope: ['constant.numeric', 'keyword.other.unit'],
      settings: { foreground: colour('number') },
    },
    {
      scope: ['keyword', 'storage', 'storage.type', 'constant.language'],
      settings: { foreground: colour('keyword') },
    },
    {
      scope: [
        'keyword.control',
        'keyword.operator.new',
        'keyword.operator.expression',
        'storage.modifier.flow',
      ],
      settings: { foreground: colour('control') },
    },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'meta.function-call.generic',
        'variable.function',
      ],
      settings: { foreground: colour('function') },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.name.namespace',
        'support.type',
        'support.class',
      ],
      settings: { foreground: colour('type') },
    },
    {
      scope: ['variable', 'meta.definition.variable.name', 'support.variable'],
      settings: { foreground: colour('variable') },
    },
    {
      scope: [
        'support.type.property-name',
        'meta.object-literal.key',
        'variable.other.property',
        'variable.other.member',
      ],
      settings: { foreground: colour('property') },
    },
    {
      scope: ['entity.name.tag', 'meta.tag'],
      settings: { foreground: colour('tag') },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: { foreground: colour('attribute') },
    },
    {
      // CSS selectors share the attribute-name scope but not its colour, in
      // VS Code's defaults or here.
      scope: [
        'entity.other.attribute-name.class',
        'entity.other.attribute-name.id',
        'entity.other.attribute-name.pseudo-class',
        'entity.other.attribute-name.pseudo-element',
      ],
      settings: { foreground: colour('selector') },
    },
    {
      scope: ['keyword.operator', 'punctuation'],
      settings: { foreground: colour('punctuation') },
    },
  ],
};
