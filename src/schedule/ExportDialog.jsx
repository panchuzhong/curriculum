import { useState } from 'react';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ExportDialog({ defaultStart, defaultEnd, onClose, onExportPNG, onExportCSV }) {
  const today = todayStr();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(defaultEnd);
  const [exporting, setExporting] = useState(false);

  const startD = new Date(start + 'T00:00:00');
  const endD = new Date(end + 'T00:00:00');
  const days = Math.max(1, Math.round((endD - startD) / 86400000) + 1);

  async function handlePNG() {
    setExporting(true);
    try { await onExportPNG(start, end); }
    finally { setExporting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="modal-enter bg-white dark:bg-gray-800 rounded-2xl p-6 w-[480px] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">导出课表</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-sm transition-colors leading-none">✕</button>
        </div>
        <div className="space-y-4">
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
              }} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">当周</button>
              <button onClick={() => {
                const mon = getMonday(addDays(today, -7));
                setStart(mon);
                setEnd(addDays(mon, 6));
              }} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">上周</button>
              <button onClick={() => setEnd(addDays(start, 6))}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">1周</button>
              <button onClick={() => setEnd(addDays(start, 13))}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">2周</button>
              <button onClick={() => {
                const d = new Date();
                const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                setStart(first);
                setEnd(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`);
              }} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">当月</button>
              <button onClick={() => setEnd(addDays(start, 29))}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">1个月</button>
            </div>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400">
            共 {days} 天，图片宽度约 {Math.max(800, days * 320)}px
          </p>

          <div className="flex gap-3 mt-4">
            <button onClick={handlePNG} disabled={exporting}
              className="flex-1 p-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium">
              {exporting ? '生成中...' : '导出 PNG'}
            </button>
            <button onClick={() => onExportCSV(start, end)}
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
