import { GitBranch } from 'lucide-react';
import { pluralise } from '../../lib/format.ts';
import type { RepositoryInfo } from '../../types/index.ts';
import styles from './RepositoryHeader.module.css';

interface Props {
  repository: RepositoryInfo | null;
  summary: { files: number; additions: number; deletions: number };
}

/**
 * Repository identity and change totals.
 *
 * Renders as soon as the repository resolves, before any diff has been read —
 * this is the "useful immediately" part of startup.
 */
export function RepositoryHeader({ repository, summary }: Props) {
  if (repository === null) {
    return (
      <div className={styles.header}>
        <span className={styles.skeleton} />
      </div>
    );
  }

  return (
    <div className={styles.header}>
      <span className={styles.name}>{repository.name}</span>

      <span className={styles.branch}>
        <GitBranch size={12} aria-hidden="true" />
        {repository.detached ? (
          <span className={styles.branchName}>
            <span className={styles.detached}>detached at </span>
            {repository.head ?? 'unknown'}
          </span>
        ) : (
          <span className={styles.branchName}>{repository.branch ?? 'no branch'}</span>
        )}
      </span>

      {summary.files > 0 && (
        <span className={styles.summary}>
          <span>{pluralise(summary.files, 'file')}</span>
          {summary.additions > 0 && (
            <span className={styles.additions}>+{summary.additions}</span>
          )}
          {summary.deletions > 0 && (
            <span className={styles.deletions}>&minus;{summary.deletions}</span>
          )}
        </span>
      )}
    </div>
  );
}
