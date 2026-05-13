import { useContext, memo } from 'react';
import { getClassColor, getTextColor, DarkContext } from '../utils/colors';
import { toMin, duration } from '../utils/schedule';

export default memo(function ScheduleBlock({ item, hasConflict, totalCols, rowHeight, topGapHeight, firstLabelMin, totalHeight, onScheduleClick, schedLpRef, wasRecentTouch }) {
  const dark = useContext(DarkContext);
  if (!item?.startTime || !item?.endTime) return null;
  const topPx = topGapHeight + (toMin(item.startTime) - firstLabelMin) / 60 * rowHeight;
  const dur = duration(item.startTime, item.endTime);
  const heightPx = dur / 60 * rowHeight - 2;
  const widthPct = 100 / totalCols;
  const leftPct = item._col * widthPct;
  const h = Math.max(heightPx, rowHeight - 2);
  const isShort = h < rowHeight * 1.5;
  const clippedTop = Math.max(0, topPx);
  const clippedHeight = Math.min(h, totalHeight - clippedTop);

  const widthPenalty = totalCols > 2 ? 2 : totalCols > 1 ? 1 : 0;
  const fontSize = isShort
    ? Math.max(9, Math.min(15, Math.floor(clippedHeight * 0.7)) - widthPenalty)
    : Math.max(10, Math.min(16, Math.floor(clippedHeight / 3)) - widthPenalty);
  const lineH = fontSize * 1.3;
  const maxNameLines = isShort ? 1 : Math.max(1, Math.floor((clippedHeight - lineH * 2) / lineH));

  return (
    <div
      key={item.id}
      onClick={() => !wasRecentTouch() && onScheduleClick?.(item)}
      onContextMenu={e => e.preventDefault()}
      onTouchStart={e => {
        e.stopPropagation();
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        if (schedLpRef.current?.timer) clearTimeout(schedLpRef.current.timer);
        const timer = setTimeout(() => {
          navigator.vibrate?.(30);
          onScheduleClick?.(item);
          schedLpRef.current = null;
        }, 300);
        schedLpRef.current = { timer, startX: t.clientX, startY: t.clientY };
      }}
      onTouchMove={e => {
        if (!schedLpRef.current) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - schedLpRef.current.startX) > 8 ||
            Math.abs(t.clientY - schedLpRef.current.startY) > 8) {
          clearTimeout(schedLpRef.current.timer);
          schedLpRef.current = null;
        }
      }}
      onTouchEnd={() => {
        if (schedLpRef.current?.timer) {
          clearTimeout(schedLpRef.current.timer);
          schedLpRef.current = null;
        }
      }}
      className={`absolute rounded-md cursor-pointer overflow-hidden z-10 transition-shadow hover:shadow-md select-none ${
        hasConflict ? 'ring-2 ring-red-500' : ''
      }`}
      style={{
        top: `${clippedTop}px`,
        height: `${clippedHeight}px`,
        left: `${leftPct}%`,
        width: `calc(${widthPct}% - 2px)`,
        backgroundColor: hasConflict ? '#ef4444' : getClassColor(item.class, dark),
        color: hasConflict ? '#ffffff' : getTextColor(item.class, dark),
      }}
    >
      {isShort ? (
        <div className="px-1.5 flex items-center gap-1 h-full leading-tight" style={{ fontSize }}>
          <span className="font-bold truncate">
            {item.class?.isCompetition && <span className="text-amber-500">★ </span>}{item.class?.name}
          </span>
          <span className="shrink-0" style={{ opacity: 0.6, fontSize: Math.max(8, fontSize - 1) }}>{item.startTime}-{item.endTime}</span>
        </div>
      ) : (
        <div className="p-1 overflow-hidden" style={{ fontSize, lineHeight: `${lineH}px` }}>
          <div className="font-bold break-words" style={{ display: '-webkit-box', WebkitLineClamp: maxNameLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {item.class?.isCompetition && <span className="text-amber-500">★ </span>}{item.class?.name}
          </div>
          <div style={{ opacity: 0.65 }}>{item.startTime}-{item.endTime}</div>
          {item.locationName && <div style={{ opacity: 0.55, fontSize: Math.max(8, fontSize - 2) }} className="truncate">📍{item.locationName}</div>}
        </div>
      )}
    </div>
  );
});
