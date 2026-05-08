import { useState, useEffect, useContext } from 'react';
import { api } from '../api';
import { getClassColor, DarkContext } from '../utils/colors';
import { useToast } from '../components/ToastProvider';
import ClassForm from './ClassForm';

export default function ClassList() {
  const dark = useContext(DarkContext);
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => { api.getClasses().then(setClasses).catch(() => {}); }, []);

  async function handleCreate(form) {
    try {
      await api.createClass(form);
      setShowNew(false);
      api.getClasses().then(setClasses).catch(() => {});
    } catch (e) { toast(e.message || '创建失败'); }
  }

  async function handleUpdate(form) {
    try {
      await api.updateClass(expandedId, form);
      setExpandedId(null);
      api.getClasses().then(setClasses).catch(() => {});
    } catch (e) { toast(e.message || '更新失败'); }
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!confirm('确定删除？')) return;
    try {
      await api.deleteClass(id);
      api.getClasses().then(setClasses).catch(() => {});
    } catch (e) { toast(e.message || '删除失败'); }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl">班级管理</h2>
        <button onClick={() => { setShowNew(true); setExpandedId(null); }}
          className="px-4 py-2 bg-blue-600 text-white rounded">新建班级</button>
      </div>

      {showNew && (
        <ClassForm onSubmit={handleCreate} onCancel={() => setShowNew(false)} />
      )}

      <div className="grid gap-2 mt-4">
        {classes.map(cls => (
          <div key={cls.id} className="bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
              onClick={() => { setExpandedId(expandedId === cls.id ? null : cls.id); setShowNew(false); }}>
              <div className="flex items-center gap-3">
                <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: getClassColor(cls, dark) }} />
                <div>
                  <div className="font-bold">
                    {cls.isCompetition && '★ '}{cls.name}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {cls.grade} · {cls.subject} · {cls.studentCount}人 · ¥{cls.unitPrice}/人/时
                    {cls.discountAmount > 0 && ` · 优惠¥${cls.discountAmount}`}
                    {cls.defaultLocationName && ` · 📍${cls.defaultLocationName}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={e => handleDelete(cls.id, e)}
                  className="px-3 py-1 text-red-500 border border-red-200 dark:border-red-800 rounded-lg text-sm hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-400 transition-colors">删除</button>
                <span className="text-gray-400">{expandedId === cls.id ? '▲' : '▼'}</span>
              </div>
            </div>
            {expandedId === cls.id && (
              <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                <ClassForm initial={cls} onSubmit={handleUpdate} onCancel={() => setExpandedId(null)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
