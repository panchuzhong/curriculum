import { useState, useEffect, useRef, useContext, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { getClassColor, getTextColor, DarkContext } from '../utils/colors';
import { isHoliday, getHolidayName, isWorkday } from '../utils/holidays';
import { todayStr, getMonday } from '../utils/date';
import { toMin, findConflictGroups, assignColumns } from '../utils/schedule';
import { useSimpleSwipe } from '../hooks/useSimpleSwipe';
import { useToast } from '../components/ToastProvider';
import BatchScheduleDialog from './BatchScheduleDialog';
import ExportDialog from './ExportDialog';
import useViewExport from './useViewExport';

function getMonthDates(year, month) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay() || 7; // 1=Mon
  const last = new Date(year, month + 1, 0);
  const dates = [];
  for (let i = 1; i < startDay; i++) dates.push(null);
  for (let d = 1; d <= last.getDate(); d++) dates.push(d);
  return dates;
}

const DAY_END_MIN = 24 * 60;

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function MonthlySchedule() {
  const navigate = useNavigate();
  const dark = useContext(DarkContext);
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const now = new Date();
  const [year, setYear] = useState(searchParams.get('year') ? +searchParams.get('year') : now.getFullYear());
  const [month, setMonth] = useState(searchParams.get('month') != null ? +searchParams.get('month') : now.getMonth());
  const [schedules, setSchedules] = useState([]);
  const [animKey, setAnimKey] = useState(0);
  const animDir = useRef(1);
  const containerRef = useRef(null);
  const [showBatch, setShowBatch] = useState(false);

  const exportHook = useViewExport({ view: 'monthly', params: { year, month } });

  const startDate = formatDate(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  const endStr = formatDate(year, month, endDate.getDate());

  useEffect(() => {
    api.getSchedules(startDate, endStr).then(setSchedules).catch(e => toast(e.message || '加载课表失败'));
  }, [year, month]);

  useEffect(() => { containerRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevMonth(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); nextMonth(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [year, month]);

  const { dates, byDate } = useMemo(() => {
    const d = getMonthDates(year, month);
    const bd = {};
    schedules.forEach(s => {
      if (!bd[s.date]) bd[s.date] = [];
      bd[s.date].push(s);
    });
    Object.values(bd).forEach(arr => arr.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return { dates: d, byDate: bd };
  }, [year, month, schedules]);

  function prevMonth() {
    animDir.current = -1;
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setAnimKey(k => k + 1);
  }

  function nextMonth() {
    animDir.current = 1;
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setAnimKey(k => k + 1);
  }

  const reload = useCallback(() => {
    api.getSchedules(startDate, endStr).then(setSchedules).catch(e => toast(e.message || '加载课表失败'));
  }, [year, month]);

  const navBtn = "px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-base bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform select-none";
  const actBtn = "px-2 sm:px-3 py-1.5 sm:py-2 text-white rounded text-xs sm:text-sm select-none active:scale-95 transition-transform";

  const swipe = useSimpleSwipe({ onPrev: prevMonth, onNext: nextMonth });

  const dayRows = Math.ceil(dates.length / 7);

  return (
    <div ref={containerRef} tabIndex={-1} className="outline-none h-full flex flex-col" {...swipe}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <button onClick={prevMonth} className={navBtn}><span className="sm:hidden">‹</span><span className="hidden sm:inline">上月</span></button>
        <h2 className="text-base sm:text-xl font-medium">{year}年{month + 1}月</h2>
        <div className="flex gap-1 sm:gap-2">
          <button onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); }}
            className={`${navBtn} px-3 sm:px-4`}>本月</button>
          <button onClick={nextMonth} className={navBtn}><span className="sm:hidden">›</span><span className="hidden sm:inline">下月</span></button>
          <div className="flex gap-1 ml-1 sm:ml-2">
            <button onClick={() => setShowBatch(true)} className={actBtn + ' bg-green-600 hover:bg-green-700'}>
              <span className="sm:hidden">批量</span><span className="hidden sm:inline">批量操作</span>
            </button>
            <button disabled={exportHook.exporting} onClick={() => exportHook.openExport(startDate, endStr, { startYear: year, startMonth: month, endYear: year, endMonth: month })}
              className={actBtn + ' bg-purple-600 hover:bg-purple-700 disabled:opacity-50'}>
              {exportHook.exporting ? '…' : '导出'}
            </button>
          </div>
        </div>
      </div>
      <div key={animKey} className={`flex-1 min-h-0 flex flex-col ${animDir.current > 0 ? 'slide-in-right' : 'slide-in-left'}`}>
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1 flex-1 min-h-0"
        style={{ gridTemplateRows: `auto repeat(${dayRows}, 1fr)` }}>
        {['一','二','三','四','五','六','日'].map(d => (
          <div key={d} className="px-1 py-0.5 sm:p-1.5 text-center text-xs sm:text-sm bg-gray-100 dark:bg-gray-800 rounded">
            <span className="sm:hidden">{d}</span>
            <span className="hidden sm:inline">周{d}</span>
          </div>
        ))}
        {dates.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="px-1 py-0.5 sm:p-1.5 bg-gray-100 dark:bg-gray-800/50 rounded" />;
          const dateStr = formatDate(year, month, day);
          const daySchedules = byDate[dateStr] || [];
          const holiday = isHoliday(dateStr);
          const workday = isWorkday(dateStr);
          const isToday = dateStr === todayStr();
          return (
            <div key={day} onClick={() => {
              const monday = getMonday(dateStr);
              navigate(`/?week=${monday}`);
            }}
              className={`px-1 py-0.5 sm:p-1.5 rounded cursor-pointer overflow-hidden flex flex-col ${
                isToday ? 'bg-blue-100 dark:bg-blue-900/30 ring-1 ring-blue-400' :
                holiday ? 'bg-red-50 dark:bg-red-900/20' :
                workday ? 'bg-orange-50 dark:bg-orange-900/20' :
                'bg-gray-100 dark:bg-gray-800'
              } hover:bg-gray-200 dark:hover:bg-gray-700`}>
              <div className="flex items-center gap-0.5 mb-0.5 flex-wrap shrink-0">
                <span className={`text-[10px] sm:text-xs ${isToday ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>{day}</span>
                {isToday && <span className="text-[8px] sm:text-[9px] bg-blue-500 text-white px-0.5 rounded">今</span>}
                {holiday && <span className="text-[8px] sm:text-[9px] bg-red-500 text-white px-0.5 rounded truncate max-w-full">{getHolidayName(dateStr)}</span>}
                {workday && <span className="text-[8px] sm:text-[9px] bg-orange-500 text-white px-0.5 rounded">班</span>}
              </div>
              {daySchedules.length > 0 && (() => {
                const maxBar = 40;
                const minBar = 5;
                const early = Math.min(...daySchedules.map(s => toMin(s.startTime)));
                const late = Math.max(...daySchedules.map(s => toMin(s.endTime)));
                const MIN_VISIBLE = 240;
                const dayStart = Math.max(0, Math.min(early - 30, 8 * 60 - 30));
                const dayEnd = Math.min(DAY_END_MIN, Math.max(late + 30, dayStart + MIN_VISIBLE));
                const dayTotal = dayEnd - dayStart;
                const groups = findConflictGroups(daySchedules);
                const els = [];
                for (const group of groups) {
                  const hasConflict = group.length > 1;
                  const items = hasConflict ? assignColumns(group) : group.map(s => ({ ...s, _col: 0 }));
                  const totalCols = Math.max(...items.map(it => (it._col || 0))) + 1;
                  const groupTop = Math.min(...items.map(s => toMin(s.startTime)));
                  for (const item of items) {
                    const startMin = toMin(item.startTime);
                    const endMin = toMin(item.endTime);
                    const dur = endMin - startMin;
                    const topPct = Math.max(0, (groupTop - dayStart) / dayTotal * 100);
                    const heightPct = Math.min(maxBar, Math.max(minBar, dur / dayTotal * 100));
                    const widthPct = hasConflict ? 100 / totalCols : 100;
                    const leftPct = hasConflict ? (item._col || 0) * widthPct : 0;
                    els.push(
                      <div key={item.id}
                        className={`absolute rounded truncate px-0.5 flex items-center ${hasConflict ? 'ring-1 ring-red-500 z-10' : ''}`}
                        style={{
                          top: `${topPct}%`,
                          height: `${heightPct}%`,
                          left: `${leftPct + 0.5}%`,
                          width: `calc(${widthPct}% - 2px)`,
                          backgroundColor: hasConflict ? '#ef4444' : getClassColor(item.class, dark),
                          color: hasConflict ? '#fff' : getTextColor(item.class, dark),
                          fontSize: 'clamp(9px, 1.2vw, 13px)',
                          overflow: 'hidden',
                        }}
                        title={`${item.startTime}-${item.endTime} ${item.class?.isCompetition ? '★ ' : ''}${item.class?.name}${hasConflict ? ' [冲突]' : ''}`}>
                        {item.class?.isCompetition && '★ '}{item.class?.name}
                      </div>
                    );
                  }
                }
                return <div className="relative flex-1 min-h-0">{els}</div>;
              })()}
            </div>
          );
        })}
      </div>
      </div>

      {showBatch && (
        <BatchScheduleDialog
          onClose={() => setShowBatch(false)}
          onSaved={() => { setShowBatch(false); reload(); }}
        />
      )}

      {exportHook.showExport && exportHook.exportStart && exportHook.exportEnd && (
        <ExportDialog
          view="month"
          defaultYear={year}
          defaultMonth={month}
          defaultStart={exportHook.exportStart}
          defaultEnd={exportHook.exportEnd}
          onClose={() => exportHook.setShowExport(false)}
          onExportPNG={exportHook.exportPNG}
          onExportCSV={exportHook.exportCSV}
        />
      )}
    </div>
  );
}
