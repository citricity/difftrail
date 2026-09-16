/**
 * Which changed files are shown as images, and turning their bytes into
 * something an `<img>` can display.
 *
 * The extension list matches `IMAGE_EXTENSIONS` in `repository.rs`, which
 * refuses to read anything else; keep the two in step. SVG is absent on both
 * sides because Git diffs it as the text it is.
 */

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

/** The MIME type to display a path as, or null if it is not an image. */
export function imageMimeType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return MIME_TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * A `data:` URL for the bytes.
 *
 * A data URL rather than an object URL: the Content-Security-Policy already
 * allows `data:` images, and a string is collected with the diff it belongs to,
 * where an object URL would have to be revoked by hand.
 */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  // Chunked, because spreading a large array into `fromCharCode` overflows the
  // call stack well before an image is large.
  let binary = '';
  const CHUNK = 0x8000;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
