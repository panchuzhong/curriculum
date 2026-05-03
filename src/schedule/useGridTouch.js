import { useRef } from 'react';

export default function useGridTouch({ gridStateRef, onCellClick }) {
  const dayBodyEls = useRef({});
  const lpRef = useRef(null);

  function handleDayTouchStart(e, date) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (lpRef.current?.timer) clearTimeout(lpRef.current.timer);
    const startX = t.clientX;
    const startY = t.clientY;
    const timer = setTimeout(() => {
      const el = dayBodyEls.current[date];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { rowHeight, topGapHeight, firstLabelMin, startHour } = gridStateRef.current;
      const relY = startY - rect.top;
      const rawMins = firstLabelMin + (relY - topGapHeight) / rowHeight * 60;
      const cappedMins = Math.max(startHour * 60 + 45, rawMins);
      const snapped = Math.round(cappedMins / 30) * 30;
      const h = Math.floor(snapped / 60) % 24;
      const m = snapped % 60;
      const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      navigator.vibrate?.(30);
      onCellClick?.(date, timeStr);
      lpRef.current = null;
    }, 450);
    lpRef.current = { timer, date, startX, startY };
  }

  function handleDayTouchMove(e) {
    if (!lpRef.current) return;
    if (e.touches.length !== 1) { clearTimeout(lpRef.current.timer); lpRef.current = null; return; }
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - lpRef.current.startX);
    const dy = Math.abs(t.clientY - lpRef.current.startY);
    if (dx > 8 || dy > 8) { clearTimeout(lpRef.current.timer); lpRef.current = null; }
  }

  function handleDayTouchEnd() {
    if (lpRef.current?.timer) { clearTimeout(lpRef.current.timer); lpRef.current = null; }
  }

  return { handleDayTouchStart, handleDayTouchMove, handleDayTouchEnd, dayBodyEls };
}
