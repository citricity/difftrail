import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { DiffHunk } from '../../types/index.ts';
import styles from './DiffRows.module.css';

interface Props {
  hunk: DiffHunk;
  active: boolean;
  onSelect: () => void;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style: CSSProperties;
}

/**
 * The `@@ -a,b +c,d @@` separator.
 *
 * Doubles as a click target: selecting it moves the global navigation cursor
 * here, so clicking around the document and stepping with the toolbar stay in
 * agreement about where "here" is.
 */
function HunkHeaderRowImpl({ hunk, active, onSelect, style }: Props) {
  const range = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;

  return (
    <div
      className={`${styles.row} ${styles.hunk} ${active ? styles.active : ''}`}
      style={style}
      onClick={onSelect}
      role="row"
    >
      <span className={styles.hunkRange}>{range}</span>
      {hunk.heading !== null && (
        <span className={styles.hunkHeading}>{hunk.heading}</span>
      )}
    </div>
  );
}

export const HunkHeaderRow = memo(HunkHeaderRowImpl);
