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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useElementSize } from '../../hooks/useElementSize.ts';
import { offsetOfTarget, rowKey, visibleRange } from '../../lib/rows.ts';
import type { RowMetrics, RowModel } from '../../lib/rows.ts';
import { runsForContextLine, runsForLine } from '../../lib/rowRuns.ts';
import type {
  ChangeLocation,
  DiffHunk,
  DocumentFile,
  LineRange,
} from '../../types/index.ts';
import { DiffLineRow } from './DiffLineRow.tsx';
import { ExpanderRow } from './ExpanderRow.tsx';
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
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const { height: measuredHeight, width: viewportWidth } = useElementSize(viewportRef);

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
    const viewport = viewportRef.current;
    if (viewport === null || current === null) return;

    const key = `${current.fileId}|${current.hunkId ?? ''}`;
    if (lastRevealed.current === key) return;

    const offset = offsetOfTarget(model, current.fileId, current.hunkId);
    if (offset === null) return;

    lastRevealed.current = key;
    // Clear the sticky file header as well, or the change lands underneath it.
    viewport.scrollTop = Math.max(
      0,
      offset - metrics.fileHeaderHeight - SCROLL_MARGIN,
    );
    setScrollTop(viewport.scrollTop);
  }, [current, model, metrics.fileHeaderHeight]);

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
  const canvasWidth = Math.max(model.contentWidth, viewportWidth);

  const stickyFile = visibleFile === null ? null : fileById.get(visibleFile) ?? null;

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

        rendered.push(
          <DiffLineRow
            key={key}
            style={style}
            line={{
              kind: 'context',
              content: text.working?.[row.lineNumber - 1] ?? '',
              oldLineNumber: row.oldLineNumber,
              newLineNumber: row.lineNumber,
              noNewline: false,
            }}
            runs={runsForContextLine(text, row.lineNumber)}
            wrapColumn={wrapColumn}
            active={false}
          />,
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
        ref={viewportRef}
        className={styles.viewport}
        onScroll={handleScroll}
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
