/**
 * The mascots.
 *
 * All are single-colour line art stored as white-on-transparent alpha masks,
 * so one CSS rule (`.mascot` in `DiffRows.module.css`) colours any of them
 * from `--mascot`. There are two sets, for two moods:
 *
 * - `MASCOTS`, at the end of the document: the reader has earned a break.
 * - `IDLE_MASCOTS`, when there are no unstaged changes at all: nothing to do,
 *   so the hedgehog is getting on with its own day.
 *
 * Adding one is a file in `assets/mascots/` (or `assets/mascots/idle/`) and a
 * line in the matching list.
 */

import cocktail from '../../assets/mascots/cocktail.png';
import gaming from '../../assets/mascots/gaming.png';
import guitar from '../../assets/mascots/guitar.png';
import dogWalking from '../../assets/mascots/idle/dog-walking.png';
import knitting from '../../assets/mascots/idle/knitting.png';
import newspaper from '../../assets/mascots/idle/newspaper.png';
import tea from '../../assets/mascots/idle/tea.png';
import television from '../../assets/mascots/idle/television.png';
import monocle from '../../assets/mascots/monocle.png';
import reading from '../../assets/mascots/reading.png';
import skateboard from '../../assets/mascots/skateboard.png';
import sleeping from '../../assets/mascots/sleeping.png';
import weights from '../../assets/mascots/weights.png';

/** Shown at the end of the document. */
export const MASCOTS: readonly string[] = [
  monocle,
  cocktail,
  gaming,
  weights,
  skateboard,
  guitar,
  sleeping,
  reading,
];

/** Shown only when the working tree has no unstaged changes. */
export const IDLE_MASCOTS: readonly string[] = [
  newspaper,
  knitting,
  television,
  dogWalking,
  tea,
];

/** One of `from`, chosen by `random` (a value in [0, 1), like `Math.random`). */
export function pickMascot(
  from: readonly string[],
  random: () => number = Math.random,
): string {
  const index = Math.min(from.length - 1, Math.floor(random() * from.length));
  return from[index];
}

/**
 * This session's mascots, one from each set.
 *
 * Chosen once, when the module first loads, so they stay the same for as long
 * as the app is open — scrolling back to the end, switching views or reloading
 * a diff never swaps them — and a new launch may bring different ones.
 */
export const SESSION_MASCOT = pickMascot(MASCOTS);
export const SESSION_IDLE_MASCOT = pickMascot(IDLE_MASCOTS);
