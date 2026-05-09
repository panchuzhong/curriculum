import { useState, useEffect, useContext } from 'react';
import { api } from '../api';
import { getClassColor, getSubjectColor, DarkContext } from '../utils/colors';
import { SUBJECTS, GRADES } from '../utils/constants';
import { todayStr, getMonday, addDays, fmt, getMonthRange, getYearRange, toHoursAbs } from '../utils/date';
import { useToast } from '../components/ToastProvider';

function calcRevenue(cls, durationBilling) {
  const hours = toHoursAbs(durationBilling);
  return (cls.unitPrice * cls.studentCount - (cls.discountAmount || 0)) * hours;
}

function groupBy(arr, fn) {
  const map = {};
  arr.forEach(item => {
    const key = fn(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  });
  return map;
}

function StatCard({ label, value, unit, accent, icon }) {
  return (
    <div className="flex-1 rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="h-1" style={{ background: accent }} />
      <div className="p-2 sm:p-4 flex items-start justify-between gap-1 sm:gap-2">
        <div className="min-w-0">
          <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{label}</div>
          <div className="text-base sm:text-2xl font-bold mt-0.5 sm:mt-1 truncate" style={{ color: accent }}>
            {typeof value === 'number' ? value.toLocaleString() : value}
            {unit && <span className="text-xs sm:text-sm font-normal ml-1 text-gray-500 dark:text-gray-400">{unit}</span>}
          </div>
        </div>
        <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-sm sm:text-lg shrink-0 mt-0.5"
          style={{ background: `${accent}22` }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function BarChart({ data, maxVal }) {
  if (!data.length) return null;
  const max = maxVal || Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map(item => (
        <div key={item.label} className="flex items-center gap-2">
          <div className="w-12 sm:w-20 text-xs sm:text-sm text-right text-gray-600 dark:text-gray-400 truncate">{item.label}</div>
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded h-6 overflow-hidden">
            <div className="h-full rounded flex items-center pl-2 text-[10px] sm:text-xs text-white font-medium whitespace-nowrap"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%`, backgroundColor: item.color || '#3b82f6' }}>
              {item.value > 0 && item.display}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const dark = useContext(DarkContext);
  const toast = useToast();
  const [tab, setTab] = useState('week'); // week | month | year | custom
  const [classes, setClasses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [period, setPeriod] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [filterClassId, setFilterClassId] = useState('');
  const [customStart, setCustomStart] = useState(todayStr());
  const [customEnd, setCustomEnd] = useState(todayStr());

  useEffect(() => { api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败')); }, []);

  useEffect(() => {
    let start, end;
    const today = todayStr();

    if (tab === 'week') {
      start = getMonday(today);
      end = addDays(start, 6);
    } else if (tab === 'month') {
      const r = getMonthRange(year, month);
      start = r.start;
      end = r.end;
    } else if (tab === 'year') {
      const r = getYearRange(year);
      start = r.start;
      end = r.end;
    } else {
      start = customStart;
      end = customEnd;
    }

    if (!start || !end || start > end) return;
    setPeriod({ start, end });
    api.getSchedules(start, end).then(setSchedules).catch(e => toast(e.message || '加载课表失败'));
  }, [tab, year, month, customStart, customEnd]);

  if (!period) return null;

  // Build class map
  const classMap = {};
  classes.forEach(c => classMap[c.id] = c);

  // Attach class info to schedules
  const enriched = schedules
    .filter(s => classMap[s.classId])
    .map(s => ({ ...s, class: classMap[s.classId] }));

  // Apply class filter
  const filtered = filterClassId ? enriched.filter(s => s.classId === +filterClassId) : enriched;

  // Aggregate stats
  const totalClasses = filtered.length;
  const totalHours = filtered.reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0);
  const totalRevenue = filtered.reduce((sum, s) => sum + calcRevenue(s.class, s.durationBilling), 0);

  // By subject
  const bySubject = groupBy(filtered, s => s.class.subject);
  const subjectData = SUBJECTS
    .filter(sub => bySubject[sub])
    .map(sub => ({
      label: sub,
      value: bySubject[sub].length,
      hours: bySubject[sub].reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0),
      revenue: bySubject[sub].reduce((sum, s) => sum + calcRevenue(s.class, s.durationBilling), 0),
      color: getSubjectColor(sub),
    }))
    .sort((a, b) => b.value - a.value);

  // By grade
  const byGrade = groupBy(filtered, s => s.class.grade);
  const gradeData = GRADES
    .filter(g => byGrade[g])
    .map(g => ({
      label: g,
      value: byGrade[g].length,
      hours: byGrade[g].reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0),
      revenue: byGrade[g].reduce((sum, s) => sum + calcRevenue(s.class, s.durationBilling), 0),
      color: '#6366f1',
    }))
    .sort((a, b) => b.value - a.value);

  // By class
  const byClass = groupBy(filtered, s => s.classId);
  const classData = Object.entries(byClass)
    .map(([cid, scheds]) => {
      const cls = classMap[cid];
      return {
        label: cls.name,
        value: scheds.length,
        hours: scheds.reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0),
        revenue: scheds.reduce((sum, s) => sum + calcRevenue(cls, s.durationBilling), 0),
        color: getClassColor(cls, dark),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // By month (YYYY-MM)
  const byMonth = groupBy(filtered, s => s.date.slice(0, 7));
  const monthData = Object.entries(byMonth)
    .map(([m, scheds]) => ({
      label: `${parseInt(m.split('-')[1])}月`,
      value: scheds.length,
      hours: scheds.reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0),
      revenue: scheds.reduce((sum, s) => sum + calcRevenue(s.class, s.durationBilling), 0),
      color: '#6366f1',
      sortKey: m,
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  function loadWeek(monday) {
    const end = addDays(monday, 6);
    setPeriod({ start: monday, end });
    api.getSchedules(monday, end).then(setSchedules).catch(e => toast(e.message || '加载课表失败'));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2">
        <h2 className="text-lg sm:text-xl font-medium">统计报表</h2>
        <div className="flex gap-1 bg-gray-200 dark:bg-gray-700 rounded p-1 shrink-0">
          {[
            { key: 'week', label: '周报' },
            { key: 'month', label: '月报' },
            { key: 'year', label: '年报' },
            { key: 'custom', label: '自定义' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-2 sm:px-3 py-1 rounded text-xs sm:text-sm ${tab === t.key ? 'bg-blue-600 text-white' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2 sm:gap-4 mb-3 sm:mb-6 flex-wrap">
        <select value={filterClassId} onChange={e => setFilterClassId(e.target.value)}
          className="px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-xs sm:text-sm">
          <option value="">全部班级</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.isCompetition ? '★ ' : ''}{c.name}</option>
          ))}
        </select>
        {tab === 'week' && period && (
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => loadWeek(addDays(period.start, -7))} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm">◀</button>
            <span className="text-xs sm:text-sm tabular-nums text-center min-w-[140px] sm:w-48">{period.start} ~ {period.end}</span>
            <button onClick={() => loadWeek(addDays(period.start, 7))} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm">▶</button>
            <button onClick={() => loadWeek(getMonday(todayStr()))} className="px-2 sm:px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs sm:text-sm hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">本周</button>
          </div>
        )}
        {tab === 'month' && (
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); }}
              className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">◀</button>
            <span className="text-xs sm:text-sm text-center min-w-[80px] sm:w-32">{year}年{month + 1}月</span>
            <button onClick={() => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); }}
              className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">▶</button>
            <button onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); }}
              className="px-2 sm:px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs sm:text-sm hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">本月</button>
          </div>
        )}
        {tab === 'year' && (
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => setYear(y => y - 1)}
              className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">◀</button>
            <span className="text-xs sm:text-sm text-center min-w-[60px] sm:w-20">{year}年</span>
            <button onClick={() => setYear(y => y + 1)}
              className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">▶</button>
            <button onClick={() => setYear(new Date().getFullYear())}
              className="px-2 sm:px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs sm:text-sm hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">今年</button>
          </div>
        )}
        {tab === 'custom' && (
          <div className="flex items-center gap-1 sm:gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-xs sm:text-sm" />
            <span className="text-gray-400">~</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-xs sm:text-sm" />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-3 sm:mb-6">
        <StatCard label="排课次数" value={totalClasses} unit="次" accent="#3b82f6" icon="📅" />
        <StatCard label="教学时长" value={totalHours} unit="小时" accent="#8b5cf6" icon="⏱" />
        <StatCard label="预估收入" value={`¥${totalRevenue.toLocaleString()}`} accent="#22c55e" icon="💰" />
      </div>

      {totalClasses === 0 ? (
        <div className="text-center py-16">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 56 56">
            <rect x="8" y="12" width="40" height="36" rx="4" strokeWidth="1.5" />
            <path d="M8 20h40" strokeWidth="1.5" />
            <path d="M18 8v8M38 8v8" strokeWidth="2" strokeLinecap="round" />
            <path d="M18 30h8M18 38h12" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="font-medium text-gray-600 dark:text-gray-400">该时段无排课记录</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">前往周课表新建排课</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* By subject */}
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <h3 className="font-bold mb-3">按学科统计</h3>
            <BarChart
              data={subjectData.map(d => ({
                ...d,
                display: `${d.value}次 / ${d.hours.toFixed(1)}h / ¥${d.revenue.toLocaleString()}`,
              }))}
              maxVal={Math.max(...subjectData.map(d => d.value))}
            />
          </div>

          {/* By grade */}
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <h3 className="font-bold mb-3">按年级统计</h3>
            <BarChart
              data={gradeData.map(d => ({
                ...d,
                display: `${d.value}次 / ${d.hours.toFixed(1)}h / ¥${d.revenue.toLocaleString()}`,
              }))}
              maxVal={Math.max(...gradeData.map(d => d.value))}
            />
          </div>

          {/* By month */}
          {monthData.length > 1 && (
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
              <h3 className="font-bold mb-3">按月份统计</h3>
              <BarChart
                data={monthData.map(d => ({
                  ...d,
                  display: `${d.value}次 / ¥${d.revenue.toLocaleString()}`,
                }))}
                maxVal={Math.max(...monthData.map(d => d.value))}
              />
            </div>
          )}

          {/* By class */}
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg lg:col-span-2">
            <h3 className="font-bold mb-3">按班级统计</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-300 dark:border-gray-600">
                    <th className="text-left p-2">班级</th>
                    <th className="text-right p-2">排课次数</th>
                    <th className="text-right p-2">教学时长</th>
                    <th className="text-right p-2">预估收入</th>
                  </tr>
                </thead>
                <tbody>
                  {classData.map(d => (
                    <tr key={d.label} className="border-b border-gray-200 dark:border-gray-700">
                      <td className="p-2 flex items-center gap-2">
                        <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: d.color }} />
                        {d.label}
                      </td>
                      <td className="text-right p-2">{d.value} 次</td>
                      <td className="text-right p-2">{d.hours.toFixed(1)} 小时</td>
                      <td className="text-right p-2 text-green-600 dark:text-green-400">¥{d.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="p-2">合计</td>
                    <td className="text-right p-2">{totalClasses} 次</td>
                    <td className="text-right p-2">{totalHours.toFixed(1)} 小时</td>
                    <td className="text-right p-2 text-green-600 dark:text-green-400">¥{totalRevenue.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
