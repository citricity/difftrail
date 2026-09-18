/**
 * What the AI changelog has to say, drawn in the gutter.
 *
 * The markers sit left of the line numbers, inside the gutter, so the gutter's
 * opaque background covers them and they stay put when a long line is scrolled
 * sideways. Everything here is an icon in a row that already exists: no row
 * changes height, which is what the whole scroll model rests on.
 *
 * Each row renders the `.notes` column itself, empty or not, so the line
 * numbers stay in one column down the document. These components fill it.
 */

import { memo } from 'react';
import type { CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronUp,
  MessageSquareDashed,
  MessageSquareText,
} from 'lucide-react';
import type { HunkNoteState } from '../../hooks/useAiChangelog.ts';
import { laneColour } from '../../lib/noteMarkers.ts';
import styles from './DiffRows.module.css';

/** Past this, the rest become a `+n` rather than squeezing the column. */
const MAX_BADGES = 2;

interface BadgesProps {
  /** Logical changes whose run of hunks begins at this row. */
  starts: readonly string[];
  /** Logical changes whose run ends at this row. */
  ends: readonly string[];
  /** Of those, the ones that also cover hunks further up the document. */
  continuesAbove?: readonly string[];
  /** Of those, the ones that also cover hunks further down. */
  continuesBelow?: readonly string[];
  labelOf: (change: string) => string;
  describe: (change: string) => string;
  onOpen: (change: string) => void;
  /** Go to the change's next run, in the direction the chevron points. */
  onJump?: (change: string, direction: 'above' | 'below') => void;
}

/**
 * Logical change markers for one row.
 *
 * A change is **filled where its run starts and hollow where it ends**. There
 * is no line joining the two: the markers are enough, and a rule down the
 * gutter would compete with the code for attention.
 *
 * A change may open and close more than once, so a marker at the end of a run
 * carries a chevron when the same change picks up again further down — without
 * it, a hollow badge reads as the end of the change rather than the end of one
 * of its runs. The chevron points the way the change continues, takes the
 * change's own colour, and goes there when clicked; the letter beside it still
 * opens the change.
 */
function LogicalBadgesImpl({
  starts,
  ends,
  continuesAbove = [],
  continuesBelow = [],
  labelOf,
  describe,
  onOpen,
  onJump,
}: BadgesProps) {
  const badges = [
    ...starts.map((change) => ({ change, starting: true })),
    // A run of one starts and ends on the same row; one badge says so.
    ...ends
      .filter((change) => !starts.includes(change))
      .map((change) => ({ change, starting: false })),
  ];

  const shown = badges.slice(0, MAX_BADGES);
  const rest = badges.length - shown.length;

  return (
    <>
      {shown.map(({ change, starting }) => {
        // The chevron follows the marker it belongs to: a run's start offers
        // the run before it, its end the run after. A single-hunk run draws
        // both marks, on the hunk's first and last line, so it can carry one
        // of each without either pointing the wrong way.
        const carriesOn = starting
          ? continuesAbove.includes(change)
            ? 'above'
            : null
          : continuesBelow.includes(change)
            ? 'below'
            : null;

        const label = labelOf(change);
        const Chevron = carriesOn === 'below' ? ChevronDown : ChevronUp;
        const jump =
          carriesOn === 'below'
            ? `Go to the next part of logical change ${label}`
            : `Go to the previous part of logical change ${label}`;

        return (
          <span key={change} className={styles.badgeGroup}>
            <button
              type="button"
              className={`${styles.badge} ${starting ? styles.starts : styles.ends}`}
              style={{ '--note-lane': laneColour(label) } as CSSProperties}
              title={`${label} — ${describe(change)}`}
              aria-label={`Logical change ${label}: ${
                starting ? 'starts here' : 'ends here'
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onOpen(change);
              }}
            >
              {label}
            </button>

            {carriesOn !== null && onJump !== undefined && (
              <button
                type="button"
                className={styles.carriesOn}
                style={{ '--note-lane': laneColour(label) } as CSSProperties}
                title={jump}
                aria-label={jump}
                onClick={(event) => {
                  event.stopPropagation();
                  onJump(change, carriesOn);
                }}
              >
                <Chevron size={11} aria-hidden="true" />
              </button>
            )}
          </span>
        );
      })}

      {rest > 0 && <span className={styles.more}>+{rest}</span>}
    </>
  );
}

export const LogicalBadges = memo(LogicalBadgesImpl);

interface HunkNoteProps {
  state: HunkNoteState;
  /** The hunk has grown around its notes since they were written. */
  partial: boolean;
  /**
   * The label of the first logical change covering this hunk, if any. The icon
   * borrows that change's lane colour, so the hunks making up one intent can be
   * picked out down the gutter without opening anything.
   */
  changeLabel?: string | null;
  onOpen: () => void;
}

/**
 * The marker on a hunk's `@@` row.
 *
 * Three states, and the difference between the last two is the point of the
 * feature:
 *
 * - **explained** — a reason, a logical change, or both.
 * - **unexplained** — the changelog knows this hunk and says nothing about it,
 *   which is often a change nobody meant to make.
 * - **changed since** — the changelog has never seen this hunk, so it is
 *   usually the reader's own later edit. Deliberately unmarked: an accusing
 *   icon on your own work is worse than no icon at all.
 *
 * A note that only covers part of what its hunk now does carries an
 * exclamation mark.
 */
function HunkNoteIconImpl({
  state,
  partial,
  changeLabel = null,
  onOpen,
}: HunkNoteProps) {
  if (state === 'changedSince') return null;

  const explained = state === 'explained';
  const Icon = explained ? MessageSquareText : MessageSquareDashed;

  // Amber for a hunk nobody explained; otherwise its change's lane, or the
  // accent when the reason stands on its own with no change to belong to.
  const colour = !explained
    ? 'var(--note-unexplained)'
    : changeLabel === null
      ? 'var(--accent)'
      : laneColour(changeLabel);

  const label = !explained
    ? 'No reason was recorded for this hunk'
    : partial
      ? 'Why this hunk exists — it has changed around the note since'
      : 'Why this hunk exists';

  return (
    <button
      type="button"
      className={styles.hunkNote}
      style={{ '--note-colour': colour } as CSSProperties}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <Icon size={13} aria-hidden="true" />
      {partial && (
        <span className={styles.partial} aria-hidden="true">
          !
        </span>
      )}
    </button>
  );
}

export const HunkNoteIcon = memo(HunkNoteIconImpl);
