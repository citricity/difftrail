/** Mirrors `AliasStatus` in `src-tauri/src/git_alias.rs`. */
export interface GitAliasStatus {
  /** The executable `git dt` will launch. */
  binary: string;
  /** The exact command installing runs, shown before the user agrees to it. */
  command: string;
  /** The `dt` alias already configured, if any. */
  existing: string | null;
  /** The alias is already exactly what would be installed. */
  installed: boolean;
  /** Why this executable is a poor target for the alias, if it is. */
  warning: string | null;
}
