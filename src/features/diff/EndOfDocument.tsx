import type { CSSProperties } from 'react';
import { pluralise } from '../../lib/format.ts';
import { SESSION_MASCOT } from './mascots.ts';
import styles from './DiffRows.module.css';

interface Props {
  /** `top` and `height`, from the model's total height and the viewport. */
  style: CSSProperties;
  fileCount: number;
}

/**
 * The space after the last file, and a word from the mascot.
 *
 * The space is the point — see `endOfDocumentHeight` — since without it a
 * change near the bottom cannot be scrolled to the top of the viewport. The
 * message makes that space look meant, and says plainly that there is nothing
 * further down.
 *
 * Lives in the pinned layer, so it stays centred while long lines are scrolled
 * sideways. The mascot is a CSS mask filled with `--mascot`, so it follows the
 * colour scheme like the rest of the palette. Which mascot is chosen once per
 * launch — see `mascots.ts`.
 */
export function EndOfDocument({ style, fileCount }: Props) {
  return (
    <div
      className={`${styles.row} ${styles.end}`}
      style={style}
      role="note"
      aria-label="End of changes"
    >
      <div className={styles.endContent}>
        <span
          className={styles.mascot}
          style={{ '--mascot-image': `url("${SESSION_MASCOT}")` } as CSSProperties}
          aria-hidden="true"
        />
        <div className={styles.endText}>
          <p className={styles.endTitle}>
            Congratulations — you&rsquo;ve reached the end.
          </p>
          <p className={styles.endDetail}>
            That&rsquo;s every change, across {pluralise(fileCount, 'file')}.
          </p>
        </div>
      </div>
    </div>
  );
}
