/**
 * The layout the unit tests cannot see.
 *
 * Everything else here runs under jsdom, which has no layout engine: every
 * element is zero by zero, so a bug that makes the document zero pixels wide is
 * invisible to it. One did exactly that — `useElementSize` measured nothing and
 * reported zero forever, which two fallbacks hid until the split view depended
 * on the width alone — and no amount of unit testing would have caught it.
 *
 * So this builds the app, serves it, and drives a real browser against the
 * built-in sample, asserting the handful of geometric facts everything else
 * rests on. It needs a browser binary, which is why it is not part of
 * `pnpm test`:
 *
 *     npx playwright install chromium
 *     pnpm test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { build, preview } from 'vite';
import type { PreviewServer } from 'vite';

interface Geometry {
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  rowCount: number;
  /** Widths of the line rows currently rendered. */
  rowWidths: number[];
  splitRows: number;
  unifiedRows: number;
  paneWidths: number[];
}

let server: PreviewServer;
let browser: Browser;
let page: Page;
const pageErrors: string[] = [];

/** Reads the document's geometry from the live page. */
async function geometry(): Promise<Geometry> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[role="region"]');
    const canvas = viewport?.firstElementChild as HTMLElement | undefined;
    const width = (el: Element) => Math.round(el.getBoundingClientRect().width);
    const lineRows = [...document.querySelectorAll('[data-row]')];

    return {
      viewportWidth: viewport?.clientWidth ?? 0,
      viewportHeight: viewport?.clientHeight ?? 0,
      canvasWidth: canvas === undefined ? 0 : width(canvas),
      rowCount: document.querySelectorAll('[role="row"]').length,
      rowWidths: lineRows.map(width),
      splitRows: document.querySelectorAll('[data-row="split"]').length,
      unifiedRows: document.querySelectorAll('[data-row="line"]').length,
      paneWidths: [...document.querySelectorAll('[data-side]')].map(width),
    };
  });
}

beforeAll(async () => {
  await build({ logLevel: 'warn' });
  server = await preview({
    preview: { port: 4183, strictPort: true },
    logLevel: 'warn',
  });

  browser = await chromium.launch({
    // An escape hatch for images that ship their own Chromium rather than
    // Playwright's; unset, Playwright finds the one it installed.
    executablePath: process.env.DIFFTREK_CHROMIUM,
  });

  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const url = server.resolvedUrls?.local[0] ?? 'http://localhost:4183/';
  await page.goto(url);

  // The sample answers with a deliberate delay, so wait for a document rather
  // than for a number of milliseconds.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-row]').length > 4,
    undefined,
    { timeout: 15000 },
  );
}, 180000);

afterAll(async () => {
  await browser?.close();
  server?.httpServer.close();
});

describe('the document fills its viewport', () => {
  it('is running against a real window', async () => {
    // Not a regression guard — the browser always reports these honestly.
    // It is here so that a broken harness fails as a broken harness, rather
    // than as a puzzling failure in the assertions below.
    const { viewportWidth, viewportHeight } = await geometry();

    expect(viewportWidth).toBe(1400);
    expect(viewportHeight).toBeGreaterThan(0);
  });

  it('never leaves the canvas narrower than the viewport', async () => {
    // This is the regression guard. The browser's own `clientWidth` is not
    // what is under test — the width the app *derived* from it is, and when
    // that measurement silently returned zero this read 626 against 1400.
    const { canvasWidth, viewportWidth } = await geometry();

    expect(canvasWidth).toBeGreaterThanOrEqual(viewportWidth);
  });

  it('draws every row the full width of the canvas', async () => {
    // A row narrower than the canvas means its background stops short of the
    // edge, which is how a zero-width canvas first shows itself.
    const { rowWidths, canvasWidth } = await geometry();

    expect(rowWidths.length).toBeGreaterThan(0);
    for (const width of rowWidths) expect(width).toBe(canvasWidth);
  });
});

describe('switching view mode', () => {
  it('starts unified', async () => {
    const { unifiedRows, splitRows } = await geometry();
    expect(unifiedRows).toBeGreaterThan(0);
    expect(splitRows).toBe(0);
  });

  it('splits into two panes of equal width', async () => {
    await page.getByRole('button', { name: 'Split view' }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-row="split"]').length > 0,
    );

    const { splitRows, unifiedRows, paneWidths, canvasWidth, viewportWidth } =
      await geometry();

    expect(splitRows).toBeGreaterThan(0);
    expect(unifiedRows).toBe(0);
    expect(canvasWidth).toBe(viewportWidth);

    // Two panes per row, each half the width give or take the divider.
    expect(paneWidths.length).toBe(splitRows * 2);
    for (const width of paneWidths) {
      expect(width).toBeGreaterThan(0);
      expect(Math.abs(width - (viewportWidth - 1) / 2)).toBeLessThanOrEqual(1);
    }
  });

  it('goes back to unified', async () => {
    await page.getByRole('button', { name: 'Unified view' }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-row="line"]').length > 0,
    );

    const { splitRows, rowWidths, canvasWidth } = await geometry();
    expect(splitRows).toBe(0);
    for (const width of rowWidths) expect(width).toBe(canvasWidth);
  });
});

describe('the page itself', () => {
  it('raises no errors while all that happens', () => {
    expect(pageErrors).toEqual([]);
  });
});
