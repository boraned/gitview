import { useCallback, useEffect, useRef, useState } from 'react';

export const NARROW = 900; // below this, panes stack: list or file, not both
export const COMPACT = 1250; // below this, the folder sidebar starts hidden

export function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/** State mirrored to localStorage (layout only — real settings live in the main-process store). */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`gitview.${key}`);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(`gitview.${key}`, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}

/** Drag handle that resizes the element before it. */
export function useResizer(width: number, setWidth: (w: number) => void, min: number, max: number) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, w: width };
      document.body.classList.add('resizing');
    },
    [width],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return;
      setWidth(Math.round(Math.max(min, Math.min(max, start.current.w + e.clientX - start.current.x))));
    },
    [setWidth, min, max],
  );
  const onPointerUp = useCallback(() => {
    start.current = null;
    document.body.classList.remove('resizing');
  }, []);
  return { onPointerDown, onPointerMove, onPointerUp, onLostPointerCapture: onPointerUp };
}
