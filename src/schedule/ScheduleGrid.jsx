import { useState, useEffect, useRef } from 'react';
import { getClassColor, getTextColor } from '../utils/colors';
import { isHoliday, getHolidayName, isWorkday } from '../utils/holidays';

const DEFAULT_START = 7;
const DEFAULT_END = 23;
const MIN_ROW_HEIGHT = 24;
const TOP_OFFSET_MIN = 15;
const HEADER_HEIGHT = 52;

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function duration(start, end) {
  const s = toMin(start);
  const e = toMin(end);
  return e > s ? e - s : e + 24 * 60 - s;
}

function findConflictGroups(schedules) {
  if (!schedules.length) return [];
  const sorted = [...schedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const groups = [];
  let group = [sorted[0]];
  let groupEnd = toMin(sorted[0].startTime) + duration(sorted[0].startTime, sorted[0].endTime);

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const sStart = toMin(s.startTime);
    if (sStart < groupEnd) {
      group.push(s);
      groupEnd = Math.max(groupEnd, sStart + duration(s.startTime, s.endTime));
    } else {
      groups.push(group);
      group = [s];
      groupEnd = sStart + duration(s.startTime, s.endTime);
    }
  }
  groups.push(group);
  return groups;
}

function assignColumns(group) {
  const sorted = [...group].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const colEnds = [];
  return sorted.map(s => {
    const start = toMin(s.startTime);
    const end = start + duration(s.startTime, s.endTime);
    let col = colEnds.findIndex(ce => ce <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(0); }
    colEnds[col] = end;
    return { ...s, _col: col };
  });
}

function NowLine({ rowHeight, topGapHeight, firstLabelMin }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const top = topGapHeight + (nowMin - firstLabelMin) / 60 * rowHeight;
  if (top < 0) return null;

  const dotSize = 10;
  const lineThickness = 2;

  return (
    <div className="absolute z-30 pointer-events-none" style={{ top: `${top - dotSize / 2}px`, left: 0, right: 0 }}>
      <div className="absolute" style={{ left: '-5px', top: 0 }}>
        <div className="w-2.5 h-2.5 bg-red-500 rounded-full shadow-sm shadow-red-500/50" />
      </div>
      <div className="absolute left-0 right-0 h-[2px] bg-red-500 shadow-sm shadow-red-500/30"
        style={{ top: `${dotSize / 2 - lineThickness / 2}px` }} />
    </div>
  );
}

export default function ScheduleGrid({ dates, schedules, onScheduleClick, onCellClick }) {
  const today = todayStr();
  const timeBodyRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(MIN_ROW_HEIGHT);

  const N = dates.length;
  const VISIBLE = 7;

  const byDate = {};
  dates.forEach(d => byDate[d] = []);
  schedules.forEach(s => {
    if (byDate[s.date] !== undefined) byDate[s.date].push(s);
  });

  let startHour = DEFAULT_START;
  let endHour = DEFAULT_END;
  schedules.forEach(s => {
    const sh = parseInt(s.startTime.split(':')[0]);
    const eh = parseInt(s.endTime.split(':')[0]) + (parseInt(s.endTime.split(':')[1]) > 0 ? 1 : 0);
    const actualEh = eh <= sh ? eh + 24 : eh;
    if (sh < startHour) startHour = sh;
    if (actualEh > endHour) endHour = actualEh;
  });
  startHour = Math.max(0, Math.min(startHour, DEFAULT_START));
  endHour = Math.min(24, Math.max(endHour, DEFAULT_END));

  const displayHours = [];
  for (let h = startHour + 1; h <= endHour; h++) displayHours.push(h);
  const numDisplayHours = displayHours.length;
  const topGapFraction = TOP_OFFSET_MIN / 60;
  const totalRowUnits = topGapFraction + numDisplayHours;

  useEffect(() => {
    function calcHeight() {
      if (!timeBodyRef.current) return;
      const available = timeBodyRef.current.clientHeight;
      const ideal = Math.max(MIN_ROW_HEIGHT, Math.floor(available / totalRowUnits) - 1);
      setRowHeight(ideal);
    }
    calcHeight();
    window.addEventListener('resize', calcHeight);
    return () => window.removeEventListener('resize', calcHeight);
  }, [totalRowUnits]);

  const topGapHeight = topGapFraction * rowHeight;
  const totalHeight = totalRowUnits * rowHeight;

  function timeToPx(timeStr) {
    const mins = toMin(timeStr);
    const firstLabelMin = displayHours[0] * 60;
    return topGapHeight + (mins - firstLabelMin) / 60 * rowHeight;
  }

  // Single track — both headers and bodies slide together as one compositor layer
  const trackStyle = {
    display: 'flex',
    width: `${N / VISIBLE * 100}%`,
    height: '100%',
    transform: 'translateX(var(--day-offset, 0%))',
    transition: 'var(--day-transition, none)',
    willChange: 'transform',
  };

  return (
    <div className="h-full" style={{ display: 'grid', gridTemplateColumns: '64px 1fr', overflow: 'hidden' }}>
      {/* Left: static time column */}
      <div className="flex flex-col border-r border-gray-200 dark:border-gray-700">
        <div style={{ height: HEADER_HEIGHT, flexShrink: 0 }}
          className="flex items-center justify-center border-b-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-600 dark:text-gray-300">
          时间
        </div>
        <div ref={timeBodyRef} className="flex-1 overflow-hidden relative bg-white dark:bg-gray-900">
          <div style={{ height: topGapHeight }} className="border-b border-gray-200 dark:border-gray-800" />
          {displayHours.map(hour => (
            <div key={hour} className="relative" style={{ height: rowHeight }}>
              <div className="absolute top-0 left-0 right-0 border-b border-gray-200 dark:border-gray-800" />
              <span className="absolute text-[11px] text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 px-1"
                style={{ top: '-7px', left: '50%', transform: 'translateX(-50%)' }}>
                {String(hour).padStart(2, '0')}:00
              </span>
            </div>
          ))}
          <div className="absolute bottom-0 left-0 right-0 border-b border-gray-200 dark:border-gray-800" />
        </div>
      </div>

      {/* Right: single animated track containing all day columns */}
      <div className="overflow-hidden" style={{ height: '100%' }}>
        <div style={trackStyle}>
          {dates.map((date) => {
            const isToday = date === today;
            const holiday = isHoliday(date);
            const workday = isWorkday(date);
            const dayLabel = WEEKDAY_LABELS[new Date(date + 'T00:00:00').getDay()];
            const daySchedules = byDate[date] || [];

            return (
              <div key={date} style={{ width: `${100 / N}%`, flexShrink: 0 }} className="flex flex-col">
                {/* Day header — same height as time header */}
                <div style={{ height: HEADER_HEIGHT, flexShrink: 0 }}
                  className={`flex flex-col items-center justify-center border-r border-b-2 border-gray-300 dark:border-gray-600 ${
                    isToday ? 'bg-blue-50 dark:bg-blue-900/40' :
                    workday ? 'bg-orange-50 dark:bg-orange-900/20' :
                    holiday ? 'bg-red-50 dark:bg-red-900/20' :
                    'bg-gray-50 dark:bg-gray-800'
                  }`}>
                  <div className="flex items-center gap-1">
                    <span className={`font-medium text-sm ${isToday ? 'text-blue-700 dark:text-blue-300' : ''}`}>{dayLabel}</span>
                    {isToday && <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded-full font-medium">今天</span>}
                    {holiday && <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{getHolidayName(date)}</span>}
                    {workday && <span className="text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full">调休</span>}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{date.slice(5)}</span>
                </div>

                {/* Day body */}
                <div className={`flex-1 relative border-r border-gray-200 dark:border-gray-700 ${
                  isToday ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''
                } ${holiday ? 'bg-red-50/30 dark:bg-red-900/5' : ''} ${workday ? 'bg-orange-50/30 dark:bg-orange-900/5' : ''}`}>
                  {/* Top gap */}
                  <div style={{ height: topGapHeight }}
                    onClick={() => onCellClick?.(date, `${String(startHour).padStart(2, '0')}:45`)}
                    className="cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors" />

                  {/* Hour cells — border-t so lines are at top of each div,
                      matching the time body's absolute zero-height border-b at top-0 */}
                  {displayHours.map(hour => (
                    <div key={hour}
                      onClick={() => onCellClick?.(date, `${String(hour).padStart(2, '0')}:00`)}
                      className="border-t border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors"
                      style={{ height: rowHeight }}
                    />
                  ))}

                  {/* Schedule blocks */}
                  {findConflictGroups(daySchedules).map(group => {
                    const hasConflict = group.length > 1;
                    const items = assignColumns(group);
                    const totalCols = Math.max(...items.map(it => it._col)) + 1;

                    return items.map(item => {
                      const topPx = timeToPx(item.startTime);
                      const dur = duration(item.startTime, item.endTime);
                      const heightPx = dur / 60 * rowHeight - 2;
                      const widthPct = 100 / totalCols;
                      const leftPct = item._col * widthPct;
                      const h = Math.max(heightPx, rowHeight - 2);
                      const isShort = h < rowHeight * 1.5;
                      const clippedTop = Math.max(0, topPx);
                      const clippedHeight = Math.min(h, totalHeight - clippedTop);

                      return (
                        <div
                          key={item.id}
                          onClick={() => onScheduleClick?.(item)}
                          className={`absolute rounded-md cursor-pointer overflow-hidden z-10 transition-shadow hover:shadow-md ${
                            hasConflict ? 'ring-2 ring-red-500' : ''
                          }`}
                          style={{
                            top: `${clippedTop}px`,
                            height: `${clippedHeight}px`,
                            left: `${leftPct}%`,
                            width: `calc(${widthPct}% - 2px)`,
                            backgroundColor: hasConflict ? '#ef4444' : getClassColor(item.class),
                            color: hasConflict ? '#ffffff' : getTextColor(item.class),
                          }}
                        >
                          {isShort ? (
                            <div className="px-1.5 py-0.5 flex items-center gap-1 text-[11px] h-full leading-tight">
                              <span className="font-bold truncate">
                                {item.class?.isCompetition && <span className="text-amber-500">★ </span>}{item.class?.name}
                              </span>
                              <span style={{ opacity: 0.6 }} className="shrink-0 text-[10px]">{item.startTime}-{item.endTime}</span>
                            </div>
                          ) : (
                            <div className="p-1 text-xs leading-tight">
                              <div className="font-bold truncate">
                                {item.class?.isCompetition && <span className="text-amber-500">★ </span>}{item.class?.name}
                              </div>
                              <div style={{ opacity: 0.65 }}>{item.startTime}-{item.endTime}</div>
                              {item.locationName && <div style={{ opacity: 0.55 }} className="truncate text-[10px]">📍{item.locationName}</div>}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })}

                  {isToday && <NowLine rowHeight={rowHeight} topGapHeight={topGapHeight} firstLabelMin={displayHours[0] * 60} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
