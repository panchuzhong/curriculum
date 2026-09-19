import { useState, useEffect, useLayoutEffect, useRef, useContext, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { getClassColor, getTextColor, DarkContext } from '../utils/colors';
import { isHoliday, getHolidayName, isWorkday, subscribeHolidays } from '../utils/holidays';
import { todayStr, getMonday, intParam, YEAR_MIN, YEAR_MAX } from '../utils/date';
import { monthDayWindow, monthBarPct, findConflictGroups, assignColumns } from '../utils/schedule';
import { setViewDate } from '../utils/viewDate';
import { useSimpleSwipe } from '../hooks/useSimpleSwipe';
import { useToast } from '../components/ToastProvider';
import useBoundWarning from '../hooks/useBoundWarning';
import BatchScheduleDialog from './BatchScheduleDialog';
import ExportDialog from './ExportDialog';
import useScheduleExport from './useScheduleExport';
import { shortcutBlocked } from '../utils/keys';

// 导出仅为可测：这段和 server/services/image-gen-monthly.js 的同名函数逐字相同，
// 网页日历和导出 PNG 各用一份。此前只有服务端那份有用例——正是 assignColumns
// 当初分叉的同一种不对称。由 data-consistency 把两边钉在一起。
export function getMonthDates(year, month) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay() || 7; // 1=Mon
  const last = new Date(year, month + 1, 0);
  const dates = [];
  for (let i = 1; i < startDay; i++) dates.push(null);
  for (let d = 1; d <= last.getDate(); d++) dates.push(d);
  return dates;
}

function formatDate(y, m, d) {
  // 年份也补齐，和 src/utils/date.js 的 fmt 一致：位数不对的年份字符串排序上会
  // 落在上下限之内，让 clampDate 看不出它越界。
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function MonthlySchedule() {
  const navigate = useNavigate();
  const dark = useContext(DarkContext);
  const toast = useToast();
  // 按钮会变灰，但方向键和滑动走的是同一个 prevMonth/nextMonth，得自己说一声。
  const warnAtBound = useBoundWarning();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();
  const [year, setYear] = useState(() => intParam(searchParams.get('year'), now.getFullYear(), { min: YEAR_MIN, max: YEAR_MAX }));
  const [month, setMonth] = useState(() => intParam(searchParams.get('month'), now.getMonth(), { min: 0, max: 11 }));
  const [schedules, setSchedules] = useState([]);
  const [animKey, setAnimKey] = useState(0);
  const [, setHolidayRevision] = useState(0);
  const animDir = useRef(1);
  const containerRef = useRef(null);
  const [showBatch, setShowBatch] = useState(false);

  useEffect(() => subscribeHolidays(() => setHolidayRevision(v => v + 1)), []);

  const exportHook = useScheduleExport({ view: 'monthly' });

  const startDate = formatDate(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  const endStr = formatDate(year, month, endDate.getDate());

  // Generation guard shared by the effect and reload(): a late response from a
  // previous month's fetch must not overwrite the newly displayed month
  const fetchGenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const gen = ++fetchGenRef.current;
    api.getSchedules(startDate, endStr).then(data => { if (!cancelled && gen === fetchGenRef.current) setSchedules(data); }).catch(e => { if (!cancelled) toast(e.message || '加载课表失败'); });
    return () => { cancelled = true; };
  }, [year, month]);

  useEffect(() => { containerRef.current?.focus(); }, []);

  function goToThisMonth() {
    const n = new Date();
    const ny = n.getFullYear(), nm = n.getMonth();
    setViewDate('month', `${ny}-${nm}`);
    setViewDate('week', getMonday(todayStr()));
    setSearchParams({ year: String(ny), month: String(nm) }, { replace: true });
    setYear(ny); setMonth(nm);
    animDir.current = 0; setAnimKey(k => k + 1);
  }

  useLayoutEffect(() => {
    const onKey = (e) => {
      if (shortcutBlocked(e)) return;
      if (e.key === 'Home') { e.preventDefault(); goToThisMonth(); return; }
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
    const nm = month === 0 ? 11 : month - 1;
    const ny = month === 0 ? year - 1 : year;
    // 服务端的 isValidDate 带着同一对上下限，翻出去之后区间查询直接 400：
    // 不如翻不动，而不是给一屏空课表加一条「加载课表失败」。
    if (ny < YEAR_MIN) { warnAtBound('已到可用日期范围的最早一个月'); return; }
    animDir.current = -1;
    setViewDate('month', `${ny}-${nm}`);
    setSearchParams({ year: String(ny), month: String(nm) }, { replace: true });
    // 提交的就是刚刚卡过、也写进 URL 和 viewDate 的那对值。用 setMonth(m => m - 1)
    // 的话，两次点击被批到一起时两次都拿同一个渲染时的 month 过卡，却减了两次，
    // month 会变成 -1（拼出 '1900-00-01'），而守卫自己拦不住这一步。
    setYear(ny);
    setMonth(nm);
    setAnimKey(k => k + 1);
  }

  function nextMonth() {
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    if (ny > YEAR_MAX) { warnAtBound('已到可用日期范围的最晚一个月'); return; }
    animDir.current = 1;
    setViewDate('month', `${ny}-${nm}`);
    setSearchParams({ year: String(ny), month: String(nm) }, { replace: true });
    setYear(ny);
    setMonth(nm);
    setAnimKey(k => k + 1);
  }

  const reload = useCallback(() => {
    const gen = ++fetchGenRef.current;
    api.getSchedules(startDate, endStr).then(data => { if (gen === fetchGenRef.current) setSchedules(data); }).catch(e => toast(e.message || '加载课表失败'));
  }, [year, month]);

  const navBtn = "px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-base bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform select-none";
  const actBtn = "px-2 sm:px-3 py-1.5 sm:py-2 text-white rounded text-xs sm:text-sm select-none active:scale-95 transition-transform";

  const swipe = useSimpleSwipe({ onPrev: prevMonth, onNext: nextMonth });

  // Sync year/month to viewDate store for cross-view navigation
  useLayoutEffect(() => {
    setViewDate('month', `${year}-${month}`);
  }, [year, month]);

  const dayRows = Math.ceil(dates.length / 7);
  // 越界时 prevMonth/nextMonth 直接不走；按钮还亮着的话点下去毫无反应，和卡死了没区别。
  const canPrev = (month === 0 ? year - 1 : year) >= YEAR_MIN;
  const canNext = (month === 11 ? year + 1 : year) <= YEAR_MAX;

  return (
    <div ref={containerRef} tabIndex={-1} className="outline-none h-full flex flex-col" {...swipe}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <button onClick={prevMonth} disabled={!canPrev} className={`${navBtn} disabled:opacity-40`}><span className="sm:hidden">‹</span><span className="hidden sm:inline">上月</span></button>
        <h2 className="text-base sm:text-xl font-medium">{year}年{month + 1}月</h2>
        <div className="flex gap-1 sm:gap-2">
          <button onClick={goToThisMonth} className={`${navBtn} px-3 sm:px-4`}>本月</button>
          <button onClick={nextMonth} disabled={!canNext} className={`${navBtn} disabled:opacity-40`}><span className="sm:hidden">›</span><span className="hidden sm:inline">下月</span></button>
          <div className="flex gap-1 ml-1 sm:ml-2">
            <button onClick={() => setShowBatch(true)} className={actBtn + ' bg-green-600 hover:bg-green-700'}>
              <span className="sm:hidden">批量</span><span className="hidden sm:inline">批量操作</span>
            </button>
            <button disabled={exportHook.exporting} onClick={() => exportHook.openExport(startDate, endStr)}
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
              navigate(`/?date=${dateStr}`);
            }}
              aria-label={`查看${dateStr}课表`}
              className={`px-1 py-0.5 sm:p-1.5 rounded cursor-pointer overflow-hidden flex flex-col ${
                isToday ? 'bg-blue-100 dark:bg-blue-900/30 ring-1 ring-blue-400' :
                holiday ? 'bg-red-50 dark:bg-red-900/20' :
                workday ? 'bg-orange-50 dark:bg-orange-900/20' :
                'bg-gray-100 dark:bg-gray-800'
              } hover:bg-gray-200 dark:hover:bg-gray-700`}>
              <div className="flex items-center gap-0.5 mb-0.5 flex-wrap shrink-0">
                <span className={`text-[10px] sm:text-xs ${isToday ? 'font-bold text-blue-600 dark:text-blue-400' : 'font-semibold text-gray-500 dark:text-gray-400'}`}>{day}</span>
                {isToday && <span className="text-[8px] sm:text-[9px] bg-blue-500 text-white px-0.5 rounded">今</span>}
                {holiday && <span className="text-[8px] sm:text-[9px] bg-red-500 text-white px-0.5 rounded truncate max-w-full">{getHolidayName(dateStr)}</span>}
                {workday && <span className="text-[8px] sm:text-[9px] bg-orange-500 text-white px-0.5 rounded">班</span>}
              </div>
              {daySchedules.length > 0 && (() => {
                // 时间窗和条形位置都走共享实现，导出月历 PNG 那份调的是同一个函数。
                const { dayStart, dayTotal } = monthDayWindow(daySchedules);
                const groups = findConflictGroups(daySchedules);
                const els = [];
                for (const group of groups) {
                  const hasConflict = group.length > 1;
                  const items = hasConflict ? assignColumns(group) : group.map(s => ({ ...s, _col: 0 }));
                  const totalCols = Math.max(...items.map(it => (it._col || 0))) + 1;
                  for (const item of items) {
                    const { topPct, heightPct, isEarly, isLate } =
                      monthBarPct(item.startTime, item.endTime, { dayStart, dayTotal });
                    const widthPct = hasConflict ? 100 / totalCols : 100;
                    const leftPct = hasConflict ? (item._col || 0) * widthPct : 0;
                    const isOvertime = isEarly || isLate;
                    const rounded = isEarly && isLate ? 'rounded-none' : isEarly ? 'rounded-b' : isLate ? 'rounded-t' : 'rounded';
                    els.push(
                      <div key={item.id}
                        className={`absolute truncate px-0.5 flex items-center ${hasConflict ? 'ring-1 ring-red-500 z-10' : ''} ${rounded} ${isOvertime ? 'border-x-2 border-amber-500' : ''}`}
                        style={{
                          top: `${topPct}%`,
                          height: `${heightPct}%`,
                          left: isOvertime ? `${leftPct}%` : `${leftPct + 0.5}%`,
                          width: isOvertime ? `${widthPct}%` : `calc(${widthPct}% - 2px)`,
                          backgroundColor: hasConflict ? '#ef4444' : getClassColor(item.class, dark),
                          color: hasConflict ? '#fff' : getTextColor(item.class, dark),
                          fontSize: 'clamp(9px, 1.3vw, 14px)',
                        }}
                        title={`${item.startTime}-${item.endTime} ${item.class?.isCompetition ? '★ ' : ''}${item.class?.name}${hasConflict ? ' [冲突]' : ''}${isOvertime ? ' [非正常时段]' : ''}`}>
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
