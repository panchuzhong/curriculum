import { useState, useEffect, useContext } from 'react';
import { api } from '../api';
import { getClassColor, DarkContext } from '../utils/colors';
import { useToast } from '../components/ToastProvider';
import ClassForm from './ClassForm';
import PricingManager from './PricingManager';

export default function ClassList() {
  const dark = useContext(DarkContext);
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [activeTab, setActiveTab] = useState('info'); // 'info' | 'pricing'
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败')); }, []);

  async function handleCreate(form) {
    if (saving) return;
    setSaving(true);
    try {
      await api.createClass(form);
      setShowNew(false);
      api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败'));
    } catch (e) { toast(e.message || '创建失败'); }
    finally { setSaving(false); }
  }

  async function handleUpdate(form) {
    if (saving) return;
    setSaving(true);
    try {
      await api.updateClass(expandedId, form);
      setExpandedId(null);
      api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败'));
    } catch (e) { toast(e.message || '更新失败'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (saving) return;
    if (!confirm('确定删除？')) return;
    setSaving(true);
    try {
      await api.deleteClass(id);
      setExpandedId(null);
      api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败'));
    } catch (e) { toast(e.message || '删除失败'); }
    finally { setSaving(false); }
  }

  function toggleExpand(id) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setActiveTab('info');
      setShowNew(false);
    }
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
            {/* Collapsed header — no delete button, just chevron */}
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
              onClick={() => toggleExpand(cls.id)}>
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
              <span className="text-gray-400">{expandedId === cls.id ? '▲' : '▼'}</span>
            </div>

            {/* Expanded area with tabs */}
            {expandedId === cls.id && (
              <div className="border-t border-gray-200 dark:border-gray-700">
                {/* Tab bar */}
                <div className="flex gap-1 mx-4 mt-3 bg-gray-200 dark:bg-gray-700 rounded-lg p-1 w-fit">
                  <button onClick={() => setActiveTab('info')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'info' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                    基本信息
                  </button>
                  <button onClick={() => setActiveTab('pricing')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'pricing' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                    定价历史
                  </button>
                </div>

                {/* Tab: 基本信息 */}
                {activeTab === 'info' && (
                  <div className="px-4 pb-4">
                    <ClassForm compact initial={cls} onSubmit={handleUpdate} onCancel={() => setExpandedId(null)}
                      actions={
                        <button type="button" onClick={() => handleDelete(cls.id)}
                          className="px-4 py-2 text-red-500 border border-red-200 dark:border-red-800 rounded-lg text-sm hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-400 transition-colors shrink-0">
                          删除班级
                        </button>
                      } />
                  </div>
                )}

                {/* Tab: 定价历史 */}
                {activeTab === 'pricing' && (
                  <div className="px-4 pb-4">
                    <PricingManager classId={cls.id} onChanged={() => api.getClasses().then(setClasses)} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
