import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { DiffLine } from '../../types/index.ts';
import type { LineRun } from '../../lib/runs.ts';
import { wrapRuns } from '../../lib/wrap.ts';
import styles from './DiffRows.module.css';

const MARKER: Record<DiffLine['kind'], string> = {
  add: '+',
  delete: '-',
  context: ' ',
};

/**
 * Shown where a line number would be on a wrapped continuation.
 *
 * The absence of both numbers already identifies one unambiguously — every
 * real diff line carries at least one — but that is a quiet signal to read at
 * speed, and this is not.
 */
const CONTINUATION = '↪';

interface Props {
  line: DiffLine;
  /**
   * The line already flattened into spans — syntax colour and changed-word
   * shading merged into one list. Cached per hunk, so the identity is stable.
   */
  runs: LineRun[];
  /** Column to wrap at, or null to let the line scroll horizontally. */
  wrapColumn: number | null;
  active: boolean;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style: CSSProperties;
}

/**
 * One line of a diff, occupying one row per visual line.
 *
 * Rendered thousands of times per session, so it stays a plain memoised
 * function of its props with no hooks and no derived state.
 */
function DiffLineRowImpl({ line, runs, wrapColumn, active, style }: Props) {
  const className = [
    styles.row,
    styles.line,
    styles[line.kind],
    active ? styles.active : '',
  ]
    .filter(Boolean)
    .join(' ');

  const wrapped = wrapRuns(runs, wrapColumn);

  return (
    <div className={className} style={style} role="row" data-row="line">
      {wrapped.map((rowRuns, index) => (
        <span key={index} className={styles.visualLine}>
          <span className={styles.gutter} aria-hidden="true">
            {index === 0 ? (
              <>
                <span className={styles.number}>{line.oldLineNumber ?? ''}</span>
                <span className={styles.number}>{line.newLineNumber ?? ''}</span>
                <span className={styles.marker}>{MARKER[line.kind]}</span>
              </>
            ) : (
              <>
                <span className={styles.number} />
                <span className={styles.number} />
                <span className={`${styles.marker} ${styles.continuation}`}>
                  {CONTINUATION}
                </span>
              </>
            )}
          </span>

          <span className={styles.content}>
            {/* Runs are positional and regenerated whole, so the index is a
                stable identity for them. A run with neither a colour nor a
                change is emitted as bare text, which is the common case and one
                node lighter than wrapping it. */}
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
    </div>
  );
}

export const DiffLineRow = memo(DiffLineRowImpl);
