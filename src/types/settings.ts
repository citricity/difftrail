/**
 * Mirrors `Settings` in `src-tauri/src/settings.rs`.
 *
 * Keep the two in step: the Rust side serialises with
 * `rename_all = "camelCase"`, and clamps `wrapLength` on the way in and out.
 */
export interface Settings {
  /** Long lines wrap rather than scrolling horizontally. */
  wrap: boolean;
  /**
   * The column they wrap at. Stored independently of `wrap`, so turning
   * wrapping off and on again does not forget the chosen width.
   */
  wrapLength: number;
}

/**
 * What the UI shows before the backend has answered, and what it falls back to
 * if the backend never does. The same values as the Rust `Default`.
 */
export const DEFAULT_SETTINGS: Settings = { wrap: false, wrapLength: 120 };

/** The range the backend will accept; the dialog holds the input to it too. */
export const MIN_WRAP_LENGTH = 40;
export const MAX_WRAP_LENGTH = 1000;
