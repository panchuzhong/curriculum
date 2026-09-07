import { useRef, useCallback } from 'react';

export function useSimpleSwipe({ onPrev, onNext, threshold = 50 }) {
  const start = useRef(null);

  const onTouchStart = useCallback((e) => {
    // A pinch or a second finger is never a page swipe.
    start.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, []);

  const onTouchEnd = useCallback((e) => {
    const s = start.current;
    start.current = null;
    if (!s || e.touches.length !== 0 || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    // A vertical scroll with some drift must not flip the period.
    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
      dx > 0 ? onPrev() : onNext();
    }
  }, [onPrev, onNext, threshold]);

  return { onTouchStart, onTouchEnd };
}
