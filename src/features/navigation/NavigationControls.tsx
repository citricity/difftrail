import { ChevronDown, ChevronUp } from 'lucide-react';
import type { DiffNavigation } from '../../hooks/useDiffNavigation.ts';
import styles from './NavigationControls.module.css';

interface Props {
  navigation: DiffNavigation;
}

/**
 * Previous/Next Change.
 *
 * These step through every change in the repository, not just the file in
 * view. The position readout makes that scope visible: "12 / 87" counts hunks
 * across the whole diff.
 */
export function NavigationControls({ navigation }: Props) {
  const { position, total, canGoNext, canGoPrevious, navigating } = navigation;

  return (
    <div className={styles.controls}>
      <span
        className={`${styles.position} ${navigating ? styles.busy : ''}`}
        aria-live="polite"
      >
        {total === 0 ? '' : `${position ?? '–'} / ${total}`}
      </span>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          onClick={navigation.goPrevious}
          disabled={!canGoPrevious}
          title="Previous change (p)"
          aria-label="Previous change"
        >
          <ChevronUp size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={styles.button}
          onClick={navigation.goNext}
          disabled={!canGoNext}
          title="Next change (n)"
          aria-label="Next change"
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
