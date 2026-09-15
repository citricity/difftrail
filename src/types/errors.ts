/** Mirrors `ErrorKind` in `src-tauri/src/error.rs`. */
export type AppErrorKind =
  | 'notARepository'
  | 'gitUnavailable'
  | 'emptyRepository'
  | 'fileNotFound'
  | 'binaryFile'
  | 'permissionDenied'
  | 'invalidDiff'
  | 'gitCommandFailed';

/** The serialised error shape every Tauri command rejects with. */
export interface AppErrorShape {
  kind: AppErrorKind;
  message: string;
  detail: string | null;
}

/**
 * A backend failure, carried as a real Error so it survives `throw`/`catch`
 * and shows up sensibly in the console.
 */
export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly detail: string | null;

  constructor(shape: AppErrorShape) {
    super(shape.message);
    this.name = 'AppError';
    this.kind = shape.kind;
    this.detail = shape.detail;
  }

  /**
   * Normalises anything thrown by `invoke` into an `AppError`.
   *
   * Tauri rejects with the serialised payload itself, but a panic or a
   * transport failure arrives as a string, and we must not lose it.
   */
  static from(thrown: unknown): AppError {
    if (thrown instanceof AppError) return thrown;

    if (isErrorShape(thrown)) return new AppError(thrown);

    const message =
      thrown instanceof Error
        ? thrown.message
        : typeof thrown === 'string'
          ? thrown
          : 'Something went wrong talking to the Git backend.';

    return new AppError({ kind: 'gitCommandFailed', message, detail: null });
  }
}

function isErrorShape(value: unknown): value is AppErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}
