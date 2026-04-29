import { useState, useEffect } from 'react';
import { GRADES, SUBJECTS } from '../utils/constants';

export default function ClassForm({ initial, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', grade: '初三', subject: '数学', studentCount: 1,
    unitPrice: 800, discountAmount: 0, discountReason: '',
    isCompetition: false, defaultLocationName: '',
  });

  useEffect(() => { if (initial) setForm(initial); }, [initial]);

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="bg-gray-800 p-6 rounded-lg">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">班级名称</label>
          <input className="w-full p-2 bg-gray-700 rounded" value={form.name}
            onChange={e => setForm({...form, name: e.target.value})} required />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">年级</label>
          <select className="w-full p-2 bg-gray-700 rounded" value={form.grade}
            onChange={e => setForm({...form, grade: e.target.value})}>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">学科</label>
          <select className="w-full p-2 bg-gray-700 rounded" value={form.subject}
            onChange={e => setForm({...form, subject: e.target.value})}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">学生人数</label>
          <input type="number" min="1" className="w-full p-2 bg-gray-700 rounded"
            value={form.studentCount}
            onChange={e => setForm({...form, studentCount: +e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">单价 (元/人/小时)</label>
          <input type="number" step="0.01" className="w-full p-2 bg-gray-700 rounded"
            value={form.unitPrice}
            onChange={e => setForm({...form, unitPrice: +e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">优惠金额</label>
          <input type="number" step="0.01" className="w-full p-2 bg-gray-700 rounded"
            value={form.discountAmount}
            onChange={e => setForm({...form, discountAmount: +e.target.value})} />
        </div>
        <div className="col-span-2">
          <label className="block text-sm text-gray-400 mb-1">优惠原因</label>
          <input className="w-full p-2 bg-gray-700 rounded" value={form.discountReason || ''}
            onChange={e => setForm({...form, discountReason: e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">默认上课地点</label>
          <input className="w-full p-2 bg-gray-700 rounded" value={form.defaultLocationName || ''}
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
        <button type="submit" className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700">保存</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-600 rounded">取消</button>
      </div>
    </form>
  );
}
