import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { DiffLine } from '../../types/index.ts';
import type { Segment } from '../../lib/wordDiff.ts';
import styles from './DiffRows.module.css';

const MARKER: Record<DiffLine['kind'], string> = {
  add: '+',
  delete: '-',
  context: ' ',
};

interface Props {
  line: DiffLine;
  /** Word-level segments, when this line is part of a replacement. */
  segments: Segment[] | undefined;
  active: boolean;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style: CSSProperties;
}

/**
 * One line of a diff.
 *
 * Rendered thousands of times per session, so it stays a plain memoised
 * function of its props with no hooks and no derived state.
 */
function DiffLineRowImpl({ line, segments, active, style }: Props) {
  const className = [styles.row, styles.line, styles[line.kind], active ? styles.active : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} style={style} role="row">
      <span className={styles.gutter} aria-hidden="true">
        <span className={styles.number}>{line.oldLineNumber ?? ''}</span>
        <span className={styles.number}>{line.newLineNumber ?? ''}</span>
        <span className={styles.marker}>{MARKER[line.kind]}</span>
      </span>

      <span className={styles.content}>
        {segments === undefined || segments.length === 0
          ? line.content
          : // Segments are positional and regenerated whole, so the index is a
            // stable identity for them.
            segments.map((segment, index) =>
              segment.changed ? (
                <span key={index} className={styles.word}>
                  {segment.text}
                </span>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}

        {line.noNewline && (
          <span className={styles.noNewline}>no newline at end of file</span>
        )}
      </span>
    </div>
  );
}

export const DiffLineRow = memo(DiffLineRowImpl);
