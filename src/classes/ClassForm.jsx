import { useState, useEffect, useContext } from 'react';
import { GRADES } from '../utils/constants';
import { api } from '../api';
import { getClassColor, getTextColor, DarkContext } from '../utils/colors';
import { useToast } from '../components/ToastProvider';

export default function ClassForm({ initial, onSubmit, onCancel, compact, actions }) {
  const dark = useContext(DarkContext);
  const toast = useToast();
  const [subjects, setSubjects] = useState([]);
  const [form, setForm] = useState(initial || {
    name: '', grade: '初三', subject: '', studentCount: 1,
    unitPrice: 800, discountAmount: 0, discountReason: '',
    isCompetition: false, defaultLocationName: '',
  });

  useEffect(() => {
    api.getProfile().then(p => {
      const subs = p.subjects || [];
      setSubjects(subs);
      if (!initial && subs.length > 0 && !form.subject) {
        setForm(f => ({ ...f, subject: subs[0] }));
      }
    }).catch(e => toast(e.message || '加载学科失败'));
  }, []);

  useEffect(() => { if (initial) setForm(initial); }, [initial]);

  return (
    <form onSubmit={e => {
      e.preventDefault();
      onSubmit({
        ...form,
        studentCount: form.studentCount === '' ? 1 : +form.studentCount,
        unitPrice: form.unitPrice === '' ? 0 : +form.unitPrice,
        discountAmount: form.discountAmount === '' ? 0 : +form.discountAmount,
      });
    }} className="bg-gray-100 dark:bg-gray-800 p-4 sm:p-6 rounded-lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">班级名称</label>
          <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.name}
            onChange={e => setForm({...form, name: e.target.value})} required />
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">年级</label>
          <select className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.grade}
            onChange={e => setForm({...form, grade: e.target.value})}>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">学科</label>
          <div className="flex gap-2">
            <select className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.subject}
              onChange={e => setForm({...form, subject: e.target.value})}>
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="w-10 h-10 rounded flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: getClassColor(form, dark), color: getTextColor(form, dark) }}>
              {form.subject ? form.subject[0] : '?'}
            </div>
          </div>
        </div>
        {!compact && <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">学生人数</label>
          <input type="number" min="1" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.studentCount}
            onChange={e => setForm({...form, studentCount: e.target.value === '' ? '' : +e.target.value})} />
        </div>}
        {!compact && <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">单价 (元/人/小时)</label>
          <input type="number" step="0.01" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.unitPrice}
            onChange={e => setForm({...form, unitPrice: e.target.value === '' ? '' : +e.target.value})} />
        </div>}
        {!compact && <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">优惠金额</label>
          <input type="number" step="0.01" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
            value={form.discountAmount}
            onChange={e => setForm({...form, discountAmount: e.target.value === '' ? '' : +e.target.value})} />
        </div>}
        {!compact && <div className="sm:col-span-2">
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">优惠原因</label>
          <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.discountReason || ''}
            onChange={e => setForm({...form, discountReason: e.target.value})} />
        </div>}
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">默认上课地点</label>
          <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.defaultLocationName || ''}
            onChange={e => setForm({...form, defaultLocationName: e.target.value})} />
        </div>
        <div className="flex items-center">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isCompetition}
              onChange={e => setForm({...form, isCompetition: e.target.checked})} />
            <span>竞赛课</span>
          </label>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">保存</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded text-sm">取消</button>
        {actions && <div className="flex-1" />}
        {actions}
      </div>
    </form>
  );
}
