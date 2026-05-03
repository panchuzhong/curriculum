import { useState, useEffect, useRef } from 'react';
import { todayStr } from '../utils/date';
import { isHoliday, isWorkday } from '../utils/holidays';
import TimeColumn from './TimeColumn';
import DayHeader from './DayHeader';
import ScheduleBlock from './ScheduleBlock';
import useGridTouch from './useGridTouch';

const DEFAULT_START = 7;
const DEFAULT_END = 23;
const MIN_ROW_HEIGHT = 24;
const TOP_OFFSET_MIN = 15;
const HEADER_HEIGHT = 52;

// Set once on first touchstart — used to skip onClick on cell backgrounds for touch devices
let _isTouchDev = false;
if (typeof window !== 'undefined') {
  window.addEventListener('touchstart', () => { _isTouchDev = true; }, { once: true, passive: true });
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

export default function ScheduleGrid({ dates, schedules, visibleDays = 7, onScheduleClick, onCellClick }) {
  const today = todayStr();
  const timeBodyRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(MIN_ROW_HEIGHT);
  const gridStateRef = useRef({});
  const schedLpRef = useRef(null);

  const { handleDayTouchStart, handleDayTouchMove, handleDayTouchEnd, dayBodyEls } =
    useGridTouch({ gridStateRef, onCellClick });

  const N = dates.length;

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
    <div className="h-full" style={{ display: 'grid', gridTemplateColumns: '64px 1fr', overflow: 'hidden' }}>
      {/* Left: static time column */}
      <TimeColumn HEADER_HEIGHT={HEADER_HEIGHT} displayHours={displayHours} rowHeight={rowHeight} topGapHeight={topGapHeight} />

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
                    isToday ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''
                  } ${holiday ? 'bg-red-50/30 dark:bg-red-900/5' : ''} ${workday ? 'bg-orange-50/30 dark:bg-orange-900/5' : ''}`}>
                  {/* Top gap */}
                  <div style={{ height: topGapHeight }}
                    onClick={() => { if (!_isTouchDev) onCellClick?.(date, `${String(startHour).padStart(2, '0')}:45`); }}
                    className="cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors" />

                  {/* Hour cells */}
                  {displayHours.map(hour => (
                    <div key={hour}
                      onClick={() => { if (!_isTouchDev) onCellClick?.(date, `${String(hour).padStart(2, '0')}:00`); }}
                      className="border-t border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors"
                      style={{ height: rowHeight }}
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
                        _isTouchDev={_isTouchDev}
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
