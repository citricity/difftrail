import { AlertTriangle } from 'lucide-react';
import type { AppError } from '../types/index.ts';
import styles from './StartupError.module.css';

interface Props {
  error: AppError;
}

const TITLES: Partial<Record<AppError['kind'], string>> = {
  notARepository: 'Not a Git repository',
  gitUnavailable: 'Git not found',
  emptyRepository: 'Nothing to compare against',
  permissionDenied: 'Permission denied',
};

/**
 * Shown when Diff Trail could not start.
 *
 * The user-facing message stays one sentence; the diagnostic detail is
 * available but visually secondary.
 */
export function StartupError({ error }: Props) {
  return (
    <div className={styles.screen}>
      <AlertTriangle className={styles.icon} size={22} aria-hidden="true" />
      <span className={styles.title}>{TITLES[error.kind] ?? 'Could not open the diff'}</span>
      <p className={styles.message}>{error.message}</p>
      {error.detail !== null && <pre className={styles.detail}>{error.detail}</pre>}
    </div>
  );
}
