import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getSubjectColor } from '../utils/colors';

function toHours(durationBilling) {
  return durationBilling / 60;
}

export default function YearlySchedule() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [schedules, setSchedules] = useState([]);
  const [classes, setClasses] = useState([]);

  useEffect(() => {
    api.getSchedules(`${year}-01-01`, `${year}-12-31`).then(setSchedules);
    api.getClasses().then(setClasses);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setYear(y => y - 1)} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">上一年</button>
        <h2 className="text-xl">{year}年</h2>
        <div className="flex gap-2">
          <button onClick={() => setYear(new Date().getFullYear())}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">今年</button>
          <button onClick={() => setYear(y => y + 1)} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">下一年</button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 12 }, (_, m) => {
          const data = byMonth[m];
          const totalHours = data.schedules.reduce((sum, s) => sum + toHours(s.durationBilling), 0);

          // By subject
          const bySubject = {};
          data.schedules.forEach(s => {
            const sub = s.class?.subject || '未知';
            if (!bySubject[sub]) bySubject[sub] = 0;
            bySubject[sub] += toHours(s.durationBilling);
          });

          // Competition vs regular
          const compHours = data.schedules.filter(s => s.class?.isCompetition).reduce((sum, s) => sum + toHours(s.durationBilling), 0);
          const regularHours = totalHours - compHours;

          // Sort subjects by hours
          const subjectEntries = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);

          return (
            <div key={m} onClick={() => navigate(`/monthly?year=${year}&month=${m}`)}
              className="p-4 bg-gray-100 dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold">{m + 1}月</h3>
                {totalHours > 0 && (
                  <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{totalHours.toFixed(1)}h</span>
                )}
              </div>
              {totalHours === 0 ? (
                <div className="text-sm text-gray-400">无排课</div>
              ) : (
                <div className="space-y-1">
                  {/* Subject breakdown */}
                  <div className="flex flex-wrap gap-1.5">
                    {subjectEntries.map(([sub, h]) => (
                      <span key={sub} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: getSubjectColor(sub), color: '#fff' }}>
                        {sub} {h.toFixed(1)}h
                      </span>
                    ))}
                  </div>
                  {/* Competition vs regular */}
                  {(compHours > 0 || regularHours > 0) && (
                    <div className="flex gap-2 text-[11px] text-gray-500 dark:text-gray-400">
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
  );
}
