import { GitBranch, GitCompare } from 'lucide-react';
import { pluralise } from '../../lib/format.ts';
import type { ComparisonInfo, RepositoryInfo } from '../../types/index.ts';
import styles from './RepositoryHeader.module.css';

interface Props {
  repository: RepositoryInfo | null;
  summary: { files: number; additions: number; deletions: number };
}

/** What a commit or range resolved to, for the chip's tooltip. */
function describeComparison({ base, target }: ComparisonInfo): string {
  return base === null ? `${target}, the first commit` : `${base} → ${target}`;
}

/**
 * Repository identity and change totals.
 *
 * Renders as soon as the repository resolves, before any diff has been read —
 * this is the "useful immediately" part of startup.
 *
 * Launched with a commit or range, the branch chip gives way to one naming it:
 * the branch says where the working tree is, which is not what is on screen.
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

      {repository.comparison !== null ? (
        <span
          className={styles.branch}
          title={describeComparison(repository.comparison)}
        >
          <GitCompare size={12} aria-hidden="true" />
          <span className={styles.branchName}>{repository.comparison.label}</span>
        </span>
      ) : (
        <span className={styles.branch}>
          <GitBranch size={12} aria-hidden="true" />
          {repository.detached ? (
            <span className={styles.branchName}>
              <span className={styles.detached}>detached at </span>
              {repository.head ?? 'unknown'}
            </span>
          ) : (
            <span className={styles.branchName}>
              {repository.branch ?? 'no branch'}
            </span>
          )}
        </span>
      )}

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
