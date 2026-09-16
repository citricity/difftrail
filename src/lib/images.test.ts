import { describe, expect, it } from 'vitest';
import { bytesToDataUrl, imageMimeType } from './images.ts';

describe('imageMimeType', () => {
  it('recognises common image formats, in any case', () => {
    expect(imageMimeType('assets/icon.png')).toBe('image/png');
    expect(imageMimeType('photos/Holiday.JPG')).toBe('image/jpeg');
    expect(imageMimeType('a.b/c.webp')).toBe('image/webp');
  });

  it('does not treat SVG, code or extensionless files as images', () => {
    expect(imageMimeType('logo.svg')).toBeNull();
    expect(imageMimeType('src/png.ts')).toBeNull();
    expect(imageMimeType('Makefile')).toBeNull();
    expect(imageMimeType('dir.png/readme')).toBeNull();
    expect(imageMimeType('.png')).toBeNull();
  });
});

describe('bytesToDataUrl', () => {
  it('encodes bytes as base64, including ones that are not valid text', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    expect(bytesToDataUrl(bytes, 'image/png')).toBe('data:image/png;base64,iVBORwD/');
  });

  it('copes with more bytes than one call can take as arguments', () => {
    const bytes = new Uint8Array(200_000).fill(65);
    const url = bytesToDataUrl(bytes, 'image/png');
    expect(atob(url.slice(url.indexOf(',') + 1))).toBe('A'.repeat(200_000));
  });
});
