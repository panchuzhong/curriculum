import { useState, useEffect } from 'react';
import { api } from '../api';
import { GRADES } from '../utils/constants';
import { useToast } from '../components/ToastProvider';

function getDefaultEndTime(start) {
  const [h, m] = start.split(':').map(Number);
  const endH = Math.min(h + 2, 23);
  return `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function ScheduleDialog({ date, startTime, schedule, onClose, onSaved }) {
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [mode, setMode] = useState('existing');
  const [form, setForm] = useState({
    classId: '',
    date: date || '',
    startTime: startTime || '08:00',
    endTime: getDefaultEndTime(startTime || '08:00'),
    durationBilling: '',
    locationName: '',
  });
  const [newClass, setNewClass] = useState({
    name: '', grade: '初三', subject: '', studentCount: 1,
    unitPrice: 800, isCompetition: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败'));
    api.getProfile().then(p => {
      const subs = p.subjects || [];
      setSubjects(subs);
      if (subs.length > 0) setNewClass(nc => ({ ...nc, subject: nc.subject || subs[0] }));
    }).catch(e => toast(e.message || '加载学科失败'));
  }, []);

  useEffect(() => {
    if (schedule) {
      setForm({
        classId: schedule.classId,
        date: schedule.date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        durationBilling: schedule.durationBilling ?? '',
        locationName: schedule.locationName || '',
      });
    }
  }, [schedule]);

  async function handleSave() {
    if (!form.classId) return;
    setSaving(true);
    setError('');
    try {
      const data = {
        classId: +form.classId,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        durationBilling: form.durationBilling !== '' ? +form.durationBilling : undefined,
        locationName: form.locationName || undefined,
      };
      if (schedule) {
        await api.updateSchedule(schedule.id, data);
      } else {
        await api.createSchedule(data);
      }
      onSaved();
    } catch (err) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateClassAndSchedule() {
    if (!newClass.name) return;
    setSaving(true);
    setError('');
    let cls;
    try {
      cls = await api.createClass({
        ...newClass,
        studentCount: newClass.studentCount === '' ? 1 : +newClass.studentCount,
        unitPrice: newClass.unitPrice === '' ? 0 : +newClass.unitPrice,
        discountAmount: newClass.discountAmount === '' ? 0 : +newClass.discountAmount,
      });
      await api.createSchedule({
        classId: cls.id,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        durationBilling: form.durationBilling !== '' ? +form.durationBilling : undefined,
        locationName: form.locationName || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.message || '创建失败');
      // Clean up orphan class if it was created before schedule failed
      if (cls) {
        try { await api.deleteClass(cls.id); } catch (_) { /* best effort */ }
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!schedule || !confirm('确定删除此排课？')) return;
    setSaving(true);
    setError('');
    try {
      await api.deleteSchedule(schedule.id);
      onSaved();
    } catch (err) {
      setError(err.message || '删除失败');
    } finally {
      setSaving(false);
    }
  }

  function handleClassChange(e) {
    const val = e.target.value;
    if (val === '__new__') {
      setMode('create');
    } else {
      setForm({...form, classId: val});
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3" onClick={onClose}>
      <div className="modal-enter bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 w-full max-w-[480px] max-h-[90vh] overflow-auto thin-scroll shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="text-lg font-semibold">
              {mode === 'create' ? '新建班级并排课' : schedule ? '编辑排课' : '新建排课'}
            </h3>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">{form.date}</p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-sm transition-colors leading-none shrink-0">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {mode === 'existing' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">选择班级</label>
              <select className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.classId}
                onChange={handleClassChange}>
                <option value="">-- 请选择 --</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.isCompetition ? '★ ' : ''}{c.name} ({c.grade} {c.subject})
                  </option>
                ))}
                <option value="__new__" className="text-blue-600 font-medium">＋ 新建班级</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">日期</label>
              <input type="date" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.date}
                onChange={e => setForm({...form, date: e.target.value})} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始时间</label>
                <input type="time" lang="zh-CN" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.startTime}
                  onChange={e => {
                    const v = e.target.value;
                    setForm({...form, startTime: v, endTime: form.endTime || getDefaultEndTime(v)});
                  }} />
              </div>
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束时间</label>
                <input type="time" lang="zh-CN" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.endTime}
                  onChange={e => setForm({...form, endTime: e.target.value})} />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">计费时长（分钟，留空自动计算）</label>
              <input type="number" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.durationBilling}
                onChange={e => setForm({...form, durationBilling: e.target.value === '' ? '' : +e.target.value})}
                placeholder="默认由结束-开始时间计算" />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">上课地点</label>
              <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={form.locationName}
                onChange={e => setForm({...form, locationName: e.target.value})}
                placeholder="留空则使用班级默认地点" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 p-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
              {schedule && (
                <button onClick={handleDelete} disabled={saving}
                  className="p-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">删除</button>
              )}
              <button onClick={onClose} disabled={saving}
                className="p-2 bg-gray-300 dark:bg-gray-600 rounded disabled:opacity-50">取消</button>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">班级名称</label>
              <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={newClass.name}
                onChange={e => setNewClass({...newClass, name: e.target.value})}
                placeholder="如：初三数学A班" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">年级</label>
                <select className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={newClass.grade}
                  onChange={e => setNewClass({...newClass, grade: e.target.value})}>
                  {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">学科</label>
                <select className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" value={newClass.subject}
                  onChange={e => setNewClass({...newClass, subject: e.target.value})}>
                  {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">学生人数</label>
                <input type="number" min="1" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                  value={newClass.studentCount}
                  onChange={e => setNewClass({...newClass, studentCount: e.target.value === '' ? '' : +e.target.value})} />
              </div>
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">单价 (元/人/时)</label>
                <input type="number" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                  value={newClass.unitPrice}
                  onChange={e => setNewClass({...newClass, unitPrice: e.target.value === '' ? '' : +e.target.value})} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">优惠金额</label>
                <input type="number" step="0.01" className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                  value={newClass.discountAmount ?? 0}
                  onChange={e => setNewClass({...newClass, discountAmount: e.target.value === '' ? '' : +e.target.value})} />
              </div>
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">优惠原因</label>
                <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                  value={newClass.discountReason || ''}
                  onChange={e => setNewClass({...newClass, discountReason: e.target.value})}
                  placeholder="可选" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">默认上课地点</label>
              <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={newClass.defaultLocationName || ''}
                onChange={e => setNewClass({...newClass, defaultLocationName: e.target.value})}
                placeholder="可选" />
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newClass.isCompetition}
                  onChange={e => setNewClass({...newClass, isCompetition: e.target.checked})} />
                <span>竞赛课</span>
              </label>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleCreateClassAndSchedule}
                className="flex-1 p-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                disabled={saving || !newClass.name}>{saving ? '创建中...' : '创建并排课'}</button>
              <button onClick={() => setMode('existing')} disabled={saving}
                className="p-2 bg-gray-300 dark:bg-gray-600 rounded disabled:opacity-50">返回</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
