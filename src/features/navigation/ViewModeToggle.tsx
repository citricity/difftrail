import { Columns2, Rows3 } from 'lucide-react';
import type { ViewMode } from '../../types/index.ts';
import styles from './NavigationControls.module.css';

interface Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES: Array<{ mode: ViewMode; label: string; Icon: typeof Rows3 }> = [
  { mode: 'unified', label: 'Unified view', Icon: Rows3 },
  { mode: 'split', label: 'Split view', Icon: Columns2 },
];

/**
 * Switches the view for this window.
 *
 * Deliberately not a preference write: Settings holds the layout a window
 * *opens* with, and this is the layout it is in now. Flipping between the two
 * while reading a diff is a normal thing to do; changing what every future
 * window starts as is not.
 */
export function ViewModeToggle({ value, onChange }: Props) {
  return (
    <div className={styles.group} role="group" aria-label="View mode">
      {MODES.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          className={
            value === mode ? `${styles.button} ${styles.buttonActive}` : styles.button
          }
          onClick={() => onChange(mode)}
          aria-label={label}
          aria-pressed={value === mode}
          title={label}
        >
          <Icon size={14} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
