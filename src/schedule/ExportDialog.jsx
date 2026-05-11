import { useState, useEffect } from 'react';
import { todayStr, getMonday, addDays, parseDateStr } from '../utils/date';

const MONTHS = [
  { value: 0, label: '1月' }, { value: 1, label: '2月' }, { value: 2, label: '3月' },
  { value: 3, label: '4月' }, { value: 4, label: '5月' }, { value: 5, label: '6月' },
  { value: 6, label: '7月' }, { value: 7, label: '8月' }, { value: 8, label: '9月' },
  { value: 9, label: '10月' }, { value: 10, label: '11月' }, { value: 11, label: '12月' },
];

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function monthDiff(sy, sm, ey, em) {
  return (ey - sy) * 12 + (em - sm) + 1;
}

export default function ExportDialog({ view = 'week', defaultStart, defaultEnd, defaultYear, defaultMonth, onClose, onExportPNG, onExportCSV }) {
  const today = todayStr();
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  // ── Week state ──
  const [start, setStart] = useState(defaultStart || today);
  const [end, setEnd] = useState(defaultEnd || today);

  // ── Month state ──
  const [startYear, setStartYear] = useState(defaultYear ?? curYear);
  const [startMonth, setStartMonth] = useState(defaultMonth ?? curMonth);
  const [endYear, setEndYear] = useState(defaultYear ?? curYear);
  const [endMonth, setEndMonth] = useState(defaultMonth ?? curMonth);

  // ── Year state ──
  const [yStartYear, setYStartYear] = useState(defaultYear ?? curYear);
  const [yEndYear, setYEndYear] = useState(defaultYear ?? curYear);

  const [exporting, setExporting] = useState(false);

  // ── Compute date range from month/year selections ──
  function monthRangeToDates() {
    const s = `${startYear}-${String(startMonth + 1).padStart(2, '0')}-01`;
    const e = `${endYear}-${String(endMonth + 1).padStart(2, '0')}-${String(daysInMonth(endYear, endMonth)).padStart(2, '0')}`;
    return { start: s, end: e };
  }

  function yearRangeToDates() {
    const s = `${yStartYear}-01-01`;
    const e = `${yEndYear}-12-31`;
    return { start: s, end: e };
  }

  // ── PNG handler ──
  async function handlePNG() {
    setExporting(true);
    try {
      if (view === 'month') {
        const { start: s, end: e } = monthRangeToDates();
        await onExportPNG(s, e, { startYear, startMonth, endYear, endMonth });
      } else if (view === 'year') {
        const { start: s, end: e } = yearRangeToDates();
        await onExportPNG(s, e, { startYear: yStartYear, endYear: yEndYear });
      } else {
        await onExportPNG(start, end, {});
      }
    } finally {
      setExporting(false);
    }
  }

  // ── CSV handler ──
  function handleCSV() {
    if (view === 'month') {
      const { start: s, end: e } = monthRangeToDates();
      onExportCSV(s, e);
    } else if (view === 'year') {
      const { start: s, end: e } = yearRangeToDates();
      onExportCSV(s, e);
    } else {
      onExportCSV(start, end);
    }
  }

  // ── Shared styles ──
  const sel = 'p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm';
  const quickBtn = 'px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600';

  // ── Week view helpers ──
  const startD = parseDateStr(start);
  const endD = parseDateStr(end);
  const days = (startD && endD && !isNaN(startD) && !isNaN(endD))
    ? Math.max(1, Math.round((endD - startD) / 86400000) + 1) : 0;

  const nMonths = view === 'month' ? monthDiff(startYear, startMonth, endYear, endMonth) : 0;
  const nYears = view === 'year' ? (yEndYear - yStartYear + 1) : 0;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3" onClick={onClose}>
      <div className="modal-enter bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 w-full max-w-[480px] max-h-[90vh] overflow-auto thin-scroll shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">导出课表</h3>
          <button onClick={onClose} aria-label="关闭" className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-sm transition-colors leading-none">✕</button>
        </div>

        <div className="space-y-4">
          {/* ═══ Week: date pickers ═══ */}
          {view === 'week' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始日期</label>
                  <input type="date"
                    className="w-full p-3 text-base bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
                    value={start} onChange={e => setStart(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束日期</label>
                  <input type="date"
                    className="w-full p-3 text-base bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
                    value={end} onChange={e => setEnd(e.target.value)} />
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">快捷选择：</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => {
                    const mon = getMonday(today);
                    setStart(mon);
                    setEnd(addDays(mon, 6));
                  }} className={quickBtn}>当周</button>
                  <button onClick={() => {
                    const mon = getMonday(addDays(today, -7));
                    setStart(mon);
                    setEnd(addDays(mon, 6));
                  }} className={quickBtn}>上周</button>
                  <button onClick={() => {
                    setStart(today);
                    setEnd(addDays(today, 6));
                  }} className={quickBtn}>1周</button>
                  <button onClick={() => {
                    setStart(today);
                    setEnd(addDays(today, 13));
                  }} className={quickBtn}>2周</button>
                  <button onClick={() => {
                    const d = new Date();
                    const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                    setStart(first);
                    setEnd(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`);
                  }} className={quickBtn}>当月</button>
                  <button onClick={() => {
                    setStart(today);
                    setEnd(addDays(today, 29));
                  }} className={quickBtn}>1个月</button>
                </div>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                共 {days} 天，图片宽度约 {Math.max(800, days * 320)}px
              </p>
            </>
          )}

          {/* ═══ Month: year+month range selectors ═══ */}
          {view === 'month' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1.5">开始</label>
                  <div className="flex gap-2">
                    <select className={sel} value={startYear} onChange={e => setStartYear(+e.target.value)}>
                      {Array.from({ length: 5 }, (_, i) => curYear - 2 + i).map(y => (
                        <option key={y} value={y}>{y}年</option>
                      ))}
                    </select>
                    <select className={sel} value={startMonth} onChange={e => setStartMonth(+e.target.value)}>
                      {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1.5">结束</label>
                  <div className="flex gap-2">
                    <select className={sel} value={endYear} onChange={e => setEndYear(+e.target.value)}>
                      {Array.from({ length: 5 }, (_, i) => curYear - 2 + i).map(y => (
                        <option key={y} value={y}>{y}年</option>
                      ))}
                    </select>
                    <select className={sel} value={endMonth} onChange={e => setEndMonth(+e.target.value)}>
                      {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 mt-3">快捷选择：</p>
                <div className="grid grid-cols-4 gap-2">
                  <button onClick={() => {
                    setStartYear(curYear); setStartMonth(curMonth);
                    setEndYear(curYear); setEndMonth(curMonth);
                  }} className={quickBtn}>当月</button>
                  <button onClick={() => {
                    setStartYear(curYear); setStartMonth(curMonth);
                    let em = curMonth + 2, ey = curYear;
                    if (em > 11) { em -= 12; ey++; }
                    setEndYear(ey); setEndMonth(em);
                  }} className={quickBtn}>近3个月</button>
                  <button onClick={() => {
                    setStartYear(curYear); setStartMonth(curMonth);
                    let em = curMonth + 5, ey = curYear;
                    if (em > 11) { em -= 12; ey++; }
                    setEndYear(ey); setEndMonth(em);
                  }} className={quickBtn}>近6个月</button>
                  <button onClick={() => {
                    setStartYear(curYear); setStartMonth(0);
                    setEndYear(curYear); setEndMonth(11);
                  }} className={quickBtn}>今年全年</button>
                </div>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                共 {nMonths} 个月
              </p>
            </>
          )}

          {/* ═══ Year: year range selectors ═══ */}
          {view === 'year' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1.5">开始</label>
                  <select className={sel + ' w-full'} value={yStartYear} onChange={e => setYStartYear(+e.target.value)}>
                    {Array.from({ length: 7 }, (_, i) => curYear - 3 + i).map(y => (
                      <option key={y} value={y}>{y}年</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1.5">结束</label>
                  <select className={sel + ' w-full'} value={yEndYear} onChange={e => setYEndYear(+e.target.value)}>
                    {Array.from({ length: 7 }, (_, i) => curYear - 3 + i).map(y => (
                      <option key={y} value={y}>{y}年</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 mt-3">快捷选择：</p>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => { setYStartYear(curYear); setYEndYear(curYear); }}
                    className={quickBtn}>今年</button>
                  <button onClick={() => { setYStartYear(curYear); setYEndYear(curYear + 2); }}
                    className={quickBtn}>近3年</button>
                  <button onClick={() => { setYStartYear(curYear); setYEndYear(curYear + 4); }}
                    className={quickBtn}>近5年</button>
                </div>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                共 {nYears} 年
              </p>
            </>
          )}

          <div className="flex gap-3 mt-4">
            <button onClick={handlePNG} disabled={exporting}
              className="flex-1 p-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium">
              {exporting ? '生成中...' : '导出 PNG'}
            </button>
            <button onClick={handleCSV}
              className="flex-1 p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
              导出 CSV
            </button>
            <button onClick={onClose}
              className="p-3 bg-gray-300 dark:bg-gray-600 rounded-lg">取消</button>
          </div>
        </div>
      </div>
    </div>
  );
}
