import { useState, useEffect, useLayoutEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { api } from '../api';
import { getClassColor, subjectHue, DarkContext } from '../utils/colors';
import { DATE_MIN, DATE_MAX } from '../utils/constants';
import { todayStr, getMonday, addDays, getMonthRange, getYearRange, dateRangeError, isUsableDate, clampDate, clampYear, stepMonthTarget, YEAR_MIN, YEAR_MAX } from '../utils/date';
import { useToast } from '../components/ToastProvider';
import useBoundWarning from '../hooks/useBoundWarning';
import { shortcutBlocked } from '../utils/keys';

function groupBy(arr, fn) {
  const map = Object.create(null);
  arr.forEach(item => {
    const key = fn(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  });
  return map;
}

// Unrounded server floats (800 × 35/60 = 466.666…) must not print three decimals.
const fmtNum = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function StatCard({ label, value, unit, accent, icon }) {
  return (
    <div className="flex-1 rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="h-1" style={{ background: accent }} />
      <div className="p-2 sm:p-4 flex items-start justify-between gap-1 sm:gap-2">
        <div className="min-w-0">
          <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{label}</div>
          <div className="text-base sm:text-2xl font-bold mt-0.5 sm:mt-1 truncate" style={{ color: accent }}>
            {typeof value === 'number' ? fmtNum(value) : value}
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
        <div key={item.key ?? item.label} className="flex items-center gap-2">
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
  // 按钮会变灰，但方向键走的是同一组 step 函数，得自己说一声。
  const warnAtBound = useBoundWarning();
  const [tab, setTab] = useState('week'); // week | month | year | custom
  const [classes, setClasses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reportError, setReportError] = useState('');
  const [period, setPeriod] = useState(null);
  const [weekStart, setWeekStart] = useState(() => getMonday(todayStr()));
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [filterClassId, setFilterClassId] = useState('');
  const [customStart, setCustomStart] = useState(todayStr());
  const [customEnd, setCustomEnd] = useState(todayStr());
  // Generation guard: a stale summary response (rapid period switching) must not overwrite newer data
  const fetchGenRef = useRef(0);

  useEffect(() => { api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败')); }, []);

  useEffect(() => {
    const gen = ++fetchGenRef.current;
    let start, end;

    if (tab === 'week') {
      start = weekStart;
      // 最后一周的尾巴会超出 DATE_MAX；不夹的话整个区间被判为无效，连请求都不发，
      // 而周报没有提示语（那是自定义 tab 才有的），按钮就成了一个死键。
      end = clampDate(addDays(start, 6));
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

    // 原生年份段多打一位会把年份左移（2026 → 0261）：位数正确、比大小也"正常"，
    // 区间却变成 0261 至今，卡片会显示一个看似合理的全历史聚合。用不了的日期不发请求。
    // 拒绝的理由要原样显给用户，所以和下面的提示共用 dateRangeError。
    if (dateRangeError(start, end)) {
      setLoading(false);
      return;
    }
    setPeriod({ start, end });
    setLoading(true);
    setReportError('');
    // Filter server-side so every dimension (including byMonth) follows the
    // class filter — byMonth cannot be filtered client-side.
    api.getScheduleSummary(start, end, filterClassId || undefined)
      .then(data => { if (gen === fetchGenRef.current) setSummary(data); })
      .catch(e => { if (gen === fetchGenRef.current) setReportError(e.message || '加载报表失败'); })
      .finally(() => { if (gen === fetchGenRef.current) setLoading(false); });
    return () => { fetchGenRef.current++; };
  }, [tab, weekStart, year, month, customStart, customEnd, filterClassId]);

  const loadWeek = useCallback((monday) => {
    setWeekStart(monday);
    // Keep the visible range in the same React update as the durable week
    // state. Waiting for the fetch effect to copy weekStart into period leaves
    // one render where the navigation action has completed but the old range
    // is still shown.
    setPeriod({ start: monday, end: clampDate(addDays(monday, 6)) });
  }, []);

  // 周/月/年的区间是翻页翻出来的，不是打出来的：翻到上下限之外，拉数据的 effect
  // 会拒掉这个区间、连请求都不发，而标题照常显示「1899年」，下面还摆着 1900 年的卡片。
  // 自定义 tab 靠提示语说明原因，这三个 tab 用户改不了区间，干脆翻不出去。
  // 从 weekStart 推，不从 period.start：period 是四个 tab 共用的，切回周报的那一帧里
  // 它还装着月/年的区间（要等拉数据的 effect 落地才同步）。拿月首去加一周，
  // 落点根本不是周一，之后翻页就一直歪着。weekStart 始终是周一（初始值过 getMonday，
  // 之后只由 loadWeek 写），也不需要等请求回来。
  const stepWeek = useCallback((delta) => {
    // 夹周首会得到一个周二开头的「一天周」（2999-12-31 是周二），再往回翻就一路
    // 变成周二~周一。周首出界就不翻；区间的尾巴由 loadWeek 和上面的 effect 夹回去，
    // 所以最后一个完整周（周一 2999-12-30）仍然翻得到。
    const monday = addDays(weekStart, delta * 7);
    if (!isUsableDate(monday)) {
      warnAtBound(`已到可用日期范围的${delta < 0 ? '最早' : '最晚'}一周`);
      return;
    }
    loadWeek(monday);
  }, [weekStart, loadWeek, warnAtBound]);

  const stepMonth = useCallback((delta) => {
    const next = stepMonthTarget(year, month, delta);
    if (!next) {
      warnAtBound(`已到可用日期范围的${delta < 0 ? '最早' : '最晚'}一个月`);
      return;
    }
    setYear(next.year);
    setMonth(next.month);
  }, [year, month, warnAtBound]);

  // 夹而不拒的话，到了 2999 再按右方向键就是一次静默的原地踏步。
  const stepYear = useCallback((delta) => {
    const next = clampYear(year + delta);
    if (next === year) {
      warnAtBound(`已到可用日期范围的${delta < 0 ? '最早' : '最晚'}一年`);
      return;
    }
    setYear(next);
  }, [year, warnAtBound]);

  useLayoutEffect(() => {
    const onKey = (e) => {
      if (shortcutBlocked(e)) return;
      if (e.key === 'Home') {
        e.preventDefault();
        if (tab === 'week') { loadWeek(getMonday(todayStr())); }
        else if (tab === 'month') { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); }
        else if (tab === 'year') { setYear(new Date().getFullYear()); }
        else { setCustomStart(todayStr()); setCustomEnd(todayStr()); }
        return;
      }
      if (tab === 'week' && period) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepWeek(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); stepWeek(1); }
      } else if (tab === 'month') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepMonth(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); stepMonth(1); }
      } else if (tab === 'year') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepYear(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); stepYear(1); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, period, loadWeek, stepWeek, stepMonth, stepYear]);

  const classMap = useMemo(() => {
    const m = {};
    classes.forEach(c => m[c.id] = c);
    return m;
  }, [classes]);

  const { totalCount, totalHours, totalRevenue, subjectData, gradeData, classData, monthData } = useMemo(() => {
    if (!summary) return { totalCount: 0, totalHours: 0, totalRevenue: 0, subjectData: [], gradeData: [], classData: [], monthData: [] };

    const filteredByClass = filterClassId
      ? summary.byClass.filter(b => b.classId === +filterClassId)
      : summary.byClass;

    const totalCount = filteredByClass.reduce((s, b) => s + b.count, 0);
    const totalHours = filteredByClass.reduce((s, b) => s + b.hours, 0);
    const totalRevenue = filteredByClass.reduce((s, b) => s + b.revenue, 0);

    // By subject (课内/竞赛自动分类) — regroup from byClass which has isCompetition
    const byCatKey = groupBy(filteredByClass, b => `${b.isCompetition ? '竞赛' : '课内'}${b.subject}`);
    const subjectData = Object.entries(byCatKey)
      .map(([label, items]) => {
        const subject = items[0].subject;
        const comp = items[0].isCompetition;
        // 必须走 colors.js 的 subjectHue：它对预设之外的学科有哈希兜底。
        // 这里原本自己查了一遍 SUBJECT_HUES，查不到就回落成 {h:0,s:0}——
        // 于是老师在设置里自定义的学科（编程、美术、奥数…）在这张图上全是同一个灰，
        // 彼此分不开，也和课表方块、设置页色块、导出 PNG 里的颜色对不上。
        const hue = subjectHue(subject);
        return {
          label,
          value: items.reduce((s, b) => s + b.count, 0),
          hours: items.reduce((s, b) => s + b.hours, 0),
          revenue: items.reduce((s, b) => s + b.revenue, 0),
          color: `hsl(${hue.h}, ${hue.s}%, ${comp ? 35 : 50}%)`,
        };
      })
      .sort((a, b) => b.value - a.value);

    // By grade — regroup from byClass
    const byGrade = groupBy(filteredByClass, b => b.grade);
    const gradeData = Object.entries(byGrade)
      .map(([grade, items]) => ({
        label: grade,
        value: items.reduce((s, b) => s + b.count, 0),
        hours: items.reduce((s, b) => s + b.hours, 0),
        revenue: items.reduce((s, b) => s + b.revenue, 0),
        color: '#6366f1',
      }))
      .sort((a, b) => b.value - a.value);

    // By class — use byClass directly
    const classData = filteredByClass
      .map(b => {
        const cls = classMap[b.classId] || b;
        return {
          key: b.classId,
          label: b.name,
          value: b.count,
          hours: b.hours,
          revenue: b.revenue,
          color: getClassColor(cls, dark),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // By month — use byMonth from summary
    // 标签只写「5月」的话，自定义区间跨了两个自然年时会出现两条一模一样的「5月」，
    // 老师分不出哪条是哪年；而 BarChart 的 key 取的是 item.key ?? item.label，
    // 于是这两条还共用同一个 React key——切换班级筛选时可能把彼此的宽度/文案串了。
    // 跨年时把年份写进标签，并且始终给一个唯一的 key（月份本身）。
    // （原来这里挂的 sortKey 没人读：服务端返回的 byMonth 已经按月份升序排好了。）
    const months = summary.byMonth || [];
    const multiYear = new Set(months.map(m => m.month.slice(0, 4))).size > 1;
    const monthData = months.map(m => {
      const [y, mo] = m.month.split('-');
      return {
        key: m.month,
        label: multiYear ? `${y}年${parseInt(mo)}月` : `${parseInt(mo)}月`,
        value: m.count,
        hours: m.hours,
        revenue: m.revenue,
        color: '#6366f1',
      };
    });

    return { totalCount, totalHours, totalRevenue, subjectData, gradeData, classData, monthData };
  }, [summary, filterClassId, classMap, dark]);

  // 越界的一步 stepWeek 直接不走；按钮还亮着的话点下去毫无反应，和卡死了没区别。
  const canStepWeek = (delta) => isUsableDate(addDays(weekStart, delta * 7));

  // 自定义区间被拒时的说明：填了但用不了（含年份段被原生控件左移的情况）、
  // 倒挂，或清空了其中一端——三种情况上面都不发请求，都得有说法。
  const customRangeError = dateRangeError(customStart, customEnd);
  const customRangeHint = customRangeError && `${customRangeError}，图表为上一有效区间的数据`;

  if (!period) return null;

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
            <button onClick={() => stepWeek(-1)} disabled={!canStepWeek(-1)} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm disabled:opacity-40">◀</button>
            <span className="text-xs sm:text-sm tabular-nums text-center min-w-[140px] sm:w-48">{period.start} ~ {period.end}</span>
            <button onClick={() => stepWeek(1)} disabled={!canStepWeek(1)} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm disabled:opacity-40">▶</button>
            <button onClick={() => loadWeek(getMonday(todayStr()))} className="px-2 sm:px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs sm:text-sm hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">本周</button>
          </div>
        )}
        {tab === 'month' && (
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => stepMonth(-1)} disabled={year <= YEAR_MIN && month === 0}
              className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform disabled:opacity-40">◀</button>
            <span className="text-xs sm:text-sm text-center min-w-[80px] sm:w-32">{year}年{month + 1}月</span>
            <button onClick={() => stepMonth(1)} disabled={year >= YEAR_MAX && month === 11}
              className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform disabled:opacity-40">▶</button>
            <button onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); }}
              className="px-2 sm:px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs sm:text-sm hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">本月</button>
          </div>
        )}
        {tab === 'year' && (
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => stepYear(-1)} disabled={year <= YEAR_MIN}
              className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform disabled:opacity-40">◀</button>
            <span className="text-xs sm:text-sm text-center min-w-[60px] sm:w-20">{year}年</span>
            <button onClick={() => stepYear(1)} disabled={year >= YEAR_MAX}
              className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform disabled:opacity-40">▶</button>
            <button onClick={() => setYear(new Date().getFullYear())}
              className="px-2 sm:px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs sm:text-sm hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">今年</button>
          </div>
        )}
        {tab === 'custom' && (
          <div className="flex items-center gap-1 sm:gap-2">
            <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-xs sm:text-sm" />
            <span className="text-gray-400">~</span>
            <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-xs sm:text-sm" />
            {/* 区间被拒时不发请求，下面卡片仍是上一个有效区间的数据；不给提示的话
                这些数字看起来就像当前区间的结果。 */}
            {customRangeHint && (
              <span className="text-xs text-red-500">{customRangeHint}</span>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <p role="status" className="text-center py-16 text-gray-500">正在加载报表…</p>
      ) : reportError ? (
        <p role="alert" className="text-center py-16 text-red-500">报表加载失败：{reportError}</p>
      ) : <>
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-3 sm:mb-6">
        <StatCard label="排课次数" value={totalCount} unit="次" accent="#3b82f6" icon="📅" />
        <StatCard label="教学时长" value={totalHours} unit="小时" accent="#8b5cf6" icon="⏱" />
        <StatCard label="预估收入" value={`¥${fmtNum(totalRevenue)}`} accent="#22c55e" icon="💰" />
      </div>

      {totalCount === 0 ? (
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
                display: `${d.value}次 / ${d.hours.toFixed(1)}h / ¥${fmtNum(d.revenue)}`,
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
                display: `${d.value}次 / ${d.hours.toFixed(1)}h / ¥${fmtNum(d.revenue)}`,
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
                  display: `${d.value}次 / ¥${fmtNum(d.revenue)}`,
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
                    <tr key={d.key ?? d.label} className="border-b border-gray-200 dark:border-gray-700">
                      <td className="p-2 flex items-center gap-2">
                        <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: d.color }} />
                        {d.label}
                      </td>
                      <td className="text-right p-2">{d.value} 次</td>
                      <td className="text-right p-2">{d.hours.toFixed(1)} 小时</td>
                      <td className="text-right p-2 text-green-600 dark:text-green-400">¥{fmtNum(d.revenue)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="p-2">合计</td>
                    <td className="text-right p-2">{totalCount} 次</td>
                    <td className="text-right p-2">{totalHours.toFixed(1)} 小时</td>
                    <td className="text-right p-2 text-green-600 dark:text-green-400">¥{fmtNum(totalRevenue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}
