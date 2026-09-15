/**
 * Measuring the row geometry the virtualiser depends on.
 *
 * Row heights must be exact, not estimated: the whole scroll model — total
 * height, binary search by offset, scroll-to-hunk — is arithmetic over them.
 * So they are measured once from the real rendered font rather than assumed,
 * which also means changing the font size in CSS needs no matching change in
 * TypeScript.
 */

import { useEffect, useState } from 'react';
import type { RowMetrics } from '../lib/rows.ts';

/** Used until the first measurement lands; replaced on the first frame. */
const FALLBACK: RowMetrics = {
  lineHeight: 20,
  fileHeaderHeight: 38,
  noticeHeight: 44,
  placeholderHeight: 44,
  fileGap: 16,
  charWidth: 7.8,
  gutterWidth: 104,
};

/** Reads a CSS custom property from the document root as a number of pixels. */
function readPixels(styles: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = Number.parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Measures the width of one monospace character.
 *
 * A long run is measured and divided, so sub-pixel advance widths do not
 * accumulate error over a long line.
 */
function measureCharWidth(fontShorthand: string, fallback: number): number {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'pre';
  probe.style.font = fontShorthand;
  probe.textContent = '0'.repeat(100);

  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 100;
  probe.remove();

  return width > 0 ? width : fallback;
}

export function useRowMetrics(): RowMetrics {
  const [metrics, setMetrics] = useState<RowMetrics>(FALLBACK);

  useEffect(() => {
    const measure = (): void => {
      const styles = getComputedStyle(document.documentElement);

      const fontSize = readPixels(styles, '--code-font-size', 12);
      const fontFamily =
        styles.getPropertyValue('--font-mono').trim() || 'monospace';

      setMetrics({
        lineHeight: readPixels(styles, '--row-height', FALLBACK.lineHeight),
        fileHeaderHeight: readPixels(
          styles,
          '--file-header-height',
          FALLBACK.fileHeaderHeight,
        ),
        noticeHeight: readPixels(styles, '--notice-height', FALLBACK.noticeHeight),
        placeholderHeight: readPixels(
          styles,
          '--placeholder-height',
          FALLBACK.placeholderHeight,
        ),
        fileGap: readPixels(styles, '--file-gap', FALLBACK.fileGap),
        charWidth: measureCharWidth(
          `${fontSize}px ${fontFamily}`,
          FALLBACK.charWidth,
        ),
        gutterWidth: readPixels(styles, '--gutter-width', FALLBACK.gutterWidth),
      });
    };

    measure();

    // Webfonts land after first paint and change the character width.
    if ('fonts' in document) {
      void document.fonts.ready.then(measure);
    }

    return undefined;
  }, []);

  return metrics;
}
