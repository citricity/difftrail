import { memo } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { pluralise } from '../../lib/format.ts';
import { rangeLength } from '../../lib/ranges.ts';
import type { LineRange } from '../../types/index.ts';
import styles from './DiffRows.module.css';

/** Lines revealed by one click, when the gap is bigger than that. */
const STEP = 20;

interface Props {
  /** The lines still hidden here. */
  range: LineRange;
  /** The file continues above this gap, so there is a change to expand down from. */
  above: boolean;
  /** The file continues below it, so there is a change to expand up towards. */
  below: boolean;
  onExpand: (range: LineRange) => void;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style: CSSProperties;
}

/**
 * The lines a hunk left out.
 *
 * Each click reveals twenty lines towards the change on that side — up
 * extends the view upwards from the hunk below, down extends it downwards from
 * the hunk above — until the remaining gap is small enough to take in one go.
 * Expanding the middle of a gap leaves an expander on either side of the new
 * context, so repeated clicks converge on the whole file.
 *
 * A chevron only appears on a side the file actually continues on: the gap
 * above the first hunk has nothing to expand down from, and the one after the
 * last hunk has nothing to expand up towards.
 */
function ExpanderRowImpl({ range, above, below, onExpand, style }: Props) {
  const hidden = rangeLength(range);
  const wholeGap = hidden <= STEP;

  return (
    <div className={`${styles.row} ${styles.expander}`} style={style} role="row">
      <span className={styles.expanderActions}>
        {wholeGap ? (
          <button
            type="button"
            className={styles.expanderButton}
            onClick={() => onExpand(range)}
            aria-label={`Show the remaining ${pluralise(hidden, 'line')}`}
            title={`Show the remaining ${pluralise(hidden, 'line')}`}
          >
            <ChevronsUpDown size={13} aria-hidden="true" />
          </button>
        ) : (
          <>
            {below && (
              <button
                type="button"
                className={styles.expanderButton}
                onClick={() =>
                  onExpand({ start: range.end - STEP + 1, end: range.end })
                }
                aria-label={`Show ${STEP} lines above`}
                title={`Show ${STEP} lines above`}
              >
                <ChevronUp size={13} aria-hidden="true" />
              </button>
            )}

            {above && (
              <button
                type="button"
                className={styles.expanderButton}
                onClick={() =>
                  onExpand({ start: range.start, end: range.start + STEP - 1 })
                }
                aria-label={`Show ${STEP} lines below`}
                title={`Show ${STEP} lines below`}
              >
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </span>

      <span className={styles.expanderLabel}>{pluralise(hidden, 'line')} hidden</span>
    </div>
  );
}

export const ExpanderRow = memo(ExpanderRowImpl);
