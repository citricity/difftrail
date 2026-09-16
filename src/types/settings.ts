/**
 * Mirrors `Settings` in `src-tauri/src/settings.rs`.
 *
 * Keep the two in step: the Rust side serialises with
 * `rename_all = "camelCase"`, and clamps `wrapLength` on the way in and out.
 */
/**
 * How a file's diff is laid out.
 *
 * `unified` is the single interleaved column; `split` puts the original and
 * the working copy in two panes. Mirrors `ViewMode` in `settings.rs`.
 */
export type ViewMode = 'unified' | 'split';

/**
 * Whether and where long lines wrap. Mirrors `WrapMode` in `settings.rs`.
 *
 * `column` wraps at the stored `wrapLength`; `auto` wraps at the edge of the
 * viewport, with the column worked out from the window width as it changes
 * (see `autoWrapColumn`). Nothing about `auto` is stored beyond the choice.
 */
export type WrapMode = 'off' | 'column' | 'auto';

export interface Settings {
  /** Whether long lines wrap rather than scrolling horizontally, and where. */
  wrap: WrapMode;
  /**
   * The column `column` mode wraps at. Stored independently of `wrap`, so
   * switching to another mode and back does not forget the chosen width.
   */
  wrapLength: number;
  /**
   * The layout a window opens with — not the layout it is currently in. The
   * toolbar switches the view for the session without disturbing this.
   */
  defaultViewMode: ViewMode;
}

/**
 * What the UI shows before the backend has answered, and what it falls back to
 * if the backend never does. The same values as the Rust `Default`.
 */
export const DEFAULT_SETTINGS: Settings = {
  wrap: 'off',
  wrapLength: 120,
  defaultViewMode: 'unified',
};

/** The range the backend will accept; the dialog holds the input to it too. */
export const MIN_WRAP_LENGTH = 40;
export const MAX_WRAP_LENGTH = 1000;
