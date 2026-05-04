import { useState, useEffect } from 'react';
import { api } from '../api';
import { refreshHolidays } from '../utils/holidays';

// Built-in holiday data for quick import
const BUILT_IN_HOLIDAYS = {
  '2025': [
    { date: '2025-01-01', type: 'holiday', name: '元旦' },
    { date: '2025-01-28', type: 'holiday', name: '春节' },
    { date: '2025-01-29', type: 'holiday', name: '春节' },
    { date: '2025-01-30', type: 'holiday', name: '春节' },
    { date: '2025-01-31', type: 'holiday', name: '春节' },
    { date: '2025-02-01', type: 'holiday', name: '春节' },
    { date: '2025-02-02', type: 'holiday', name: '春节' },
    { date: '2025-02-03', type: 'holiday', name: '春节' },
    { date: '2025-02-04', type: 'holiday', name: '春节' },
    { date: '2025-04-04', type: 'holiday', name: '清明' },
    { date: '2025-04-05', type: 'holiday', name: '清明' },
    { date: '2025-04-06', type: 'holiday', name: '清明' },
    { date: '2025-05-01', type: 'holiday', name: '劳动节' },
    { date: '2025-05-02', type: 'holiday', name: '劳动节' },
    { date: '2025-05-03', type: 'holiday', name: '劳动节' },
    { date: '2025-05-04', type: 'holiday', name: '劳动节' },
    { date: '2025-05-05', type: 'holiday', name: '劳动节' },
    { date: '2025-05-31', type: 'holiday', name: '端午' },
    { date: '2025-06-01', type: 'holiday', name: '端午' },
    { date: '2025-06-02', type: 'holiday', name: '端午' },
    { date: '2025-10-01', type: 'holiday', name: '国庆' },
    { date: '2025-10-02', type: 'holiday', name: '国庆' },
    { date: '2025-10-03', type: 'holiday', name: '国庆' },
    { date: '2025-10-04', type: 'holiday', name: '国庆' },
    { date: '2025-10-05', type: 'holiday', name: '国庆' },
    { date: '2025-10-06', type: 'holiday', name: '国庆' },
    { date: '2025-10-07', type: 'holiday', name: '国庆' },
    { date: '2025-01-26', type: 'workday', name: '春节调休' },
    { date: '2025-02-08', type: 'workday', name: '春节调休' },
    { date: '2025-04-27', type: 'workday', name: '劳动节调休' },
    { date: '2025-09-28', type: 'workday', name: '国庆调休' },
    { date: '2025-10-11', type: 'workday', name: '国庆调休' },
  ],
  '2026': [
    { date: '2026-01-01', type: 'holiday', name: '元旦' },
    { date: '2026-01-02', type: 'holiday', name: '元旦' },
    { date: '2026-02-16', type: 'holiday', name: '春节' },
    { date: '2026-02-17', type: 'holiday', name: '春节' },
    { date: '2026-02-18', type: 'holiday', name: '春节' },
    { date: '2026-02-19', type: 'holiday', name: '春节' },
    { date: '2026-02-20', type: 'holiday', name: '春节' },
    { date: '2026-02-21', type: 'holiday', name: '春节' },
    { date: '2026-02-22', type: 'holiday', name: '春节' },
    { date: '2026-04-05', type: 'holiday', name: '清明' },
    { date: '2026-04-06', type: 'holiday', name: '清明' },
    { date: '2026-04-07', type: 'holiday', name: '清明' },
    { date: '2026-05-01', type: 'holiday', name: '劳动节' },
    { date: '2026-05-02', type: 'holiday', name: '劳动节' },
    { date: '2026-05-03', type: 'holiday', name: '劳动节' },
    { date: '2026-05-04', type: 'holiday', name: '劳动节' },
    { date: '2026-05-05', type: 'holiday', name: '劳动节' },
    { date: '2026-06-19', type: 'holiday', name: '端午' },
    { date: '2026-06-20', type: 'holiday', name: '端午' },
    { date: '2026-06-21', type: 'holiday', name: '端午' },
    { date: '2026-10-01', type: 'holiday', name: '国庆' },
    { date: '2026-10-02', type: 'holiday', name: '国庆' },
    { date: '2026-10-03', type: 'holiday', name: '国庆' },
    { date: '2026-10-04', type: 'holiday', name: '国庆' },
    { date: '2026-10-05', type: 'holiday', name: '国庆' },
    { date: '2026-10-06', type: 'holiday', name: '国庆' },
    { date: '2026-10-07', type: 'holiday', name: '国庆' },
    { date: '2026-01-24', type: 'workday', name: '春节调休' },
    { date: '2026-02-07', type: 'workday', name: '春节调休' },
    { date: '2026-04-26', type: 'workday', name: '劳动节调休' },
    { date: '2026-09-27', type: 'workday', name: '国庆调休' },
    { date: '2026-10-10', type: 'workday', name: '国庆调休' },
  ],
  '2027': [
    { date: '2027-01-01', type: 'holiday', name: '元旦' },
    { date: '2027-01-02', type: 'holiday', name: '元旦' },
    { date: '2027-02-06', type: 'holiday', name: '春节' },
    { date: '2027-02-07', type: 'holiday', name: '春节' },
    { date: '2027-02-08', type: 'holiday', name: '春节' },
    { date: '2027-02-09', type: 'holiday', name: '春节' },
    { date: '2027-02-10', type: 'holiday', name: '春节' },
    { date: '2027-02-11', type: 'holiday', name: '春节' },
    { date: '2027-02-12', type: 'holiday', name: '春节' },
    { date: '2027-04-05', type: 'holiday', name: '清明' },
    { date: '2027-04-06', type: 'holiday', name: '清明' },
    { date: '2027-05-01', type: 'holiday', name: '劳动节' },
    { date: '2027-05-02', type: 'holiday', name: '劳动节' },
    { date: '2027-05-03', type: 'holiday', name: '劳动节' },
    { date: '2027-06-09', type: 'holiday', name: '端午' },
    { date: '2027-06-10', type: 'holiday', name: '端午' },
    { date: '2027-06-11', type: 'holiday', name: '端午' },
    { date: '2027-10-01', type: 'holiday', name: '国庆' },
    { date: '2027-10-02', type: 'holiday', name: '国庆' },
    { date: '2027-10-03', type: 'holiday', name: '国庆' },
    { date: '2027-10-04', type: 'holiday', name: '国庆' },
    { date: '2027-10-05', type: 'holiday', name: '国庆' },
    { date: '2027-10-06', type: 'holiday', name: '国庆' },
    { date: '2027-10-07', type: 'holiday', name: '国庆' },
    { date: '2027-01-23', type: 'workday', name: '春节调休' },
    { date: '2027-02-06', type: 'workday', name: '春节调休' },
    { date: '2027-04-25', type: 'workday', name: '劳动节调休' },
    { date: '2027-09-26', type: 'workday', name: '国庆调休' },
    { date: '2027-10-09', type: 'workday', name: '国庆调休' },
  ],
};

export default function HolidayManager() {
  const [holidays, setHolidays] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ date: '', type: 'holiday', name: '' });
  const [importing, setImporting] = useState(false);

  function reload() {
    api.getHolidays().then(setHolidays).catch(() => {});
  }

  useEffect(() => { reload(); }, []);

  const yearHolidays = holidays.filter(h => h.date.startsWith(String(year)));
  const holidayDays = yearHolidays.filter(h => h.type === 'holiday');
  const workdays = yearHolidays.filter(h => h.type === 'workday');

  async function addHoliday() {
    if (!form.date) return;
    try {
      await api.createHoliday(form);
      setShowAdd(false);
      setForm({ date: '', type: 'holiday', name: '' });
      reload();
      refreshHolidays();
    } catch (e) { alert(e.message || '添加失败'); }
  }

  async function removeHoliday(id) {
    try {
      await api.deleteHoliday(id);
      reload();
      refreshHolidays();
    } catch (e) { alert(e.message || '删除失败'); }
  }

  async function importYear() {
    setImporting(true);
    try {
      const items = BUILT_IN_HOLIDAYS[String(year)];
      if (!items) { alert(`${year}年暂无内置数据`); return; }
      const res = await api.batchImportHolidays(items);
      alert(`导入完成：新增 ${res.count} 条记录`);
      reload();
      refreshHolidays();
    } finally {
      setImporting(false);
    }
  }

  const typeLabel = { holiday: '节假日', workday: '调休上班' };
  const typeBadge = { holiday: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', workday: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };

  return (
    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
      <h3 className="font-bold mb-3">法定节假日管理</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        管理节假日和调休上班日。批量排课时会自动排除节假日，调休上班日会在日历中标注。
      </p>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)}
            className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">◀</button>
          <span className="w-20 text-center font-medium">{year}年</span>
          <button onClick={() => setYear(y => y + 1)}
            className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">▶</button>
        </div>
        <button onClick={importYear} disabled={importing}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
          {importing ? '导入中...' : `导入${year}年默认数据`}
        </button>
        <button onClick={() => { setShowAdd(true); setForm({ date: `${year}-`, type: 'holiday', name: '' }); }}
          className="px-3 py-1 bg-green-600 text-white rounded text-sm">手动添加</button>
      </div>

      {showAdd && (
        <div className="flex gap-2 mb-4 p-3 bg-white dark:bg-gray-700 rounded">
          <input type="date" className="p-2 bg-gray-100 dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded text-sm"
            value={form.date} onChange={e => setForm({...form, date: e.target.value})} />
          <select className="p-2 bg-gray-100 dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded text-sm"
            value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
            <option value="holiday">节假日</option>
            <option value="workday">调休上班</option>
          </select>
          <input className="flex-1 p-2 bg-gray-100 dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded text-sm"
            placeholder="名称（如：春节）" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          <button onClick={addHoliday} className="px-3 py-2 bg-blue-600 text-white rounded text-sm">添加</button>
          <button onClick={() => setShowAdd(false)} className="px-3 py-2 bg-gray-300 dark:bg-gray-600 rounded text-sm">取消</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium mb-2 text-red-600 dark:text-red-400">节假日 ({holidayDays.length}天)</h4>
          {holidayDays.length === 0 ? (
            <p className="text-gray-400 text-sm">暂无数据，点击「导入默认数据」</p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-auto">
              {holidayDays.sort((a, b) => a.date.localeCompare(b.date)).map(h => (
                <div key={h.id} className="flex items-center justify-between p-2 bg-white dark:bg-gray-700 rounded text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${typeBadge[h.type]}`}>{typeLabel[h.type]}</span>
                    <span>{h.date}</span>
                    {h.name && <span className="text-gray-500 dark:text-gray-400">{h.name}</span>}
                  </div>
                  <button onClick={() => removeHoliday(h.id)} className="text-red-400 hover:text-red-300 text-xs">删除</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className="text-sm font-medium mb-2 text-orange-600 dark:text-orange-400">调休上班 ({workdays.length}天)</h4>
          {workdays.length === 0 ? (
            <p className="text-gray-400 text-sm">暂无数据</p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-auto">
              {workdays.sort((a, b) => a.date.localeCompare(b.date)).map(h => (
                <div key={h.id} className="flex items-center justify-between p-2 bg-white dark:bg-gray-700 rounded text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${typeBadge[h.type]}`}>{typeLabel[h.type]}</span>
                    <span>{h.date}</span>
                    {h.name && <span className="text-gray-500 dark:text-gray-400">{h.name}</span>}
                  </div>
                  <button onClick={() => removeHoliday(h.id)} className="text-red-400 hover:text-red-300 text-xs">删除</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
