/**
 * The logical change the reader is in, under the toolbar.
 *
 * A gutter badge says *which* change a hunk belongs to; only this says *what*
 * the change is, which is the part worth reading. It appears whenever the
 * changelog has a logical change to name and takes no toolbar slot to reveal:
 * there is nothing to disclose, because a reader with a changelog open always
 * wants it.
 *
 * Deliberately lighter than the toolbar above it — smaller text, muted, page
 * background — so the two do not read as two title bars.
 */

import { ChevronDown, ChevronUp, Crosshair, List } from 'lucide-react';
import type { CSSProperties } from 'react';
import { laneColour } from '../../lib/noteMarkers.ts';
import styles from './ChangeBar.module.css';

interface Props {
  /** The current change's label, or null when the cursor is in no change. */
  label: string | null;
  description: string | null;
  /** One-based position among the changes, or null with no current change. */
  position: number | null;
  total: number;
  /** Whether the reader is on a hunk at all, which the empty text turns on. */
  onHunk: boolean;
  focused: boolean;
  canGoNext: boolean;
  canGoPrevious: boolean;
  onOpenContents: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleFocus: () => void;
}

export function ChangeBar({
  label,
  description,
  position,
  total,
  onHunk,
  focused,
  canGoNext,
  canGoPrevious,
  onOpenContents,
  onNext,
  onPrevious,
  onToggleFocus,
}: Props) {
  const lane = label === null ? undefined : laneColour(label);

  return (
    <div className={`${styles.bar} ${focused ? styles.barFocused : ''}`}>
      <button
        type="button"
        className={styles.contents}
        onClick={onOpenContents}
        title="All logical changes"
        aria-label="All logical changes"
        aria-haspopup="dialog"
      >
        <span
          className={`${styles.mark} ${label === null ? styles.empty : ''}`}
          style={{ '--note-lane': lane } as CSSProperties}
          aria-hidden="true"
        >
          {label ?? '–'}
        </span>
        <List size={12} aria-hidden="true" />
      </button>

      {/* The change's own words, cut to whatever the window can spare. The
          full text is a hover away, and the contents list has it in full. */}
      <span
        className={`${styles.description} ${label === null ? styles.muted : ''}`}
        title={description ?? undefined}
      >
        {description ??
          (onHunk
            ? 'Not part of a logical change'
            : `${total} logical change${total === 1 ? '' : 's'}`)}
      </span>

      <span className={styles.position} aria-live="polite">
        {position ?? '–'} / {total}
      </span>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          onClick={onPrevious}
          disabled={!canGoPrevious}
          title="Previous logical change (Shift+P)"
          aria-label="Previous logical change"
        >
          <ChevronUp size={14} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={styles.button}
          onClick={onNext}
          disabled={!canGoNext}
          title="Next logical change (Shift+N)"
          aria-label="Next logical change"
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className={`${styles.focus} ${focused ? styles.focusOn : ''}`}
        onClick={onToggleFocus}
        disabled={label === null}
        aria-pressed={focused}
        title={
          focused
            ? 'Step through every hunk again (Escape)'
            : 'Step through this change only'
        }
        aria-label={focused ? 'Stop focusing this change' : 'Focus this change'}
      >
        <Crosshair size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
