import { useEffect, useRef } from 'react';
import { addDays } from '../utils/date';

export default function useGridTouch({ gridStateRef, onCellClick }) {
  const dayBodyEls = useRef({});
  const lpRef = useRef(null);

  function cancelPress() {
    if (lpRef.current) clearTimeout(lpRef.current.timer);
    lpRef.current = null;
  }

  useEffect(() => {
    const cancelMultiTouch = e => { if (e.touches.length > 1) cancelPress(); };
    window.addEventListener('touchstart', cancelMultiTouch, { passive: true, capture: true });
    return () => {
      window.removeEventListener('touchstart', cancelMultiTouch, true);
      cancelPress();
    };
  }, []);

  function startPress(e, delay, onPress) {
    cancelPress();
    if (e.touches.length !== 1) return;
    const { clientX: startX, clientY: startY } = e.touches[0];
    const target = e.currentTarget;
    const press = { startX, startY, fired: false, timer: null };
    press.timer = setTimeout(() => {
      if (!target.isConnected) return;
      press.fired = true;
      onPress(startY);
    }, delay);
    lpRef.current = press;
  }

  function handleDayTouchStart(e, date) {
    startPress(e, 450, startY => {
      const el = dayBodyEls.current[date];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { rowHeight, topGapHeight, firstLabelMin, startHour } = gridStateRef.current;
      const relY = startY - rect.top;
      const rawMins = firstLabelMin + (relY - topGapHeight) / rowHeight * 60;
      const cappedMins = Math.max(startHour * 60, rawMins);
      const snapped = Math.round(cappedMins / 30) * 30;
      const h = Math.floor(snapped / 60) % 24;
      const m = snapped % 60;
      const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      navigator.vibrate?.(30);
      onCellClick?.(addDays(date, Math.floor(snapped / (24 * 60))), timeStr);
    });
  }

  function handleDayTouchMove(e) {
    if (!lpRef.current) return;
    if (e.touches.length !== 1) { cancelPress(); return; }
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - lpRef.current.startX);
    const dy = Math.abs(t.clientY - lpRef.current.startY);
    if (dx > 8 || dy > 8) cancelPress();
  }

  function handleDayTouchEnd(e) {
    // A completed long press already opened the editor. Suppress its compatibility click.
    if (lpRef.current?.fired && e.cancelable) e.preventDefault();
    cancelPress();
  }

  return { startPress, cancelPress, handleDayTouchStart, handleDayTouchMove, handleDayTouchEnd, dayBodyEls };
}
