import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getSubjectColor } from '../utils/colors';
import { toHoursAbs } from '../utils/date';
import { useSimpleSwipe } from '../hooks/useSimpleSwipe';

export default function YearlySchedule() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [schedules, setSchedules] = useState([]);
  const [classes, setClasses] = useState([]);
  const [animKey, setAnimKey] = useState(0);
  const animDir = useRef(1);

  useEffect(() => {
    api.getSchedules(`${year}-01-01`, `${year}-12-31`).then(setSchedules).catch(() => {});
    api.getClasses().then(setClasses).catch(() => {});
  }, [year]);

  // Build class map
  const classMap = {};
  classes.forEach(c => classMap[c.id] = c);

  // Group by month
  const byMonth = {};
  for (let m = 0; m < 12; m++) byMonth[m] = { dates: new Set(), schedules: [] };
  schedules.forEach(s => {
    const m = parseInt(s.date.split('-')[1]) - 1;
    const cls = classMap[s.classId];
    byMonth[m].dates.add(s.date);
    byMonth[m].schedules.push({ ...s, class: cls });
  });

  const navBtn = "px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-base bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform select-none";

  function changeYear(delta) {
    animDir.current = delta;
    setYear(y => y + delta);
    setAnimKey(k => k + 1);
  }

  const swipe = useSimpleSwipe({ onPrev: () => changeYear(-1), onNext: () => changeYear(1) });

  return (
    <div {...swipe}>
      <div className="flex items-center justify-between mb-2 sm:mb-4">
        <button onClick={() => changeYear(-1)} className={navBtn}><span className="sm:hidden">‹</span><span className="hidden sm:inline">上一年</span></button>
        <h2 className="text-base sm:text-xl font-medium">{year}年</h2>
        <div className="flex gap-1 sm:gap-2">
          <button onClick={() => setYear(new Date().getFullYear())} className={`${navBtn} px-3 sm:px-4`}>今年</button>
          <button onClick={() => changeYear(1)} className={navBtn}><span className="sm:hidden">›</span><span className="hidden sm:inline">下一年</span></button>
        </div>
      </div>
      <div key={animKey} className={animDir.current > 0 ? 'slide-in-right' : 'slide-in-left'}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
        {Array.from({ length: 12 }, (_, m) => {
          const data = byMonth[m];
          const totalHours = data.schedules.reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0);

          // By subject
          const bySubject = {};
          data.schedules.forEach(s => {
            const sub = s.class?.subject || '未知';
            if (!bySubject[sub]) bySubject[sub] = 0;
            bySubject[sub] += toHoursAbs(s.durationBilling);
          });

          // Competition vs regular
          const compHours = data.schedules.filter(s => s.class?.isCompetition).reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0);
          const regularHours = totalHours - compHours;

          // Sort subjects by hours
          const subjectEntries = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);

          return (
            <div key={m} onClick={() => navigate(`/monthly?year=${year}&month=${m}`)}
              className="p-2 sm:p-4 bg-gray-100 dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700">
              <div className="flex items-center justify-between mb-1 sm:mb-2">
                <h3 className="text-base sm:text-lg font-bold">{m + 1}月</h3>
                {totalHours > 0 && (
                  <span className="text-xs sm:text-sm font-medium text-blue-600 dark:text-blue-400">{totalHours.toFixed(1)}h</span>
                )}
              </div>
              {totalHours === 0 ? (
                <div className="text-xs sm:text-sm text-gray-400">无排课</div>
              ) : (
                <div className="space-y-1">
                  {/* Subject breakdown */}
                  <div className="flex flex-wrap gap-1 sm:gap-1.5">
                    {subjectEntries.map(([sub, h]) => (
                      <span key={sub} className="inline-flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: getSubjectColor(sub), color: '#fff' }}>
                        {sub} {h.toFixed(1)}h
                      </span>
                    ))}
                  </div>
                  {/* Competition vs regular */}
                  {(compHours > 0 || regularHours > 0) && (
                    <div className="flex flex-wrap gap-1 sm:gap-2 text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-400">
                      {compHours > 0 && <span>★ 竞赛 {compHours.toFixed(1)}h</span>}
                      {regularHours > 0 && <span>课内 {regularHours.toFixed(1)}h</span>}
                    </div>
                  )}
                  {/* Day dots */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Array.from(data.dates).sort().slice(0, 15).map(d => (
                      <div key={d} className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                    ))}
                    {data.dates.size > 15 && <span className="text-[10px] text-gray-400">+{data.dates.size - 15}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
