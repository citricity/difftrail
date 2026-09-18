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
import { MessageSquareDashed, MessageSquareText } from 'lucide-react';
import type { HunkNoteState } from '../../hooks/useAiChangelog.ts';
import styles from './DiffRows.module.css';

/** Past this, the rest become a `+n` rather than squeezing the column. */
const MAX_BADGES = 2;

interface BadgesProps {
  /** Logical changes whose run of hunks begins at this row. */
  starts: readonly string[];
  /** Logical changes whose run ends at this row. */
  ends: readonly string[];
  labelOf: (change: string) => string;
  describe: (change: string) => string;
  onOpen: (change: string) => void;
}

/**
 * Logical change markers for one row.
 *
 * A change is **filled where its run starts and hollow where it ends**. There
 * is no line joining the two: the markers are enough, and a rule down the
 * gutter would compete with the code for attention.
 */
function LogicalBadgesImpl({
  starts,
  ends,
  labelOf,
  describe,
  onOpen,
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
      {shown.map(({ change, starting }) => (
        <button
          key={change}
          type="button"
          className={`${styles.badge} ${starting ? styles.starts : styles.ends}`}
          style={{ '--note-lane': laneColour(labelOf(change)) } as CSSProperties}
          title={`${labelOf(change)} — ${describe(change)}`}
          aria-label={`Logical change ${labelOf(change)}: ${
            starting ? 'starts here' : 'ends here'
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(change);
          }}
        >
          {labelOf(change)}
        </button>
      ))}

      {rest > 0 && <span className={styles.more}>+{rest}</span>}
    </>
  );
}

export const LogicalBadges = memo(LogicalBadgesImpl);

interface HunkNoteProps {
  state: HunkNoteState;
  /** The hunk has grown around its notes since they were written. */
  partial: boolean;
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
function HunkNoteIconImpl({ state, partial, onOpen }: HunkNoteProps) {
  if (state === 'changedSince') return null;

  const explained = state === 'explained';
  const Icon = explained ? MessageSquareText : MessageSquareDashed;

  const label = !explained
    ? 'No reason was recorded for this hunk'
    : partial
      ? 'Why this hunk exists — it has changed around the note since'
      : 'Why this hunk exists';

  return (
    <button
      type="button"
      className={`${styles.hunkNote} ${explained ? '' : styles.unexplained}`}
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

/**
 * A lane colour from the change's letter, rather than from the order the UI
 * happened to draw things in.
 */
function laneColour(label: string): string {
  const index = (label.charCodeAt(0) - 65 + 26) % 26;
  return `var(--note-lane-${index % 6})`;
}
