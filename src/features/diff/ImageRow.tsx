import { memo, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { loadImageSide } from '../../services/images.ts';
import type { ImageSide } from '../../services/images.ts';
import type { ChangedFile, FileDiff, FileSide } from '../../types/index.ts';
import styles from './DiffRows.module.css';

interface Props {
  meta: ChangedFile;
  diff: FileDiff;
  /** Absolute position within the document canvas, set by the virtualiser. */
  style: CSSProperties;
}

const LABEL: Record<FileSide, string> = { original: 'Before', working: 'After' };

/**
 * A changed image: before on the left, after on the right, each scaled down to
 * fit its half of a fixed-height row and never scaled up past its own size.
 *
 * The same in the unified and the split view — side by side is simply how two
 * pictures are compared. An added image has nothing before it and a deleted
 * one nothing after, and those halves say so.
 */
function ImageRowImpl({ meta, diff, style }: Props) {
  return (
    <div className={`${styles.row} ${styles.image}`} style={style} role="row">
      <ImagePane meta={meta} diff={diff} side="original" />
      <span className={styles.paneDivider} aria-hidden="true" />
      <ImagePane meta={meta} diff={diff} side="working" />
    </div>
  );
}

function ImagePane({
  meta,
  diff,
  side,
}: {
  meta: ChangedFile;
  diff: FileDiff;
  side: FileSide;
}) {
  // Keyed by the diff as well as the side, so a re-read diff never shows the
  // previous one's picture while its own loads.
  const [loaded, setLoaded] = useState<{ diff: FileDiff; image: ImageSide } | null>(
    null,
  );

  useEffect(() => {
    let current = true;
    void loadImageSide(meta, diff, side).then((image) => {
      if (current) setLoaded({ diff, image });
    });
    return () => {
      current = false;
    };
  }, [meta, diff, side]);

  const image = loaded?.diff === diff ? loaded.image : null;

  return (
    <figure className={styles.imagePane} data-side={side}>
      <figcaption className={styles.imageLabel}>{LABEL[side]}</figcaption>
      <div className={styles.imageFrame}>
        {image === null ? null : image.state === 'loaded' ? (
          <img
            className={styles.imagePicture}
            src={image.url}
            alt={`${meta.path}, ${LABEL[side].toLowerCase()}`}
            draggable={false}
          />
        ) : (
          <span className={styles.imageMissing}>
            {image.state === 'absent'
              ? side === 'original'
                ? 'Added'
                : 'Deleted'
              : image.message}
          </span>
        )}
      </div>
    </figure>
  );
}

export const ImageRow = memo(ImageRowImpl);
