/**
 * Mirrors `LaunchOptions` in `src-tauri/src/launch.rs`.
 *
 * Keep the two in step: the Rust side serialises with
 * `rename_all = "camelCase"`.
 */
export interface LaunchOptions {
  /**
   * `--example` was passed. Diff Trek serves its built-in sample diff rather
   * than reading a repository, so it opens anywhere — including outside a Git
   * working tree.
   */
  example: boolean;
}
