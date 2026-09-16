import { useCallback, useRef } from 'react';
import styles from './DiffDocument.module.css';

interface Props {
  /** Width of one pane's content, in pixels. */
  contentWidth: number;
  /** How much of it a pane can show at once. */
  visibleWidth: number;
  offset: number;
  onScroll: (offset: number) => void;
}

/**
 * The horizontal scrollbar for the split view.
 *
 * The unified view gets one from the viewport itself, but a split view cannot:
 * its panes clip rather than scroll, because a single scroller across two
 * columns would walk you off the end of one pane and into the other instead of
 * holding both at the same column. So the offset is state, and this is the
 * control for it — trackpad gestures alone would leave anyone with a mouse
 * stuck.
 */
export function PaneScrollbar({ contentWidth, visibleWidth, offset, onScroll }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const max = Math.max(0, contentWidth - visibleWidth);
  const drag = useRef<{ startX: number; startOffset: number } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startX: event.clientX, startOffset: offset };
    },
    [offset],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const from = drag.current;
      const element = track.current;
      if (from === null || element === null) return;

      // The thumb travels the track's spare width, so a pixel of drag is worth
      // more than a pixel of content — by exactly the ratio between them.
      const trackWidth = element.clientWidth;
      const thumbWidth = Math.max(28, (visibleWidth / contentWidth) * trackWidth);
      const travel = trackWidth - thumbWidth;
      if (travel <= 0) return;

      const moved = ((event.clientX - from.startX) / travel) * max;
      onScroll(Math.min(max, Math.max(0, from.startOffset + moved)));
    },
    [contentWidth, max, onScroll, visibleWidth],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  }, []);

  if (max <= 0) return null;

  const share = Math.min(1, visibleWidth / contentWidth);
  const position = max === 0 ? 0 : offset / max;

  return (
    <div className={styles.paneScrollTrack} ref={track}>
      <div
        className={styles.paneScrollThumb}
        style={{
          width: `${share * 100}%`,
          left: `calc(${position * 100}% - ${position * share * 100}%)`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="scrollbar"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(position * 100)}
        aria-label="Scroll both panes horizontally"
      />
    </div>
  );
}
