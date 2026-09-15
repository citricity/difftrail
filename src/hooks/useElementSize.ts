/**
 * Tracks an element's size.
 *
 * The virtualiser divides the viewport height by the row height to decide what
 * to render, so a height of zero means it renders nothing but overscan. That
 * makes the first measurement load-bearing: it is taken synchronously in a
 * layout effect, before paint, rather than waiting for the ResizeObserver's
 * first callback.
 */

import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;

    const apply = (width: number, height: number): void => {
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };

    const measure = (): void => {
      apply(element.clientWidth, element.clientHeight);
    };

    // Before paint, so the first render already has a usable viewport.
    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(element);

    // A belt-and-braces fallback: if the observer never fires — which is the
    // failure mode that leaves the document looking truncated — a window
    // resize still corrects the size.
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);

  return size;
}
