import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { filterByPath } from '../../lib/fileFilter.ts';
import { splitPath, statusLabel, statusLetter } from '../../lib/format.ts';
import type { DocumentFile } from '../../types/index.ts';
import type { FileListAnchor } from '../diff/FileHeaderRow.tsx';
import styles from './FileNavigator.module.css';

interface Props {
  files: DocumentFile[];
  /** The file the reader is in, highlighted and where the list opens. */
  currentFileId: string | null;
  anchor: FileListAnchor;
  onSelect: (fileId: string) => void;
  onClose: () => void;
}

/** Widest the list grows, and the gap it keeps from the window's edges. */
const MAX_WIDTH = 560;
const EDGE = 8;

/**
 * Go to a file.
 *
 * Opened from the sticky file header — the one place that always names the
 * file you are in — and dropped down from it. Type to filter (fuzzily; see
 * `lib/fileFilter.ts`), arrows to move, Enter to go, Escape to close.
 *
 * Mounted only while open, so every opening starts clean: no query, and the
 * current file highlighted and scrolled into view. That is most of what a
 * sidebar that follows you would give, without the width.
 *
 * A native `<dialog>` opened modally, like Settings: the top layer, the focus
 * trap, an inert document behind it and Escape come with it, and no dependency
 * does. Its default centring is overridden to hang it from the header.
 *
 * The filter input is a combobox pointing at the highlighted option with
 * `aria-activedescendant`, so focus never leaves the input — typing and
 * arrowing are the same gesture.
 */
export function FileNavigator({
  files,
  currentFileId,
  anchor,
  onSelect,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const optionId = (index: number): string => `${listId}-option-${index}`;

  const [query, setQuery] = useState('');

  const matches = useMemo(
    () => filterByPath(files, query, (file) => file.meta.path),
    [files, query],
  );

  const currentIndex = matches.findIndex(
    (match) => match.item.meta.id === currentFileId,
  );
  const [active, setActive] = useState(() => Math.max(0, currentIndex));

  // With no query the list is the document's order, so opening on the current
  // file makes sense; with one, the best match is what the reader wants next.
  const setQueryAndReset = (value: string): void => {
    setQuery(value);
    setActive(0);
  };

  const highlighted = Math.min(active, Math.max(0, matches.length - 1));

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null || element.open) return;

    // jsdom has no `showModal`; the attribute is enough for it to render.
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
  }, []);

  useLayoutEffect(() => {
    const option = document.getElementById(`${listId}-option-${highlighted}`);
    // `scrollIntoView` is missing from jsdom too.
    option?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted, listId]);

  const choose = (index: number): void => {
    const match = matches[index];
    if (match !== undefined) onSelect(match.item.meta.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(matches.length - 1, Math.max(0, highlighted + delta)));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(highlighted);
    }
  };

  const width = Math.min(MAX_WIDTH, window.innerWidth - EDGE * 2);
  const position: CSSProperties = {
    top: anchor.top + 4,
    left: Math.max(EDGE, Math.min(anchor.left - 10, window.innerWidth - width - EDGE)),
    width,
  };

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      style={position}
      aria-label="Go to file"
      onClose={onClose}
      // A click that lands on the dialog element itself, rather than anything
      // inside it, is a click on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className={styles.panel}>
        <input
          className={styles.filter}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={matches.length > 0 ? optionId(highlighted) : undefined}
          aria-label="Filter files"
          placeholder={`Go to file (${files.length})`}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          value={query}
          onChange={(event) => setQueryAndReset(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        {matches.length === 0 ? (
          <p className={styles.empty}>No files match</p>
        ) : (
          <ul id={listId} className={styles.list} role="listbox" aria-label="Files">
            {matches.map((match, index) => {
              const { meta } = match.item;
              const isCurrent = meta.id === currentFileId;

              return (
                <li
                  key={meta.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === highlighted}
                  aria-current={isCurrent ? 'location' : undefined}
                  className={[
                    styles.option,
                    index === highlighted ? styles.highlighted : '',
                    isCurrent ? styles.current : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={
                    meta.oldPath === null ? meta.path : `${meta.oldPath} → ${meta.path}`
                  }
                  // Move, not enter: a list scrolling under a still pointer
                  // must not drag the highlight along with it.
                  onMouseMove={() => {
                    if (index !== highlighted) setActive(index);
                  }}
                  onClick={() => choose(index)}
                >
                  <span
                    className={styles.status}
                    data-status={meta.status}
                    title={statusLabel(meta.status)}
                  >
                    {statusLetter(meta.status)}
                  </span>
                  <HighlightedPath path={meta.path} positions={match.positions} />
                  <span className={styles.counts}>
                    {meta.additions !== null && meta.additions > 0 && (
                      <span className={styles.additions}>+{meta.additions}</span>
                    )}
                    {meta.deletions !== null && meta.deletions > 0 && (
                      <span className={styles.deletions}>&minus;{meta.deletions}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className={styles.hint} aria-hidden="true">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move <kbd>↵</kbd> go <kbd>esc</kbd> close
        </p>
      </div>
    </dialog>
  );
}

/**
 * A path split into directory and name, with the characters the filter matched
 * picked out, so it is visible why a file is in the list.
 */
function HighlightedPath({ path, positions }: { path: string; positions: number[] }) {
  const { directory } = splitPath(path);
  const matched = new Set(positions);

  const render = (from: number, to: number): ReactNode[] => {
    const parts: ReactNode[] = [];
    let start = from;

    for (let index = from; index <= to; index += 1) {
      const boundary = index === to || matched.has(index) !== matched.has(start);
      if (!boundary) continue;

      const text = path.slice(start, index);
      if (text.length > 0) {
        parts.push(
          matched.has(start) ? (
            <mark key={start} className={styles.match}>
              {text}
            </mark>
          ) : (
            text
          ),
        );
      }
      start = index;
    }

    return parts;
  };

  return (
    <span className={styles.path}>
      <span className={styles.directory}>{render(0, directory.length)}</span>
      <span className={styles.name}>{render(directory.length, path.length)}</span>
    </span>
  );
}
