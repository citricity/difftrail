/**
 * What the toolbar says about the AI changelog.
 *
 * One chip, and only when there is something to say: the changelog no longer
 * describes the whole diff. Which change the reader is in, and the narrowing
 * of Previous/Next to one of them, belong to the change bar under the toolbar
 * rather than here — one concept, one home.
 */

import { MessageSquareDashed } from 'lucide-react';
import { changedSince, isComplete } from '../../types/index.ts';
import type { MatchSummary } from '../../types/index.ts';
import styles from './NoteStatus.module.css';

interface Props {
  summary: MatchSummary;
}

export function NoteStatus({ summary }: Props) {
  if (isComplete(summary)) return null;

  return (
    <span className={styles.warning} title={explain(summary)}>
      <MessageSquareDashed size={13} aria-hidden="true" />
      {summary.matched} / {summary.total}
    </span>
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
