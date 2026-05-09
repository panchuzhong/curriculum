import { useState, useEffect } from 'react';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';

const TYPES = [
  { value: 'spring', label: '春季' },
  { value: 'fall', label: '秋季' },
  { value: 'winter', label: '寒假' },
  { value: 'summer', label: '暑假' },
];

const SEMESTER_ORDER = ['spring', 'summer', 'fall', 'winter'];

const SEMESTER_TEMPLATES = {
  spring: (y) => ({ name: `${y}春季`, type: 'spring', startDate: `${y}-02-23`, endDate: `${y}-07-05` }),
  summer: (y) => ({ name: `${y}暑假`, type: 'summer', startDate: `${y}-07-07`, endDate: `${y}-08-31` }),
  fall:   (y) => ({ name: `${y}秋季`, type: 'fall', startDate: `${y}-09-01`, endDate: `${y + 1}-01-15` }),
  winter: (y) => ({ name: `${y}寒假`, type: 'winter', startDate: `${y + 1}-01-15`, endDate: `${y + 1}-02-20` }),
};

function getDefaultsFromSemesters(semesters) {
  if (!semesters || semesters.length === 0) {
    // No semesters yet, use current date to guess
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    if (m >= 2 && m <= 7) return SEMESTER_TEMPLATES.spring(y);
    if (m >= 8 && m <= 9) return SEMESTER_TEMPLATES.summer(y);
    if (m >= 10) return SEMESTER_TEMPLATES.fall(y);
    return SEMESTER_TEMPLATES.winter(y - 1);
  }

  // Find the latest semester by end date
  const sorted = [...semesters].sort((a, b) => a.endDate.localeCompare(b.endDate));
  const latest = sorted[sorted.length - 1];
  const endYear = parseInt(latest.endDate.slice(0, 4));
  const idx = SEMESTER_ORDER.indexOf(latest.type);
  const nextIdx = (idx + 1) % 4;
  const nextType = SEMESTER_ORDER[nextIdx];
  const nextYear = nextIdx <= idx ? endYear + 1 : endYear; // wrap around = next year
  return SEMESTER_TEMPLATES[nextType](nextYear);
}

export default function SemesterManager() {
  const toast = useToast();
  const [semesters, setSemesters] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSemesters().then(s => {
      setSemesters(s);
      setForm(getDefaultsFromSemesters(s));
    }).catch(e => toast(e.message || '加载学期失败'));
  }, []);

  function reload() {
    api.getSemesters().then(setSemesters).catch(e => toast(e.message || '加载学期失败'));
  }

  async function handleCreate() {
    if (!form.name || !form.startDate || !form.endDate || saving) return;
    setSaving(true);
    try {
      await api.createSemester(form);
      setShowForm(false);
      api.getSemesters().then(s => {
        setSemesters(s);
        setForm(getDefaultsFromSemesters(s));
      }).catch(e => toast(e.message || '加载学期失败'));
    } catch (e) { toast(e.message || '创建失败'); }
    finally { setSaving(false); }
  }

  async function handleUpdate() {
    if (!form.name || !form.startDate || !form.endDate || saving) return;
    setSaving(true);
    try {
      await api.updateSemester(editing.id, form);
      setEditing(null);
      reload();
    } catch (e) { toast(e.message || '更新失败'); }
    finally { setSaving(false); }
  }

  function startEdit(s) {
    setEditing(s);
    setForm({ name: s.name, type: s.type, startDate: s.startDate, endDate: s.endDate });
  }

  async function handleDelete(id) {
    if (saving) return;
    if (!confirm('确定删除此学期？')) return;
    setSaving(true);
    try {
      await api.deleteSemester(id);
      reload();
    } catch (e) { toast(e.message || '删除失败'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl">学期管理</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); setForm(getDefaultsFromSemesters(semesters)); }}
          className="px-4 py-2 bg-blue-600 text-white rounded">新建学期</button>
      </div>

      {(showForm || editing) && (
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">名称</label>
              <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                placeholder="如：2026春季" />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">类型</label>
              <select className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始日期</label>
              <input type="date" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束日期</label>
              <input type="date" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={editing ? handleUpdate : handleCreate} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
            <button onClick={() => { setShowForm(false); setEditing(null); }} disabled={saving}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded disabled:opacity-50">取消</button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        {semesters.map(s => (
          <div key={s.id} className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded">
            <div>
              <span className="font-bold">{s.name}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                ({TYPES.find(t => t.value === s.type)?.label || s.type}) {s.startDate} ~ {s.endDate}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(s)} disabled={saving}
                className="px-3 py-1 bg-gray-300 dark:bg-gray-600 rounded text-sm disabled:opacity-50">编辑</button>
              <button onClick={() => handleDelete(s.id)} disabled={saving}
                className="px-3 py-1 bg-red-600 text-white rounded text-sm disabled:opacity-50">删除</button>
            </div>
          </div>
        ))}
        {semesters.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">暂无学期，请先创建学期再使用批量排课</p>
        )}
      </div>
    </div>
  );
}
