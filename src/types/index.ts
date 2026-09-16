export type {
  ChangeLocation,
  ChangedFile,
  DiffHunk,
  DiffLine,
  DocumentFile,
  FileDiff,
  FileSide,
  FileStatus,
  FileText,
  LineRange,
  LineKind,
  LoadStatus,
  RepositoryInfo,
} from './diff.ts';

export type { LaunchOptions } from './launch.ts';

export type { Settings, ViewMode, WrapMode } from './settings.ts';
export {
  DEFAULT_SETTINGS,
  MAX_WRAP_LENGTH,
  MIN_WRAP_LENGTH,
} from './settings.ts';

export { AppError } from './errors.ts';
export type { AppErrorKind, AppErrorShape } from './errors.ts';
