import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getSubjectColor } from '../utils/colors';
import { toHoursAbs } from '../utils/date';
import { useSimpleSwipe } from '../hooks/useSimpleSwipe';

const COLLAPSE_THRESHOLD = 3;

function getCategory(cls) {
  if (!cls) return '未知';
  const s = cls.subject || '未知';
  const g = cls.grade || '';
  const level = ['初一','初二','初三'].includes(g) ? '初中'
    : ['高一','高二','高三'].includes(g) ? '高中'
    : g === '大学' ? '大学' : '';
  const prefix = cls.isCompetition ? `${level}竞赛` : level;
  return prefix ? `${prefix}${s}` : s;
}

const GRADE_COLORS = {
  '初中': '#3b82f6',
  '高中': '#6366f1',
  '大学': '#8b5cf6',
  '初中竞赛': '#f59e0b',
  '高中竞赛': '#f43f5e',
  '其他': '#6b7280',
};

function getGradeLevel(cat) {
  const match = cat.match(/^(初中竞赛|高中竞赛|初中|高中|大学)/);
  return match ? match[1] : '其他';
}

function groupByGrade(entries) {
  const grouped = {};
  entries.forEach(([cat, h]) => {
    const level = getGradeLevel(cat);
    if (!grouped[level]) grouped[level] = 0;
    grouped[level] += h;
  });
  return Object.entries(grouped).sort((a, b) => b[1] - a[1]);
}

export default function YearlySchedule() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [schedules, setSchedules] = useState([]);
  const [classes, setClasses] = useState([]);
  const [animKey, setAnimKey] = useState(0);
  const animDir = useRef(1);
  const containerRef = useRef(null);

  useEffect(() => {
    api.getSchedules(`${year}-01-01`, `${year}-12-31`).then(setSchedules).catch(() => {});
    api.getClasses().then(setClasses).catch(() => {});
  }, [year]);

  useEffect(() => { containerRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); changeYear(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); changeYear(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [year]);

  const classMap = {};
  classes.forEach(c => classMap[c.id] = c);

  const byMonth = {};
  for (let m = 0; m < 12; m++) byMonth[m] = { dates: new Set(), schedules: [] };
  schedules.forEach(s => {
    const m = parseInt(s.date.split('-')[1]) - 1;
    const cls = classMap[s.classId];
    byMonth[m].dates.add(s.date);
    byMonth[m].schedules.push({ ...s, class: cls });
  });

  const yearByCategory = {};
  let yearTotalHours = 0;
  const yearDates = new Set();
  schedules.forEach(s => {
    const cls = classMap[s.classId];
    const cat = getCategory(cls);
    if (!yearByCategory[cat]) yearByCategory[cat] = 0;
    const h = toHoursAbs(s.durationBilling);
    yearByCategory[cat] += h;
    yearTotalHours += h;
    yearDates.add(s.date);
  });
  const yearCategoryEntries = Object.entries(yearByCategory).sort((a, b) => b[1] - a[1]);
  const yearCondensed = yearCategoryEntries.length > COLLAPSE_THRESHOLD;
  const yearDisplayEntries = yearCondensed ? groupByGrade(yearCategoryEntries) : yearCategoryEntries;
  const yearMaxHours = yearDisplayEntries.length > 0 ? yearDisplayEntries[0][1] : 1;

  function changeYear(delta) {
    animDir.current = delta;
    setYear(y => y + delta);
    setAnimKey(k => k + 1);
  }

  const navBtn = "px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-base bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform select-none";

  const swipe = useSimpleSwipe({ onPrev: () => changeYear(-1), onNext: () => changeYear(1) });

  return (
    <div ref={containerRef} tabIndex={-1} className="outline-none h-full flex flex-col" {...swipe}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <button onClick={() => changeYear(-1)} className={navBtn}><span className="sm:hidden">‹</span><span className="hidden sm:inline">上一年</span></button>
        <h2 className="text-base sm:text-xl font-medium">{year}年</h2>
        <div className="flex gap-1 sm:gap-2">
          <button onClick={() => { animDir.current = 0; setYear(new Date().getFullYear()); setAnimKey(k => k + 1); }} className={`${navBtn} px-3 sm:px-4`}>今年</button>
          <button onClick={() => changeYear(1)} className={navBtn}><span className="sm:hidden">›</span><span className="hidden sm:inline">下一年</span></button>
        </div>
      </div>
      <div key={animKey} className={`flex-1 min-h-0 flex flex-col ${animDir.current > 0 ? 'slide-in-right' : animDir.current < 0 ? 'slide-in-left' : ''}`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 grid-rows-4 gap-1 sm:gap-2 flex-1 min-h-0">
          {Array.from({ length: 12 }, (_, m) => {
            const data = byMonth[m];
            const totalHours = data.schedules.reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0);

            const byCategory = {};
            data.schedules.forEach(s => {
              const cat = getCategory(s.class);
              if (!byCategory[cat]) byCategory[cat] = 0;
              byCategory[cat] += toHoursAbs(s.durationBilling);
            });
            const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
            const condensed = categoryEntries.length > COLLAPSE_THRESHOLD;
            const displayEntries = condensed ? groupByGrade(categoryEntries) : categoryEntries;

            return (
              <div key={m} onClick={() => navigate(`/monthly?year=${year}&month=${m}`)}
                className="p-1.5 sm:p-2 bg-gray-100 dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 overflow-hidden flex flex-col justify-between"
                style={{ fontSize: 'clamp(10px, 1.2vw, 14px)' }}>
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-[1.15em]">{m + 1}月</span>
                    {totalHours > 0 && (
                      <>
                        <span className="text-gray-500 dark:text-gray-400">{data.dates.size}天 · {data.schedules.length}次</span>
                        <span className="font-medium text-blue-600 dark:text-blue-400">{totalHours.toFixed(1)}h</span>
                      </>
                    )}
                  </div>
                  {displayEntries.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      {displayEntries.map(([label, h]) => {
                        const color = condensed ? GRADE_COLORS[label] || '#6b7280' : getSubjectColor(label.replace(/^(初中竞赛|高中竞赛|初中|高中|大学)/, ''));
                        return (
                          <span key={label} className="inline-flex items-center px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: color, color: '#fff' }}>
                            {label} {h.toFixed(1)}h
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                {totalHours === 0 ? (
                  <div className="text-gray-400">无排课</div>
                ) : (
                  <div className="flex h-2 rounded overflow-hidden mt-1">
                    {(condensed ? displayEntries : categoryEntries).map(([label, h]) => {
                      const color = condensed ? GRADE_COLORS[label] || '#6b7280' : getSubjectColor(label.replace(/^(初中竞赛|高中竞赛|初中|高中|大学)/, ''));
                      return (
                        <div key={label}
                          style={{ width: `${(h / totalHours) * 100}%`, backgroundColor: color }}
                          title={condensed
                            ? categoryEntries.filter(([c]) => getGradeLevel(c) === label).map(([c, hh]) => `${c} ${hh.toFixed(1)}h`).join(' · ')
                            : `${label} ${h.toFixed(1)}h`
                          } />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {yearTotalHours > 0 && (
          <div className="mt-2 p-2 sm:p-3 bg-gray-100 dark:bg-gray-800 rounded-lg shrink-0" style={{ fontSize: 'clamp(10px, 1.2vw, 13px)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-[1.1em]">{year} 年度统计</span>
              <span className="text-[0.85em] text-gray-500 dark:text-gray-400">
                {yearTotalHours.toFixed(1)}h · {yearDates.size}天 · {schedules.length}次
              </span>
            </div>
            <div className="space-y-0.5">
              {yearDisplayEntries.map(([label, h]) => {
                const color = yearCondensed
                  ? GRADE_COLORS[label] || '#6b7280'
                  : getSubjectColor(label.replace(/^(初中竞赛|高中竞赛|初中|高中|大学)/, ''));
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-16 sm:w-24 truncate text-right text-[0.9em]">{label}</span>
                    <div className="flex-1 h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                      <div className="h-full rounded"
                        style={{ width: `${(h / yearMaxHours) * 100}%`, backgroundColor: color }}
                        title={yearCondensed
                          ? yearCategoryEntries
                              .filter(([c]) => getGradeLevel(c) === label)
                              .map(([c, hh]) => `${c} ${hh.toFixed(1)}h`)
                              .join(' · ')
                          : `${label} ${h.toFixed(1)}h`
                        } />
                    </div>
                    <span className="w-10 sm:w-14 text-right font-medium text-[0.9em]">{h.toFixed(1)}h</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
