import { useState, useEffect, useRef } from 'react';
import { todayStr, addDays } from '../utils/date';
import { isHoliday, isWorkday } from '../utils/holidays';
import TimeColumn from './TimeColumn';
import DayHeader from './DayHeader';
import ScheduleBlock from './ScheduleBlock';
import useGridTouch from './useGridTouch';

const DEFAULT_START = 7;
const DEFAULT_END = 23;
const MIN_ROW_HEIGHT = 24;
const TOP_OFFSET_MIN = 15;
const BOTTOM_OFFSET_MIN = 15;
const HEADER_HEIGHT = 52;

// Track recent touch events — suppress click for 300ms after touch to prevent ghost clicks
let _touchTime = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('touchstart', () => { _touchTime = Date.now(); }, { passive: true });
}
function wasRecentTouch() { return Date.now() - _touchTime < 300; }

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
  const halfDot = dotSize / 2;

  return (
    <div className="absolute z-30 pointer-events-none" style={{ top: `${top - halfDot}px`, left: 0, right: 0 }}>
      <div style={{ position: 'absolute', left: `${-halfDot}px`, top: 0, width: `${dotSize}px`, height: `${dotSize}px` }}>
        <div style={{ width: '100%', height: '100%', backgroundColor: '#ef4444', borderRadius: '50%', boxShadow: '0 1px 3px rgba(239,68,68,0.4)' }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: `${halfDot - lineThickness / 2}px`, height: `${lineThickness}px`, backgroundColor: '#ef4444', boxShadow: '0 1px 2px rgba(239,68,68,0.25)' }} />
    </div>
  );
}

export default function ScheduleGrid({ dates, schedules, visibleDays = 7, weekStart, onScheduleClick, onCellClick }) {
  const today = todayStr();
  const timeBodyRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(MIN_ROW_HEIGHT);
  const gridStateRef = useRef({});
  const schedLpRef = useRef(null);

  const { handleDayTouchStart, handleDayTouchMove, handleDayTouchEnd, dayBodyEls } =
    useGridTouch({ gridStateRef, onCellClick });

  const N = dates.length;

  const safeSchedules = schedules || [];
  const byDate = {};
  dates.forEach(d => byDate[d] = []);
  safeSchedules.forEach(s => {
    if (byDate[s.date] !== undefined) byDate[s.date].push(s);
  });
  Object.values(byDate).forEach(arr => arr.sort((a, b) => a.startTime.localeCompare(b.startTime)));

  // Only consider schedules in currently visible days for range calculation
  const visibleDateSet = weekStart
    ? new Set(Array.from({ length: visibleDays }, (_, i) => addDays(weekStart, i)))
    : new Set(dates);
  let startHour = DEFAULT_START;
  let latestEndMin = DEFAULT_END * 60;
  safeSchedules.forEach(s => {
    if (!visibleDateSet.has(s.date)) return;
    const sh = parseInt(s.startTime.split(':')[0]);
    if (sh < startHour) startHour = sh;
    const eMin = toMin(s.endTime);
    const sMin = toMin(s.startTime);
    const actualEnd = eMin < sMin ? eMin + 24 * 60 : eMin;
    if (actualEnd > latestEndMin) latestEndMin = actualEnd;
  });
  startHour = Math.max(0, Math.min(startHour, DEFAULT_START));

  // Bottom boundary: at least 23:15, or latest end + 15 min
  const bottomMin = Math.max(DEFAULT_END * 60 + BOTTOM_OFFSET_MIN, latestEndMin + BOTTOM_OFFSET_MIN);
  const endHour = Math.max(DEFAULT_END, Math.floor(bottomMin / 60));

  const displayHours = [];
  const labelStart = startHour === 0 ? 0 : startHour + 1;
  for (let h = labelStart; h <= endHour; h++) displayHours.push(h);
  const numDisplayHours = displayHours.length;
  const topGapFraction = TOP_OFFSET_MIN / 60;
  const lastRowFraction = (bottomMin - endHour * 60) / 60;
  const totalRowUnits = topGapFraction + (numDisplayHours - 1) + lastRowFraction;

  useEffect(() => {
    function calcHeight() {
      if (!timeBodyRef.current) return;
      const available = timeBodyRef.current.clientHeight - HEADER_HEIGHT;
      const ideal = Math.max(MIN_ROW_HEIGHT, Math.floor(available / totalRowUnits));
      setRowHeight(ideal);
    }
    calcHeight();
    window.addEventListener('resize', calcHeight);
    return () => window.removeEventListener('resize', calcHeight);
  }, [totalRowUnits]);

  const topGapHeight = topGapFraction * rowHeight;
  const lastRowHeight = lastRowFraction * rowHeight;
  const totalHeight = totalRowUnits * rowHeight;
  const firstLabelMin = displayHours[0] * 60;

  gridStateRef.current = { rowHeight, topGapHeight, firstLabelMin, startHour };

  const trackStyle = {
    display: 'flex',
    width: `${N / visibleDays * 100}%`,
    height: '100%',
    transform: 'translateX(var(--day-offset, 0%))',
    transition: 'var(--day-transition, none)',
    willChange: 'transform',
  };

  return (
    <div ref={timeBodyRef} className="h-full" style={{ display: 'grid', gridTemplateColumns: '64px 1fr', overflow: 'hidden' }}>
      {/* Left: static time column */}
      <TimeColumn HEADER_HEIGHT={HEADER_HEIGHT} displayHours={displayHours} rowHeight={rowHeight} topGapHeight={topGapHeight} lastRowHeight={lastRowHeight} />

      {/* Right: single animated track containing all day columns */}
      <div className="overflow-hidden" style={{ height: '100%' }}>
        <div style={trackStyle}>
          {dates.map((date) => {
            const isToday = date === today;
            const holiday = isHoliday(date);
            const workday = isWorkday(date);
            const daySchedules = byDate[date] || [];

            return (
              <div key={date} style={{ width: `${100 / N}%`, flexShrink: 0 }} className="flex flex-col">
                <DayHeader date={date} isToday={isToday} HEADER_HEIGHT={HEADER_HEIGHT} />

                {/* Day body — touch handlers for long-press-to-create on mobile */}
                <div
                  ref={el => { if (el) dayBodyEls.current[date] = el; else delete dayBodyEls.current[date]; }}
                  onTouchStart={e => handleDayTouchStart(e, date)}
                  onTouchMove={handleDayTouchMove}
                  onTouchEnd={handleDayTouchEnd}
                  className={`flex-1 relative border-r border-gray-200 dark:border-gray-700 ${
                    isToday ? 'bg-blue-100/60 dark:bg-blue-800/25' : ''
                  } ${holiday ? 'bg-red-50/30 dark:bg-red-900/5' : ''} ${workday ? 'bg-orange-50/30 dark:bg-orange-900/5' : ''}`}>
                  {/* Top gap */}
                  <div style={{ height: topGapHeight }}
                    onClick={() => { if (!wasRecentTouch()) onCellClick?.(date, `${String(startHour).padStart(2, '0')}:45`); }}
                    className="cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors" />

                  {/* Hour cells */}
                  {displayHours.map((hour, idx) => (
                    <div key={hour}
                      onClick={() => { if (!wasRecentTouch()) onCellClick?.(date, `${String(hour).padStart(2, '0')}:00`); }}
                      className="border-t border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors"
                      style={{ height: idx === numDisplayHours - 1 ? lastRowHeight : rowHeight }}
                    />
                  ))}

                  {/* Schedule blocks */}
                  {findConflictGroups(daySchedules).map(group => {
                    const hasConflict = group.length > 1;
                    const items = assignColumns(group);
                    const totalCols = Math.max(...items.map(it => it._col)) + 1;

                    return items.map(item => (
                      <ScheduleBlock
                        key={item.id}
                        item={item}
                        hasConflict={hasConflict}
                        totalCols={totalCols}
                        rowHeight={rowHeight}
                        topGapHeight={topGapHeight}
                        firstLabelMin={firstLabelMin}
                        totalHeight={totalHeight}
                        onScheduleClick={onScheduleClick}
                        schedLpRef={schedLpRef}
                        wasRecentTouch={wasRecentTouch}
                      />
                    ));
                  })}

                  {isToday && <NowLine rowHeight={rowHeight} topGapHeight={topGapHeight} firstLabelMin={firstLabelMin} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
