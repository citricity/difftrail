/**
 * The continuous diff document.
 *
 * Every changed file appears in one vertically scrolling page. Underneath, the
 * DOM only ever holds the rows in view plus a little overscan — but that is an
 * implementation detail the reader never sees, and crucially it is *not* where
 * navigation gets its answers from. Next/Previous Change resolve against the
 * logical model (`RowModel`, built from the diff), then ask this component to
 * reveal the result.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement } from 'react';
import { useElementSize } from '../../hooks/useElementSize.ts';
import {
  anchorAt,
  lineAreaWidth,
  offsetOfAnchor,
  offsetOfTarget,
  rowKey,
  visibleRange,
} from '../../lib/rows.ts';
import type { RowMetrics, RowModel } from '../../lib/rows.ts';
import { runsForContextLine, runsForLine } from '../../lib/rowRuns.ts';
import type {
  ChangeLocation,
  DiffHunk,
  DocumentFile,
  LineRange,
  ViewMode,
} from '../../types/index.ts';
import { DiffLineRow } from './DiffLineRow.tsx';
import { ExpanderRow } from './ExpanderRow.tsx';
import { PaneScrollbar } from './PaneScrollbar.tsx';
import { SplitLineRow } from './SplitLineRow.tsx';
import type { PaneLine } from './SplitLineRow.tsx';
import { FileHeaderRow } from './FileHeaderRow.tsx';
import { HunkHeaderRow } from './HunkHeaderRow.tsx';
import { NoticeRow } from './NoticeRow.tsx';
import styles from './DiffDocument.module.css';
import rowStyles from './DiffRows.module.css';

/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN = 12;

/** Breathing room above a revealed change, on top of the sticky file header. */
const SCROLL_MARGIN = 8;

interface Props {
  files: DocumentFile[];
  model: RowModel;
  metrics: RowMetrics;
  /** True until the changed-file list has arrived. */
  loading: boolean;
  current: ChangeLocation | null;
  onSelect: (location: ChangeLocation) => void;
  onVisibleFileChange: (fileId: string) => void;
  onToggleCollapse: (fileId: string) => void;
  onLoadFully: (fileId: string) => void;
  onExpandContext: (fileId: string, range: LineRange) => void;
  /** Column long lines wrap at, or null to scroll them horizontally. */
  wrapColumn: number | null;
  viewMode: ViewMode;
  /**
   * Told the viewport's width whenever it changes, so auto wrapping can fit
   * lines to it. Called as often as the size changes; any rate-limiting is the
   * receiver's business.
   */
  onViewportWidthChange?: (width: number) => void;
}

export function DiffDocument({
  files,
  model,
  metrics,
  loading,
  current,
  onSelect,
  onVisibleFileChange,
  onToggleCollapse,
  onLoadFully,
  onExpandContext,
  wrapColumn,
  viewMode,
  onViewportWidthChange,
}: Props) {
  /**
   * The scrolling element, held twice on purpose.
   *
   * `useElementSize` has to re-run when the element appears, and it does not
   * appear on the first render — the loading state is shown until the file list
   * arrives — so the measurement needs it as state. Setting `scrollTop` is a
   * mutation, which belongs on a ref rather than on a value captured from
   * render scope.
   */
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);

  const attachViewport = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    setViewport(node);
  }, []);

  const [scrollTop, setScrollTop] = useState(0);
  /**
   * The viewport's scroll position as of the last scroll event, updated
   * synchronously rather than once a frame like `scrollTop`.
   *
   * Anchoring across a rebuild has to know where the reader was *before* the
   * new model was committed. By the time a layout effect runs, the canvas has
   * already taken its new height, and if that is shorter the browser may have
   * clamped the element's own `scrollTop` — so it cannot be asked.
   */
  const liveScrollTop = useRef(0);
  /**
   * How far the split view's panes are scrolled sideways.
   *
   * Only the split view needs this. The unified view's viewport scrolls
   * horizontally itself, but two panes cannot share one scroller without
   * scrolling out of step, so here the offset is state and the panes translate.
   */
  const [paneOffset, setPaneOffset] = useState(0);
  const split = viewMode === 'split';
  const { height: measuredHeight, width: viewportWidth } = useElementSize(viewport);

  useEffect(() => {
    if (viewportWidth > 0) onViewportWidthChange?.(viewportWidth);
  }, [viewportWidth, onViewportWidthChange]);

  /**
   * A measured height of zero would render overscan and nothing else, which
   * looks exactly like a document that stops halfway down. Over-rendering for
   * one frame is the cheaper mistake, so fall back to the window height.
   */
  const viewportHeight =
    measuredHeight > 0
      ? measuredHeight
      : typeof window === 'undefined'
        ? 0
        : window.innerHeight;

  const fileById = useMemo(() => {
    const map = new Map<string, DocumentFile>();
    for (const file of files) map.set(file.meta.id, file);
    return map;
  }, [files]);

  const hunkById = useMemo(() => {
    const map = new Map<string, DiffHunk>();
    for (const file of files) {
      for (const hunk of file.diff?.hunks ?? []) map.set(hunk.id, hunk);
    }
    return map;
  }, [files]);

  // Scroll events fire faster than frames; collapsing them to one state update
  // per frame keeps a fast flick from queueing dozens of renders.
  const frame = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    liveScrollTop.current = viewportRef.current?.scrollTop ?? 0;
    if (frame.current !== null) return;

    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setScrollTop(viewportRef.current?.scrollTop ?? 0);
    });
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  /**
   * Reveals the current change.
   *
   * When the target's file has not loaded, `offsetOfTarget` returns null and
   * nothing happens — but the model changes as soon as the diff arrives, this
   * effect runs again, and the scroll lands then. That is the whole of the
   * "ensure loaded, then reveal" step.
   *
   * The key guard stops an unrelated model rebuild (another file finishing in
   * the background) from yanking the view back to where it already is.
   */
  const lastRevealed = useRef<string | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null || current === null) return;

    const key = `${current.fileId}|${current.hunkId ?? ''}`;
    if (lastRevealed.current === key) return;

    const offset = offsetOfTarget(model, current.fileId, current.hunkId);
    if (offset === null) return;

    lastRevealed.current = key;
    // Clear the sticky file header as well, or the change lands underneath it.
    element.scrollTop = Math.max(0, offset - metrics.fileHeaderHeight - SCROLL_MARGIN);
    liveScrollTop.current = element.scrollTop;
    setScrollTop(element.scrollTop);
  }, [current, model, metrics.fileHeaderHeight, viewport]);

  /**
   * Keeps the reader's place when the wrap column changes.
   *
   * A new column changes the height of every wrapped line, including all the
   * ones above the viewport, so an unchanged `scrollTop` would show a different
   * part of the document — and in auto mode that happens continuously while
   * the window is resized. So the row at the top of the viewport is found in
   * the model being replaced and put back at the top in the new one.
   *
   * A layout effect, so the correction lands before paint and the jump is
   * never seen. Limited to column changes: other rebuilds (a diff arriving, a
   * file collapsing) have their own expectations about where the view goes.
   */
  const previousLayout = useRef({ model, wrapColumn });

  useLayoutEffect(() => {
    const before = previousLayout.current;
    previousLayout.current = { model, wrapColumn };

    const element = viewportRef.current;
    if (
      element === null ||
      before.model === model ||
      before.wrapColumn === wrapColumn
    ) {
      return;
    }

    const anchor = anchorAt(before.model, liveScrollTop.current);
    if (anchor === null) return;

    const restored = offsetOfAnchor(model, anchor);
    if (restored === null) return;

    element.scrollTop = restored;
    liveScrollTop.current = element.scrollTop;
    setScrollTop(element.scrollTop);
  }, [model, wrapColumn]);

  // Let the loader know which part of the document is being read, so it can
  // fetch the neighbouring diffs before they are scrolled into view.
  const visibleFile = useMemo(() => {
    if (model.rows.length === 0) return null;
    const range = visibleRange(model, scrollTop, viewportHeight, 0);
    return model.rows[range.start]?.fileId ?? null;
  }, [model, scrollTop, viewportHeight]);

  useEffect(() => {
    if (visibleFile !== null) onVisibleFileChange(visibleFile);
  }, [visibleFile, onVisibleFileChange]);

  const range = visibleRange(model, scrollTop, viewportHeight, OVERSCAN);

  // A pane is half the viewport less the divider; in the unified view the
  // canvas is as wide as the content and the viewport scrolls over it.
  const paneWidth = lineAreaWidth(viewportWidth, 'split');
  const paneOverflow = Math.max(0, model.contentWidth - paneWidth);
  const canvasWidth = split
    ? viewportWidth
    : Math.max(model.contentWidth, viewportWidth);

  // Clamp on every render rather than only when panning: narrowing the window
  // or turning wrapping on can leave the offset past the end.
  const offset = Math.min(paneOffset, paneOverflow);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!split) return;

      // Trackpads report sideways scrolling as deltaX; a mouse wheel with
      // shift held reports it as deltaY, and both should pan the panes.
      const sideways = event.shiftKey ? event.deltaY : event.deltaX;
      if (sideways === 0 || Math.abs(sideways) < Math.abs(event.deltaY) * 0.5) {
        if (!event.shiftKey) return;
      }

      setPaneOffset((previous) =>
        Math.min(paneOverflow, Math.max(0, previous + sideways)),
      );
    },
    [paneOverflow, split],
  );

  const stickyFile = visibleFile === null ? null : (fileById.get(visibleFile) ?? null);

  // Two layers: rows that scroll with the canvas on both axes, and the
  // full-width bars, which stay put horizontally (see `.pinned`).
  const rendered: ReactElement[] = [];
  const pinned: ReactElement[] = [];

  for (let index = range.start; index < range.end; index += 1) {
    const row = model.rows[index];
    const file = fileById.get(row.fileId);
    if (file === undefined) continue;

    const style = { top: model.offsets[index] };
    const key = rowKey(row);

    switch (row.kind) {
      case 'file-header':
        pinned.push(
          <FileHeaderRow
            key={key}
            style={style}
            file={file}
            active={current?.fileId === file.meta.id && current.hunkId === null}
            onToggleCollapse={() => onToggleCollapse(file.meta.id)}
          />,
        );
        break;

      case 'hunk-header': {
        const hunk = hunkById.get(row.hunkId);
        if (hunk === undefined) break;

        rendered.push(
          <HunkHeaderRow
            key={key}
            style={style}
            hunk={hunk}
            active={current?.hunkId === hunk.id}
            onSelect={() => onSelect({ fileId: row.fileId, hunkId: hunk.id })}
          />,
        );
        break;
      }

      case 'split-line': {
        const hunk = hunkById.get(row.hunkId);
        if (hunk === undefined) break;

        const pane = (index: number | null): PaneLine | null =>
          index === null
            ? null
            : { line: hunk.lines[index], runs: runsForLine(hunk, index) };

        rendered.push(
          <SplitLineRow
            key={key}
            style={style}
            left={pane(row.left)}
            right={pane(row.right)}
            wrapColumn={wrapColumn}
            offset={offset}
            active={current?.hunkId === hunk.id}
          />,
        );
        break;
      }

      case 'line': {
        const hunk = hunkById.get(row.hunkId);
        const line = hunk?.lines[row.lineIndex];
        if (hunk === undefined || line === undefined) break;

        rendered.push(
          <DiffLineRow
            key={key}
            style={style}
            line={line}
            runs={runsForLine(hunk, row.lineIndex)}
            wrapColumn={wrapColumn}
            active={current?.hunkId === hunk.id}
          />,
        );
        break;
      }

      case 'expander':
        pinned.push(
          <ExpanderRow
            key={key}
            style={style}
            range={row.range}
            above={row.above}
            below={row.below}
            onExpand={(range) => onExpandContext(file.meta.id, range)}
          />,
        );
        break;

      case 'context': {
        const text = file.text;
        if (text === null) break;

        const line = {
          kind: 'context' as const,
          content: text.working?.[row.lineNumber - 1] ?? '',
          oldLineNumber: row.oldLineNumber,
          newLineNumber: row.lineNumber,
          noNewline: false,
        };
        const runs = runsForContextLine(text, row.lineNumber);

        // Unchanged context exists on both sides, so in the split view it
        // shows on both — with each pane's own line number.
        rendered.push(
          split ? (
            <SplitLineRow
              key={key}
              style={style}
              left={{ line, runs }}
              right={{ line, runs }}
              wrapColumn={wrapColumn}
              offset={offset}
              active={false}
            />
          ) : (
            <DiffLineRow
              key={key}
              style={style}
              line={line}
              runs={runs}
              wrapColumn={wrapColumn}
              active={false}
            />
          ),
        );
        break;
      }

      case 'notice':
        pinned.push(
          <NoticeRow
            key={key}
            style={style}
            file={file}
            notice={row.notice}
            onLoadFully={() => onLoadFully(file.meta.id)}
            onExpand={() => onToggleCollapse(file.meta.id)}
          />,
        );
        break;

      case 'placeholder':
        pinned.push(
          <div
            key={key}
            style={style}
            className={`${rowStyles.row} ${rowStyles.placeholder}`}
            aria-label={`Loading ${file.meta.path}`}
          >
            <span className={rowStyles.shimmer} />
          </div>,
        );
        break;

      case 'spacer':
        break;
    }
  }

  if (model.rows.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          {loading ? (
            <span>Reading the working tree…</span>
          ) : (
            <>
              <span className={styles.emptyTitle}>No unstaged changes</span>
              <span>Every tracked file matches the index.</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div
        ref={attachViewport}
        className={
          split ? `${styles.viewport} ${styles.viewportSplit}` : styles.viewport
        }
        onScroll={handleScroll}
        onWheel={handleWheel}
        tabIndex={0}
        role="region"
        aria-label="Repository diff"
      >
        <div
          className={styles.canvas}
          style={{ height: model.totalHeight, width: canvasWidth }}
        >
          {rendered}

          <div
            className={styles.pinned}
            style={{ width: viewportWidth > 0 ? viewportWidth : '100%' }}
          >
            {pinned}
          </div>
        </div>
      </div>

      {split && (
        <PaneScrollbar
          contentWidth={model.contentWidth}
          visibleWidth={paneWidth}
          offset={offset}
          onScroll={setPaneOffset}
        />
      )}

      {stickyFile !== null && (
        <div className={styles.stickyFile}>
          <FileHeaderRow
            file={stickyFile}
            active={false}
            onToggleCollapse={() => onToggleCollapse(stickyFile.meta.id)}
          />
        </div>
      )}
    </div>
  );
}
