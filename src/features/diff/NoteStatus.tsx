/**
 * What the toolbar says about the AI changelog.
 *
 * Two small chips, both of which only appear when there is something to say:
 * the logical change the reader has focused, and a warning when the changelog
 * no longer describes the whole diff.
 */

import { MessageSquareDashed, X } from 'lucide-react';
import { changedSince, isComplete } from '../../types/index.ts';
import type { MatchSummary } from '../../types/index.ts';
import styles from './NoteStatus.module.css';

interface Props {
  summary: MatchSummary;
  /** The focused logical change, or null when the whole diff is in play. */
  focus: { label: string; description: string } | null;
  onClearFocus: () => void;
}

export function NoteStatus({ summary, focus, onClearFocus }: Props) {
  return (
    <div className={styles.status}>
      {focus !== null && (
        <span className={styles.focus}>
          <span className={styles.label}>{focus.label}</span>
          <span className={styles.description} title={focus.description}>
            {focus.description}
          </span>
          <button
            type="button"
            className={styles.clear}
            onClick={onClearFocus}
            title="Show every change again (Escape)"
            aria-label="Clear focus"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      )}

      {!isComplete(summary) && (
        <span className={styles.warning} title={explain(summary)}>
          <MessageSquareDashed size={13} aria-hidden="true" />
          {summary.matched} / {summary.total}
        </span>
      )}
    </div>
  );
}

/**
 * The whole story, for the tooltip.
 *
 * Deliberately not phrased as a fault: code changing after the notes were
 * written is the normal way this happens, and it is usually the reader's own
 * later edit.
 */
function explain(summary: MatchSummary): string {
  const lines = [
    `The AI changelog describes ${summary.matched} of ${summary.total} hunks on screen.`,
  ];

  const since = changedSince(summary);
  if (since > 0) {
    lines.push(
      `${since} ${since === 1 ? 'hunk has' : 'hunks have'} changed since it was written.`,
    );
  }

  if (summary.partial > 0) {
    lines.push(
      `${summary.partial} ${summary.partial === 1 ? 'note covers' : 'notes cover'} only part of what its hunk now does.`,
    );
  }

  if (summary.staleNotes > 0) {
    lines.push(
      `${summary.staleNotes} ${summary.staleNotes === 1 ? 'note no longer applies' : 'notes no longer apply'} to anything here.`,
    );
  }

  lines.push('Writing a new changelog brings them back into step.');
  return lines.join('\n');
}
