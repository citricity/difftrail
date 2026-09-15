import { memo } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { splitPath, statusLabel, statusLetter } from '../../lib/format.ts';
import type { DocumentFile } from '../../types/index.ts';
import styles from './DiffRows.module.css';

interface Props {
  file: DocumentFile;
  active: boolean;
  onToggleCollapse: () => void;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style?: CSSProperties;
}

function FileHeaderRowImpl({ file, active, onToggleCollapse, style }: Props) {
  const { meta, collapsed } = file;
  const { directory, name } = splitPath(meta.path);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div
      className={`${styles.row} ${styles.fileHeader} ${active ? styles.active : ''}`}
      style={style}
      role="row"
    >
      <button
        type="button"
        className={styles.disclosure}
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${meta.path}`}
      >
        <Chevron size={14} aria-hidden="true" />
      </button>

      <span
        className={styles.statusLetter}
        data-status={meta.status}
        title={statusLabel(meta.status)}
      >
        {statusLetter(meta.status)}
      </span>

      <span className={styles.path} title={meta.path}>
        {meta.oldPath !== null && (
          <span className={styles.directory}>{meta.oldPath} → </span>
        )}
        <span className={styles.directory}>{directory}</span>
        <span className={styles.name}>{name}</span>
      </span>

      <span className={styles.counts}>
        {meta.additions !== null && meta.additions > 0 && (
          <span className={styles.additions}>+{meta.additions}</span>
        )}
        {meta.deletions !== null && meta.deletions > 0 && (
          <span className={styles.deletions}>&minus;{meta.deletions}</span>
        )}
      </span>
    </div>
  );
}

export const FileHeaderRow = memo(FileHeaderRowImpl);
