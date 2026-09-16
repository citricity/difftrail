import { memo } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { splitPath, statusLabel, statusLetter } from '../../lib/format.ts';
import type { DocumentFile } from '../../types/index.ts';
import styles from './DiffRows.module.css';

interface Props {
  file: DocumentFile;
  active: boolean;
  onToggleCollapse: () => void;
  /**
   * Makes the path a button that opens the file list, anchored below this
   * header. Only the sticky header passes it: that is the one header always on
   * screen, and it already names the file you are in, which is where "go to a
   * different file" belongs.
   */
  onOpenFileList?: (anchor: FileListAnchor) => void;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style?: CSSProperties;
}

/** Where to open the file list, in viewport pixels. */
export interface FileListAnchor {
  /** The bottom edge of the header. */
  top: number;
  /** The left edge of the path. */
  left: number;
}

function FileHeaderRowImpl({
  file,
  active,
  onToggleCollapse,
  onOpenFileList,
  style,
}: Props) {
  const { meta, collapsed } = file;
  const { directory, name } = splitPath(meta.path);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  // The directory gives way before the name does, so a long path loses its
  // middle folders rather than the file name at its end.
  const pathParts = (
    <>
      {meta.oldPath !== null && (
        <span className={styles.directory}>{meta.oldPath} → </span>
      )}
      <span className={styles.directory}>{directory}</span>
      <span className={styles.name}>{name}</span>
    </>
  );

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

      {onOpenFileList === undefined ? (
        <span className={styles.path} title={meta.path}>
          {pathParts}
        </span>
      ) : (
        <button
          type="button"
          className={`${styles.path} ${styles.pathButton}`}
          title={`${meta.path} — go to another file`}
          aria-haspopup="dialog"
          onClick={(event) => {
            const button = event.currentTarget.getBoundingClientRect();
            const header = event.currentTarget.closest('[role="row"]');
            onOpenFileList({
              top: header?.getBoundingClientRect().bottom ?? button.bottom,
              left: button.left,
            });
          }}
        >
          {pathParts}
          <ChevronsUpDown size={12} className={styles.pathChevron} aria-hidden="true" />
        </button>
      )}

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
