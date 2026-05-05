import { useRef, useCallback } from 'react';

export function useSimpleSwipe({ onPrev, onNext, threshold = 50 }) {
  const startX = useRef(null);

  const onTouchStart = useCallback((e) => {
    startX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback((e) => {
    if (startX.current == null) return;
    const delta = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(delta) > threshold) {
      delta > 0 ? onPrev() : onNext();
    }
    startX.current = null;
  }, [onPrev, onNext, threshold]);

  return { onTouchStart, onTouchEnd };
}
