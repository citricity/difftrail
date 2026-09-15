import { describe, expect, it } from 'vitest';
import { AppError } from './errors.ts';

describe('AppError.from', () => {
  it('rebuilds the error the backend serialised', () => {
    const error = AppError.from({
      kind: 'notARepository',
      message: 'This directory is not inside a Git repository.',
      detail: 'fatal: not a git repository',
    });

    expect(error).toBeInstanceOf(AppError);
    expect(error.kind).toBe('notARepository');
    expect(error.message).toBe('This directory is not inside a Git repository.');
    expect(error.detail).toBe('fatal: not a git repository');
  });

  it('passes an AppError straight through', () => {
    const original = new AppError({ kind: 'binaryFile', message: 'binary', detail: null });

    expect(AppError.from(original)).toBe(original);
  });

  it('keeps the message when a panic arrives as a bare string', () => {
    const error = AppError.from('called `Option::unwrap()` on a `None` value');

    expect(error.kind).toBe('gitCommandFailed');
    expect(error.message).toBe('called `Option::unwrap()` on a `None` value');
  });

  it('keeps the message when a transport failure arrives as an Error', () => {
    const error = AppError.from(new TypeError('invoke is not a function'));

    expect(error.message).toBe('invoke is not a function');
  });

  it('still produces something sensible for an unrecognisable value', () => {
    const error = AppError.from(undefined);

    expect(error.kind).toBe('gitCommandFailed');
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('is a real Error, so it survives throw and catch', () => {
    const thrown = new AppError({ kind: 'fileNotFound', message: 'gone', detail: null });

    try {
      throw thrown;
    } catch (caught) {
      expect(caught).toBeInstanceOf(Error);
      expect((caught as AppError).kind).toBe('fileNotFound');
    }
  });
});
