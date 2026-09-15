import { memo } from 'react';
import type { CSSProperties } from 'react';
import { AlertCircle, Binary, FileText } from 'lucide-react';
import type { NoticeKind } from '../../lib/rows.ts';
import type { DocumentFile } from '../../types/index.ts';
import styles from './DiffRows.module.css';

interface Props {
  file: DocumentFile;
  notice: NoticeKind;
  onLoadFully: () => void;
  onExpand: () => void;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style: CSSProperties;
}

function describe(file: DocumentFile, notice: NoticeKind): string {
  switch (notice) {
    case 'binary':
      return 'Binary file — contents not shown.';
    case 'truncated':
      return 'This diff is very large and was not loaded automatically.';
    case 'empty':
      return 'No textual changes to show.';
    case 'collapsed':
      return 'Collapsed.';
    case 'error':
      return file.error ?? 'This file could not be loaded.';
  }
}

/** Stands in for a file body we are deliberately not rendering. */
function NoticeRowImpl({ file, notice, onLoadFully, onExpand, style }: Props) {
  const Icon =
    notice === 'binary' ? Binary : notice === 'error' ? AlertCircle : FileText;

  return (
    <div className={`${styles.row} ${styles.notice}`} style={style} role="row">
      <Icon size={14} aria-hidden="true" />
      <span className={styles.noticeText}>{describe(file, notice)}</span>

      {notice === 'truncated' && (
        <button type="button" className={styles.noticeAction} onClick={onLoadFully}>
          Load anyway
        </button>
      )}

      {notice === 'error' && (
        <button type="button" className={styles.noticeAction} onClick={onLoadFully}>
          Retry
        </button>
      )}

      {notice === 'collapsed' && (
        <button type="button" className={styles.noticeAction} onClick={onExpand}>
          Expand
        </button>
      )}
    </div>
  );
}

export const NoticeRow = memo(NoticeRowImpl);
