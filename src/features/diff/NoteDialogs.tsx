/**
 * The dialogs the gutter markers and the change bar open.
 *
 * Native `<dialog>`, as Settings and the file navigator are: `showModal` gives
 * the focus trap, the backdrop, the inert background and Escape for nothing,
 * and `CLAUDE.md` asks for native elements wherever they are practical.
 */

import { useEffect, useRef, useState } from 'react';
import { CornerDownRight, Crosshair, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { AiChangelogView } from '../../hooks/useAiChangelog.ts';
import {
  changesInOrder,
  fileOfHunk,
  hunksOfChange,
  laneColour,
  ungroupedHunks,
} from '../../lib/noteMarkers.ts';
import styles from './NoteDialogs.module.css';

/** What the reader has open, if anything. */
export type NoteDialog =
  | { kind: 'hunk'; hunkId: string }
  | { kind: 'change'; changeId: string }
  | { kind: 'contents' }
  | null;

interface Props {
  open: NoteDialog;
  notes: AiChangelogView;
  /** Every hunk in the document, in order — what a change's hunk list needs. */
  order: readonly string[];
  onClose: () => void;
  /** Reveal a hunk in the document, and close. */
  onGoToHunk: (fileId: string, hunkId: string) => void;
  onOpenChange: (changeId: string) => void;
  /** The change Previous/Next is currently narrowed to, if any. */
  focused?: string | null;
  onFocus?: (changeId: string) => void;
  onClearFocus?: () => void;
  /** The change the reader is in, marked in the contents list. */
  currentChange?: string | null;
}

export function NoteDialogs({
  open,
  notes,
  order,
  onClose,
  onGoToHunk,
  onOpenChange,
  focused = null,
  onFocus,
  onClearFocus,
  currentChange = null,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;

    // jsdom has neither `showModal` nor `close`; the `open` attribute stands in
    // for them there, exactly as the file navigator and the alias dialog do.
    if (open !== null && !element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    }

    if (open === null && element.open) {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
    }
  }, [open]);

  const goTo = (hunkId: string) => {
    onGoToHunk(fileOfHunk(hunkId), hunkId);
    onClose();
  };

  return (
    <dialog ref={dialog} className={styles.dialog} onClose={onClose}>
      {open?.kind === 'hunk' && (
        <HunkDialog
          hunkId={open.hunkId}
          notes={notes}
          onClose={onClose}
          onOpenChange={onOpenChange}
        />
      )}

      {open?.kind === 'contents' && (
        <ContentsDialog
          notes={notes}
          order={order}
          current={currentChange}
          focused={focused}
          onClose={onClose}
          onGoTo={(changeId) => {
            onOpenChange(changeId);
          }}
          onFocus={onFocus}
        />
      )}

      {open?.kind === 'change' && (
        <ChangeDialog
          changeId={open.changeId}
          notes={notes}
          order={order}
          onClose={onClose}
          onGoTo={goTo}
          focused={focused === open.changeId}
          onFocus={onFocus === undefined ? undefined : () => onFocus(open.changeId)}
          onClearFocus={onClearFocus}
        />
      )}
    </dialog>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label="Close"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </header>
  );
}

/**
 * Why one hunk exists.
 *
 * The logical changes it belongs to come first, as an accordion — a reader
 * scanning several hunks wants the intent, and the same intent repeats across
 * hunks, so it collapses to one line. The hunk's own reason is below it.
 */
function HunkDialog({
  hunkId,
  notes,
  onClose,
  onOpenChange,
}: {
  hunkId: string;
  notes: AiChangelogView;
  onClose: () => void;
  onOpenChange: (changeId: string) => void;
}) {
  const hunk = notes.hunk(hunkId);
  const changes = hunk?.logicalChangeIds ?? [];

  return (
    <>
      <Header title={fileOfHunk(hunkId)} onClose={onClose} />

      <div className={styles.body}>
        {changes.length > 0 && (
          <section className={styles.changes}>
            {changes.map((id) => (
              <ChangeAccordion
                key={id}
                changeId={id}
                notes={notes}
                // One change on its own has nothing to choose between, so it
                // opens; several stay closed until the reader picks.
                initiallyOpen={changes.length === 1}
                onOpenChange={onOpenChange}
              />
            ))}
          </section>
        )}

        <section className={styles.reason}>
          {hunk === null || hunk.reasons.length === 0 ? (
            <p className={styles.muted}>
              No reason was recorded for this hunk. It may be a change nobody
              meant to make.
            </p>
          ) : (
            <>
              {hunk.partial && (
                <p className={styles.warning}>
                  <span aria-hidden="true">!</span> This hunk has changed around
                  the note since it was written. What follows is about the lines
                  it was written for; the rest of the hunk is unaccounted for.
                </p>
              )}

              {hunk.ambiguous && (
                <p className={styles.warning}>
                  <span aria-hidden="true">!</span> Identical hunks were given
                  different reasons, so both are shown.
                </p>
              )}

              {hunk.reasons.map((reason) => (
                <p key={reason} className={styles.text}>
                  {reason}
                </p>
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * Every logical change in the diff, in the order they appear.
 *
 * Stepping is how a reader walks a diff; this is how they see its shape before
 * they start — "this branch is five intents" is a sentence the arrows alone can
 * never say, because you only learn the shape by walking all of it.
 */
function ContentsDialog({
  notes,
  order,
  current,
  focused,
  onClose,
  onGoTo,
  onFocus,
}: {
  notes: AiChangelogView;
  order: readonly string[];
  current: string | null;
  focused: string | null;
  onClose: () => void;
  onGoTo: (changeId: string) => void;
  onFocus?: (changeId: string) => void;
}) {
  const hunks = notes.changelog?.hunks ?? {};
  const changes = changesInOrder(order, hunks);
  const ungrouped = ungroupedHunks(order, hunks);

  return (
    <>
      <Header title="Logical changes" onClose={onClose} />

      <div className={styles.body}>
        <ol className={styles.contents}>
          {changes.map(({ id }) => {
            const label = notes.labelOf(id);
            const covered = hunksOfChange(order, hunks, id).length;

            return (
              <li key={id} className={styles.entry}>
                <button
                  type="button"
                  className={styles.entryButton}
                  aria-current={id === current ? 'true' : undefined}
                  onClick={() => onGoTo(id)}
                >
                  <span
                    className={styles.entryLabel}
                    style={{ '--note-lane': laneColour(label) } as CSSProperties}
                  >
                    {label}
                  </span>
                  <span className={styles.entryText}>
                    {notes.describe(id)}
                    <span className={styles.entryMeta}>
                      {covered} hunk{covered === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>

                {onFocus !== undefined && (
                  <button
                    type="button"
                    className={`${styles.entryFocus} ${
                      id === focused ? styles.entryFocusOn : ''
                    }`}
                    aria-pressed={id === focused}
                    title="Step through this change only"
                    aria-label={`Focus logical change ${label}`}
                    onClick={() => onFocus(id)}
                  >
                    <Crosshair size={13} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        {ungrouped > 0 && (
          <p className={styles.muted}>
            {ungrouped} hunk{ungrouped === 1 ? '' : 's'} belong
            {ungrouped === 1 ? 's' : ''} to no logical change. The arrows step
            past {ungrouped === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>
    </>
  );
}

/** One logical change, collapsed to a line until the reader wants it. */
function ChangeAccordion({
  changeId,
  notes,
  initiallyOpen,
  onOpenChange,
}: {
  changeId: string;
  notes: AiChangelogView;
  initiallyOpen: boolean;
  onOpenChange: (changeId: string) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const change = notes.logicalChange(changeId);
  const description = change?.description ?? 'Logical change';

  return (
    <div className={styles.accordion}>
      <button
        type="button"
        className={styles.summary}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className={styles.label}>{notes.labelOf(changeId)}</span>
        <span className={open ? styles.fullLine : styles.oneLine}>
          {description}
        </span>
      </button>

      {open && (
        <div className={styles.accordionBody}>
          <button
            type="button"
            className={styles.jump}
            onClick={() => onOpenChange(changeId)}
          >
            <CornerDownRight size={13} aria-hidden="true" />
            Go to this change
          </button>
        </div>
      )}
    </div>
  );
}

/** One logical change: what it is, what it covers, and where it starts. */
function ChangeDialog({
  changeId,
  notes,
  order,
  onClose,
  onGoTo,
  focused,
  onFocus,
  onClearFocus,
}: {
  changeId: string;
  notes: AiChangelogView;
  order: readonly string[];
  onClose: () => void;
  onGoTo: (hunkId: string) => void;
  focused: boolean;
  onFocus?: () => void;
  onClearFocus?: () => void;
}) {
  const change = notes.logicalChange(changeId);
  const hunks = hunksOfChange(order, notes.changelog?.hunks ?? {}, changeId);
  const tracker = notes.changelog?.issueTracker ?? null;

  return (
    <>
      <Header
        title={`Logical change ${notes.labelOf(changeId)}`}
        onClose={onClose}
      />

      <div className={styles.body}>
        <p className={styles.text}>
          {change?.description ?? 'This change is not in the changelog’s table.'}
        </p>

        {change !== null && change.associatedIssues.length > 0 && (
          <p className={styles.issues}>
            {change.associatedIssues.map((issue) =>
              tracker === null ? (
                <span key={issue} className={styles.issue}>
                  #{issue}
                </span>
              ) : (
                <a
                  key={issue}
                  className={styles.issue}
                  href={`${tracker.replace(/\/$/, '')}/${issue}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  #{issue}
                </a>
              ),
            )}
          </p>
        )}

        {(onFocus !== undefined || focused) && (
          <section className={styles.focus}>
            <button
              type="button"
              className={styles.focusButton}
              onClick={focused ? onClearFocus : onFocus}
            >
              <Crosshair size={13} aria-hidden="true" />
              {focused ? 'Stop focusing this change' : 'Focus this change'}
            </button>
            <p className={styles.muted}>
              {focused
                ? 'Previous and Next are stepping through this change only.'
                : 'Previous and Next will step through this change only. Every hunk stays on screen.'}
            </p>
          </section>
        )}

        <section>
          <h3 className={styles.subtitle}>
            {hunks.length} hunk{hunks.length === 1 ? '' : 's'}
          </h3>
          <ul className={styles.hunks}>
            {hunks.map((hunkId) => (
              <li key={hunkId}>
                <button
                  type="button"
                  className={styles.hunkLink}
                  onClick={() => onGoTo(hunkId)}
                >
                  {fileOfHunk(hunkId)}
                  <span className={styles.muted}>
                    {' '}
                    hunk {Number(hunkId.slice(hunkId.lastIndexOf(':') + 1)) + 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
