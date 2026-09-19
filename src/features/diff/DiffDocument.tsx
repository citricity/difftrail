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
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useElementSize } from '../../hooks/useElementSize.ts';
import {
  SCROLL_MARGIN,
  anchorAt,
  endOfDocumentHeight,
  lineAreaWidth,
  offsetOfAnchor,
  offsetOfTarget,
  rowAtOffset,
  rowKey,
  visibleRange,
} from '../../lib/rows.ts';
import type { RowMetrics, RowModel } from '../../lib/rows.ts';
import { runsForContextLine, runsForLine } from '../../lib/rowRuns.ts';
import { buildNavigationIndex, sameLocation } from '../../lib/navigation.ts';
import type { NavigationFilter } from '../../lib/navigation.ts';
import {
  buildScrollStops,
  changeInView,
  followedStopReplaced,
} from '../../lib/scrollFollow.ts';
import type {
  ChangeLocation,
  DiffHunk,
  DocumentFile,
  LineRange,
  ViewMode,
} from '../../types/index.ts';
import { DiffLineRow } from './DiffLineRow.tsx';
import { EndOfDocument } from './EndOfDocument.tsx';
import { SESSION_IDLE_MASCOT } from './mascots.ts';
import { ExpanderRow } from './ExpanderRow.tsx';
import { PaneScrollbar } from './PaneScrollbar.tsx';
import { SplitLineRow } from './SplitLineRow.tsx';
import type { PaneLine } from './SplitLineRow.tsx';
import { FileHeaderRow } from './FileHeaderRow.tsx';
import type { FileListAnchor } from './FileHeaderRow.tsx';
import { FileNavigator } from '../files/FileNavigator.tsx';
import { HunkHeaderRow } from './HunkHeaderRow.tsx';
import { HunkNoteIcon, LogicalBadges } from './NoteMarkers.tsx';
import { buildNoteMarkers } from '../../lib/noteMarkers.ts';
import type { HunkMarkers } from '../../lib/noteMarkers.ts';
import type { DocumentNotes } from '../../hooks/useAiChangelog.ts';
import { ImageRow } from './ImageRow.tsx';
import { NoticeRow } from './NoticeRow.tsx';
import styles from './DiffDocument.module.css';
import rowStyles from './DiffRows.module.css';

/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN = 12;

interface Props {
  files: DocumentFile[];
  model: RowModel;
  metrics: RowMetrics;
  /** True until the changed-file list has arrived. */
  loading: boolean;
  /**
   * The commit or range being shown, as typed; null for the working tree;
   * undefined until the repository has resolved and it is not yet known.
   * Only the loading and empty states need to know.
   */
  comparison?: string | null;
  current: ChangeLocation | null;
  /**
   * Bumped when the view must be brought to `current` even though it has not
   * changed — see `DiffNavigation.revealRequest`.
   */
  revealRequest: number;
  onSelect: (location: ChangeLocation) => void;
  /**
   * Told when the reader scrolls onto a different change, so the position
   * readout and Previous/Next carry on from what is in view. The document does
   * not reveal it — the reader is already looking at it.
   */
  onScrollToChange?: (location: ChangeLocation) => void;
  /** Go to a file chosen from the file list. */
  onSelectFile: (fileId: string) => void;
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
  /**
   * The AI changelog's notes for what is on screen, or null when there is no
   * changelog — which is the ordinary case, and the one where the gutter is
   * exactly as wide as it always was.
   */
  notes?: DocumentNotes | null;
  /**
   * Narrows what scrolling can land on, so that following the scroll agrees
   * with Previous/Next while a logical change is focused.
   */
  navigationFilter?: NavigationFilter;
}

export function DiffDocument({
  files,
  model,
  metrics,
  loading,
  comparison,
  current,
  revealRequest,
  onSelect,
  onScrollToChange,
  onSelectFile,
  onVisibleFileChange,
  onToggleCollapse,
  onLoadFully,
  onExpandContext,
  wrapColumn,
  viewMode,
  onViewportWidthChange,
  notes = null,
  navigationFilter,
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

  /**
   * Where each logical change's run of hunks starts and stops.
   *
   * Derived from the document's own order rather than from the changelog,
   * because that is the question being asked: a file that has not loaded has no
   * hunks here yet, and its markers appear when it does.
   */
  const noteMarkers = useMemo(() => {
    if (!notes) return new Map<string, HunkMarkers>();

    const order = model.rows
      .filter((row) => row.kind === 'hunk-header')
      .map((row) => row.hunkId);

    return buildNoteMarkers(order, notes.hunks);
  }, [model, notes]);

  const badgesFor = (hunk: DiffHunk, lineIndex: number): ReactNode => {
    const marks = noteMarkers.get(hunk.id);
    if (!notes || marks === undefined) return null;

    const starts = lineIndex === 0 ? marks.starts : [];
    const ends = lineIndex === hunk.lines.length - 1 ? marks.ends : [];
    if (starts.length === 0 && ends.length === 0) return null;

    return (
      <LogicalBadges
        starts={starts}
        ends={ends}
        labelOf={notes.labelOf}
        describe={notes.describe}
        onOpen={(change) => {
          notes.onOpenChange(change, hunk.id);
        }}
      />
    );
  };

  /**
   * Where the document last put `scrollTop` itself, until the scroll event that
   * causes arrives. Only the reader's own scrolling should move the current
   * change: a reveal already chose it, and one clamped at the end of the
   * document must not be second-guessed into the hunk above.
   */
  const assignedScrollTop = useRef<number | null>(null);
  /** Set by a scroll the reader made, cleared once the frame has followed it. */
  const readerScrolled = useRef(false);

  const assignScrollTop = useCallback((element: HTMLDivElement, value: number) => {
    element.scrollTop = value;
    assignedScrollTop.current = element.scrollTop;
    liveScrollTop.current = element.scrollTop;
    setScrollTop(element.scrollTop);
  }, []);

  const lastRevealed = useRef<string | null>(null);
  /** The location following last handed to navigation, until a reveal. */
  const followed = useRef<ChangeLocation | null>(null);

  const stops = useMemo(
    () => buildScrollStops(model, buildNavigationIndex(files, navigationFilter)),
    [model, files, navigationFilter],
  );

  /**
   * What following the scroll needs, as of the latest render. Read from the
   * animation frame, which would otherwise see the values of whichever render
   * created the scroll handler.
   */
  const follow = useRef({
    stops,
    current,
    revealRequest,
    viewportHeight: 0,
    fileHeaderHeight: metrics.fileHeaderHeight,
    onScrollToChange,
  });

  const followScroll = useCallback((top: number) => {
    const latest = follow.current;
    if (latest.onScrollToChange === undefined) return;

    const location = changeInView(
      latest.stops,
      top + latest.fileHeaderHeight + SCROLL_MARGIN,
      top + latest.viewportHeight,
    );
    if (location === null || sameLocation(location, latest.current)) return;

    // Mark it revealed, or the reveal effect would scroll it to the reading
    // line — pulling the view out from under the reader.
    lastRevealed.current = `${location.fileId}|${location.hunkId ?? ''}|${latest.revealRequest}`;
    followed.current = location;
    latest.onScrollToChange(location);
  }, []);

  // Scroll events fire faster than frames; collapsing them to one state update
  // per frame keeps a fast flick from queueing dozens of renders.
  const frame = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    const top = viewportRef.current?.scrollTop ?? 0;
    liveScrollTop.current = top;

    const assigned = assignedScrollTop.current;
    assignedScrollTop.current = null;
    if (assigned === null || Math.abs(top - assigned) >= 1)
      readerScrolled.current = true;

    if (frame.current !== null) return;

    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const latest = viewportRef.current?.scrollTop ?? 0;
      setScrollTop(latest);

      if (readerScrolled.current) {
        readerScrolled.current = false;
        followScroll(latest);
      }
    });
  }, [followScroll]);

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
  useEffect(() => {
    const element = viewportRef.current;
    if (element === null || current === null) return;

    const key = `${current.fileId}|${current.hunkId ?? ''}|${revealRequest}`;
    if (lastRevealed.current === key) return;

    const offset = offsetOfTarget(model, current.fileId, current.hunkId);
    if (offset === null) return;

    lastRevealed.current = key;
    followed.current = null;
    // A frame still waiting to follow a scroll made before this reveal would
    // otherwise follow the reveal instead.
    readerScrolled.current = false;
    // Clear the sticky file header as well, or the change lands underneath it.
    assignScrollTop(
      element,
      Math.max(0, offset - metrics.fileHeaderHeight - SCROLL_MARGIN),
    );
  }, [
    current,
    model,
    metrics.fileHeaderHeight,
    revealRequest,
    viewport,
    assignScrollTop,
  ]);

  /**
   * Keeps the reader's place whenever the model is rebuilt.
   *
   * Rows above the viewport change height all the time: a new wrap column
   * changes every wrapped line, continuously while an auto-wrapped window is
   * resized, and a diff arriving turns a one-row placeholder into a file's
   * worth of rows. With `scrollTop` left alone, each of those shows a different
   * part of the document. So the row at the top of the viewport is found in the
   * model being replaced and put back at the top in the new one.
   *
   * This used to run for wrap changes only, and the file list showed why that
   * was not enough: jumping to the last of many files landed correctly, then
   * the files above it loaded, pushed it down the page, and the prefetching
   * that followed the drift loaded the next ones up, and so on.
   *
   * A layout effect, so the correction lands before paint and is never seen.
   * It runs before the reveal effect, so a rebuild that also brings a new
   * navigation target is anchored first and then revealed.
   */
  const previousModel = useRef(model);

  useLayoutEffect(() => {
    const before = previousModel.current;
    previousModel.current = model;

    const element = viewportRef.current;
    if (element === null || before === model) return;

    const anchor = anchorAt(before, liveScrollTop.current);
    if (anchor === null) return;

    const restored = offsetOfAnchor(model, anchor);
    if (restored === null || Math.abs(restored - liveScrollTop.current) < 0.5) return;

    assignScrollTop(element, restored);
  }, [model, assignScrollTop]);

  // Let the loader know which part of the document is being read, so it can
  // fetch the neighbouring diffs before they are scrolled into view.
  //
  // Measured where a reveal puts its target — below the sticky file header and
  // its margin — rather than at the viewport's top edge, which the header
  // covers. At the edge it named the file above whenever a revealed change sat
  // a few pixels past a file boundary, which is exactly where a reveal puts
  // one; just under the header it still did for a revealed file header, whose
  // margin belongs to the file before.
  const visibleFile = useMemo(() => {
    if (model.rows.length === 0) return null;
    const row = rowAtOffset(
      model,
      scrollTop + metrics.fileHeaderHeight + SCROLL_MARGIN,
    );
    return model.rows[row]?.fileId ?? null;
  }, [model, scrollTop, metrics.fileHeaderHeight]);

  useEffect(() => {
    if (visibleFile !== null) onVisibleFileChange(visibleFile);
  }, [visibleFile, onVisibleFileChange]);

  useLayoutEffect(() => {
    follow.current = {
      stops,
      current,
      revealRequest,
      viewportHeight,
      fileHeaderHeight: metrics.fileHeaderHeight,
      onScrollToChange,
    };
  });

  /**
   * Works the current change out again when the file the scroll stopped on
   * finishes loading.
   *
   * Scrolling onto a file that has not loaded can only name the file. When its
   * diff arrives that stop is replaced by the file's hunks, and a location still
   * naming the file has no place in the sequence. The anchoring above has kept
   * the reader's place, so the reading line picks the hunk they are looking at.
   *
   * Only a stop following published is revisited, so a rebuild still never
   * cancels a pending Next or a jump from the file list.
   */
  useEffect(() => {
    if (!followedStopReplaced(followed.current, follow.current.current, stops)) return;
    followed.current = null;
    followScroll(liveScrollTop.current);
  }, [stops, followScroll]);

  const range = visibleRange(model, scrollTop, viewportHeight, OVERSCAN);
  const endHeight = endOfDocumentHeight(viewportHeight, metrics);

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

  /** Where the file list hangs from, or null while it is closed. */
  const [fileListAnchor, setFileListAnchor] = useState<FileListAnchor | null>(null);
  const closeFileList = useCallback(() => setFileListAnchor(null), []);
  const selectFile = useCallback(
    (fileId: string) => {
      setFileListAnchor(null);
      onSelectFile(fileId);
    },
    [onSelectFile],
  );

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
            note={
              notes ? (
                <HunkNoteIcon
                  state={notes.state(hunk.id)}
                  partial={notes.hunks[hunk.id]?.partial ?? false}
                  changeLabel={
                    notes.hunks[hunk.id]?.logicalChangeIds[0] === undefined
                      ? null
                      : notes.labelOf(notes.hunks[hunk.id].logicalChangeIds[0])
                  }
                  onOpen={() => notes.onOpenHunk(hunk.id)}
                />
              ) : null
            }
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
            notes={badgesFor(hunk, row.left ?? row.right ?? 0)}
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
            notes={badgesFor(hunk, row.lineIndex)}
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

      case 'image':
        // Pinned, like the other full-width bars: nothing in it scrolls sideways.
        if (file.diff !== null) {
          pinned.push(
            <ImageRow key={key} style={style} meta={file.meta} diff={file.diff} />,
          );
        }
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
            <span>
              {comparison === null ? 'Reading the working tree…' : 'Reading the diff…'}
            </span>
          ) : (
            <>
              {/* Only here, with nothing to review: a hedgehog with the day off. */}
              <span
                className={`${rowStyles.mascot} ${styles.emptyMascot}`}
                style={
                  { '--mascot-image': `url("${SESSION_IDLE_MASCOT}")` } as CSSProperties
                }
                aria-hidden="true"
              />
              {typeof comparison !== 'string' ? (
                <>
                  <span className={styles.emptyTitle}>No unstaged changes</span>
                  <span>Every tracked file matches the index.</span>
                </>
              ) : (
                <>
                  <span className={styles.emptyTitle}>No changes in {comparison}</span>
                  <span>Both sides of the comparison are identical.</span>
                </>
              )}
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
          style={{ height: model.totalHeight + endHeight, width: canvasWidth }}
        >
          {rendered}

          <div
            className={styles.pinned}
            style={{ width: viewportWidth > 0 ? viewportWidth : '100%' }}
          >
            {pinned}

            <EndOfDocument
              style={{ top: model.totalHeight, height: endHeight }}
              fileCount={files.length}
            />
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
            onOpenFileList={setFileListAnchor}
          />
        </div>
      )}

      {fileListAnchor !== null && (
        <FileNavigator
          files={files}
          currentFileId={stickyFile?.meta.id ?? null}
          anchor={fileListAnchor}
          onSelect={selectFile}
          onClose={closeFileList}
        />
      )}
    </div>
  );
}
