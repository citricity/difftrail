import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { DiffLine } from '../../types/index.ts';
import type { LineRun } from '../../lib/runs.ts';
import { wrapRuns } from '../../lib/wrap.ts';
import styles from './DiffRows.module.css';

/** Shown where a line number would be on a wrapped continuation. */
const CONTINUATION = '↪';

export interface PaneLine {
  line: DiffLine;
  runs: LineRun[];
}

interface Props {
  /** The original-side line, or null to face the other side with a blank. */
  left: PaneLine | null;
  /** The working-side line, or null. */
  right: PaneLine | null;
  wrapColumn: number | null;
  /**
   * How far both panes are scrolled horizontally, in pixels.
   *
   * Shared rather than per-pane on purpose: the point of a split view is that
   * the same column is under your eye on both sides.
   */
  offset: number;
  active: boolean;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style: CSSProperties;
}

function Pane({
  side,
  entry,
  wrapColumn,
  offset,
}: {
  side: 'left' | 'right';
  entry: PaneLine | null;
  wrapColumn: number | null;
  offset: number;
}) {
  if (entry === null) {
    // Not "empty" but "absent": there is no line here to face the other side,
    // and that is worth saying visually rather than leaving a gap.
    return (
      <span
        className={`${styles.pane} ${styles.paneAbsent}`}
        data-side={side}
        data-absent="true"
        aria-hidden="true"
      />
    );
  }

  const { line, runs } = entry;
  const wrapped = wrapRuns(runs, wrapColumn);
  const number = side === 'left' ? line.oldLineNumber : line.newLineNumber;

  return (
    <span className={`${styles.pane} ${styles[line.kind]}`} data-side={side}>
      {wrapped.map((rowRuns, index) => (
        <span key={index} className={styles.visualLine}>
          <span className={styles.gutter} aria-hidden="true">
            <span className={styles.number}>{index === 0 ? (number ?? '') : ''}</span>
            <span
              className={
                index === 0 ? styles.marker : `${styles.marker} ${styles.continuation}`
              }
            >
              {index === 0
                ? line.kind === 'add'
                  ? '+'
                  : line.kind === 'delete'
                    ? '-'
                    : ' '
                : CONTINUATION}
            </span>
          </span>

          {/* The gutter stays put and only the code moves, which is what the
              unified view gets from `position: sticky` on a scrolling
              viewport. A pane does not scroll — it clips — so the same effect
              has to be spelled out. */}
          <span
            className={styles.paneContent}
            style={offset === 0 ? undefined : { transform: `translateX(${-offset}px)` }}
          >
            {rowRuns.map((run, runIndex) =>
              run.color === null && !run.changed ? (
                <span key={runIndex}>{run.text}</span>
              ) : (
                <span
                  key={runIndex}
                  className={run.changed ? styles.word : undefined}
                  style={run.color === null ? undefined : { color: run.color }}
                >
                  {run.text}
                </span>
              ),
            )}

            {line.noNewline && index === wrapped.length - 1 && (
              <span className={styles.noNewline}>no newline at end of file</span>
            )}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * One row of the split view.
 *
 * Each pane is the unified view's row in miniature — its own pinned gutter,
 * its own wrapping, the same colours — and the row is as tall as the taller of
 * the two, so the sides keep a common baseline.
 */
function SplitLineRowImpl({ left, right, wrapColumn, offset, active, style }: Props) {
  const className = [styles.row, styles.splitRow, active ? styles.active : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} style={style} role="row" data-row="split">
      <Pane side="left" entry={left} wrapColumn={wrapColumn} offset={offset} />
      <span className={styles.paneDivider} aria-hidden="true" />
      <Pane side="right" entry={right} wrapColumn={wrapColumn} offset={offset} />
    </div>
  );
}

export const SplitLineRow = memo(SplitLineRowImpl);
