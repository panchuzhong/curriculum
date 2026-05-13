import { useState, useEffect, useRef, useContext, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getCategoryColor, DarkContext } from '../utils/colors';
import { toHoursAbs } from '../utils/date';
import { useSimpleSwipe } from '../hooks/useSimpleSwipe';
import { useToast } from '../components/ToastProvider';
import BatchScheduleDialog from './BatchScheduleDialog';
import ExportDialog from './ExportDialog';
import useViewExport from './useViewExport';

const COLLAPSE_THRESHOLD_MOBILE = 4;
const COLLAPSE_THRESHOLD_DESKTOP = 9;

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

function getGradeLevel(cat) {
  const match = cat.match(/^(初中竞赛|高中竞赛|初中|高中|大学)/);
  return match ? match[1] : '其他';
}

function groupByGrade(entries) {
  const grouped = {};
  entries.forEach(([cat, h]) => {
    const level = getGradeLevel(cat);
    if (!grouped[level]) grouped[level] = { hours: 0, dominantCat: cat, dominantH: 0 };
    grouped[level].hours += h;
    if (h > grouped[level].dominantH) {
      grouped[level].dominantH = h;
      grouped[level].dominantCat = cat;
    }
  });
  return Object.entries(grouped)
    .map(([level, d]) => [level, d.hours, d.dominantCat])
    .sort((a, b) => b[1] - a[1]);
}

const FALLBACK_COLOR = 'hsl(0, 0%, 50%)';

function resolveColor(label, dominantCategory, dark) {
  return getCategoryColor(label, dark) || getCategoryColor(dominantCategory, dark) || FALLBACK_COLOR;
}

export default function YearlySchedule() {
  const navigate = useNavigate();
  const toast = useToast();
  const dark = useContext(DarkContext);
  const [year, setYear] = useState(new Date().getFullYear());
  const [schedules, setSchedules] = useState([]);
  const [classes, setClasses] = useState([]);
  const [animKey, setAnimKey] = useState(0);
  const animDir = useRef(1);
  const containerRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const collapseLimit = isMobile ? COLLAPSE_THRESHOLD_MOBILE : COLLAPSE_THRESHOLD_DESKTOP;
  const [showBatch, setShowBatch] = useState(false);

  const exportHook = useViewExport({ view: 'yearly', params: { year } });

  useEffect(() => {
    api.getSchedules(`${year}-01-01`, `${year}-12-31`).then(setSchedules).catch(e => toast(e.message || '加载课表失败'));
    api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败'));
  }, [year]);

  useEffect(() => { containerRef.current?.focus(); }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); changeYear(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); changeYear(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [year]);

  const { classMap, byMonth, yearDisplayEntries, yearCategoryEntries, yearMaxHours, yearCondensed, yearTotalHours, yearDates, monthData } = useMemo(() => {
    const cm = {};
    classes.forEach(c => cm[c.id] = c);

    const bm = {};
    for (let m = 0; m < 12; m++) bm[m] = { dates: new Set(), schedules: [] };
    const yCat = {};
    let yTotal = 0;
    const yDates = new Set();
    schedules.forEach(s => {
      const m = parseInt(s.date.split('-')[1]) - 1;
      const cls = cm[s.classId];
      bm[m].dates.add(s.date);
      bm[m].schedules.push({ ...s, class: cls });
      const cat = getCategory(cls);
      if (!yCat[cat]) yCat[cat] = 0;
      const h = toHoursAbs(s.durationBilling);
      yCat[cat] += h;
      yTotal += h;
      yDates.add(s.date);
    });
    const entries = Object.entries(yCat).sort((a, b) => b[1] - a[1]);
    const condensed = entries.length > collapseLimit;
    const displayEntries = condensed ? groupByGrade(entries) : entries;
    const maxH = displayEntries.length > 0 ? displayEntries[0][1] : 1;

    // Per-month precomputation
    const monthData = {};
    for (let m = 0; m < 12; m++) {
      const ms = bm[m].schedules;
      const totalHours = ms.reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0);
      const byCategory = {};
      ms.forEach(s => {
        const cat = getCategory(s.class);
        if (!byCategory[cat]) byCategory[cat] = 0;
        byCategory[cat] += toHoursAbs(s.durationBilling);
      });
      const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
      const catCondensed = categoryEntries.length > collapseLimit;
      const catDisplay = catCondensed ? groupByGrade(categoryEntries) : categoryEntries;
      monthData[m] = { totalHours, categoryEntries, catCondensed, catDisplay };
    }

    return { classMap: cm, byMonth: bm, yearDisplayEntries: displayEntries, yearCategoryEntries: entries, yearMaxHours: maxH, yearCondensed: condensed, yearTotalHours: yTotal, yearDates: yDates, monthData };
  }, [schedules, classes, collapseLimit]);

  const cols = isMobile ? 2 : 3;
  const mobileRows = isMobile ? Array.from({ length: Math.ceil(12 / cols) }, (_, row) => {
    const hasData = Array.from({ length: cols }, (_, c) => {
      const m = row * cols + c;
      return m < 12 && byMonth[m].schedules.length > 0;
    }).some(Boolean);
    return hasData ? '1fr' : 'auto';
  }).join(' ') : undefined;

  function changeYear(delta) {
    animDir.current = delta;
    setYear(y => y + delta);
    setAnimKey(k => k + 1);
  }

  const reload = useCallback(() => {
    api.getSchedules(`${year}-01-01`, `${year}-12-31`).then(setSchedules).catch(e => toast(e.message || '加载课表失败'));
  }, [year]);

  const navBtn = "px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-base bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform select-none";
  const actBtn = "px-2 sm:px-3 py-1.5 sm:py-2 text-white rounded text-xs sm:text-sm select-none active:scale-95 transition-transform";

  const swipe = useSimpleSwipe({ onPrev: () => changeYear(-1), onNext: () => changeYear(1) });

  return (
    <div ref={containerRef} tabIndex={-1} className="outline-none h-full flex flex-col" {...swipe}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <button onClick={() => changeYear(-1)} className={navBtn}><span className="sm:hidden">‹</span><span className="hidden sm:inline">上一年</span></button>
        <h2 className="text-base sm:text-xl font-medium">{year}年</h2>
        <div className="flex gap-1 sm:gap-2">
          <button onClick={() => { animDir.current = 0; setYear(new Date().getFullYear()); setAnimKey(k => k + 1); }} className={`${navBtn} px-3 sm:px-4`}>今年</button>
          <button onClick={() => changeYear(1)} className={navBtn}><span className="sm:hidden">›</span><span className="hidden sm:inline">下一年</span></button>
          <div className="flex gap-1 ml-1 sm:ml-2">
            <button onClick={() => setShowBatch(true)} className={actBtn + ' bg-green-600 hover:bg-green-700'}>
              <span className="sm:hidden">批量</span><span className="hidden sm:inline">批量操作</span>
            </button>
            <button disabled={exportHook.exporting} onClick={() => exportHook.openExport(`${year}-01-01`, `${year}-12-31`, { startYear: year, endYear: year })}
              className={actBtn + ' bg-purple-600 hover:bg-purple-700 disabled:opacity-50'}>
              {exportHook.exporting ? '…' : '导出'}
            </button>
          </div>
        </div>
      </div>
      <div key={animKey} className={`flex-1 min-h-0 flex flex-col ${animDir.current > 0 ? 'slide-in-right' : animDir.current < 0 ? 'slide-in-left' : ''}`}>
        <div className={`grid grid-cols-2 sm:grid-cols-3 gap-1 sm:gap-2 flex-1 min-h-0 ${mobileRows ? '' : 'grid-rows-4'}`}
          style={mobileRows ? { gridTemplateRows: mobileRows } : undefined}>
          {Array.from({ length: 12 }, (_, m) => {
            const data = byMonth[m];
            const md = monthData[m];
            const totalHours = md.totalHours;
            const condensed = md.catCondensed;
            const displayEntries = md.catDisplay;
            const categoryEntries = md.categoryEntries;

            return (
              <div key={m} onClick={() => navigate(`/monthly?year=${year}&month=${m}`)}
                className={`bg-gray-100 dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 overflow-hidden p-1.5 sm:p-2 flex flex-col ${
                  totalHours > 0 ? 'justify-between' : isMobile ? '' : 'justify-between'
                }`}
                style={{ fontSize: 'clamp(10px, 1.2vw, 14px)' }}>
                {totalHours === 0 ? (
                  isMobile ? (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">{m + 1}月</span>
                      <span className="text-gray-300 dark:text-gray-600">无排课</span>
                    </div>
                  ) : (
                  <>
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-[1.15em]">{m + 1}月</span>
                      <span className="text-gray-400">0天 · 0次</span>
                      <span className="font-medium text-gray-400">0.0h</span>
                    </div>
                  </div>
                  <div className="flex h-2 rounded overflow-hidden mt-1 bg-gray-200 dark:bg-gray-700" />
                  </>
                  )
                ) : (
                <>
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-[1.15em]">{m + 1}月</span>
                    <span className="text-gray-500 dark:text-gray-400">{data.dates.size}天 · {data.schedules.length}次</span>
                    <span className="font-medium text-blue-600 dark:text-blue-400">{totalHours.toFixed(1)}h</span>
                  </div>
                  {displayEntries.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      {displayEntries.map(entry => {
                        const [label, h, dominantCat] = condensed ? entry : [entry[0], entry[1]];
                        const color = resolveColor(label, dominantCat, dark);
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
                <div className="flex h-2 rounded overflow-hidden mt-1">
                  {displayEntries.map(entry => {
                    const [label, h, dominantCat] = condensed ? entry : [entry[0], entry[1]];
                    const color = resolveColor(label, dominantCat, dark);
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
                </>
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
              {yearDisplayEntries.map(entry => {
                const [label, h, dominantCat] = yearCondensed ? entry : [entry[0], entry[1]];
                const color = resolveColor(label, dominantCat, dark);
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

      {showBatch && (
        <BatchScheduleDialog
          onClose={() => setShowBatch(false)}
          onSaved={() => { setShowBatch(false); reload(); }}
        />
      )}

      {exportHook.showExport && exportHook.exportStart && exportHook.exportEnd && (
        <ExportDialog
          view="year"
          defaultYear={year}
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
