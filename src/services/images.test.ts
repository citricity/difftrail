import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDiff, makeMeta } from '../test/factories.ts';
import { AppError } from '../types/index.ts';

const getImageBytes = vi.fn();
vi.mock('./backend.ts', () => ({ getImageBytes }));

const { loadImageSide } = await import('./images.ts');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('loadImageSide', () => {
  beforeEach(() => {
    getImageBytes.mockReset();
    getImageBytes.mockResolvedValue(PNG);
  });

  it('loads a side as a data URL of the right type', async () => {
    const image = await loadImageSide(
      makeMeta('assets/icon.png'),
      makeDiff('assets/icon.png', 0),
      'working',
    );

    expect(image).toEqual({ state: 'loaded', url: 'data:image/png;base64,iVBORw==' });
    expect(getImageBytes).toHaveBeenCalledWith('assets/icon.png', 'working');
  });

  it('asks the backend once per side of a diff, however often it is shown', async () => {
    const meta = makeMeta('a.png');
    const diff = makeDiff('a.png', 0);

    await loadImageSide(meta, diff, 'original');
    await loadImageSide(meta, diff, 'original');
    await loadImageSide(meta, diff, 'working');

    expect(getImageBytes).toHaveBeenCalledTimes(2);
  });

  it('asks again for a re-read diff', async () => {
    const meta = makeMeta('a.png');
    await loadImageSide(meta, makeDiff('a.png', 0), 'working');
    await loadImageSide(meta, makeDiff('a.png', 0), 'working');
    expect(getImageBytes).toHaveBeenCalledTimes(2);
  });

  it('does not ask for the side an addition or a deletion lacks', async () => {
    const added = makeMeta('new.png', { status: 'added' });
    const deleted = makeMeta('old.png', { status: 'deleted' });

    expect(await loadImageSide(added, makeDiff('new.png', 0), 'original')).toEqual({
      state: 'absent',
    });
    expect(await loadImageSide(deleted, makeDiff('old.png', 0), 'working')).toEqual({
      state: 'absent',
    });
    expect(getImageBytes).not.toHaveBeenCalled();
  });

  it('turns a failure into a state to show, with the backend message', async () => {
    getImageBytes.mockRejectedValue(
      new AppError({
        kind: 'binaryFile',
        message: 'a.png is too large to preview (25 MB).',
        detail: null,
      }),
    );

    expect(
      await loadImageSide(makeMeta('a.png'), makeDiff('a.png', 0), 'working'),
    ).toEqual({
      state: 'failed',
      message: 'a.png is too large to preview (25 MB).',
    });
  });
});
