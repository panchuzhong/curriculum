import { useState, useEffect, useContext, useCallback } from 'react';
import { api } from '../api';
import { getClassColor, DarkContext } from '../utils/colors';
import { useToast } from '../components/ToastProvider';

function StudentDialog({ student, classes, onClose, onSaved }) {
  const toast = useToast();
  const dark = useContext(DarkContext);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', birthDate: '', phone: '', parentName: '', parentPhone: '', note: '', classIds: [],
  });

  useEffect(() => {
    if (student) {
      setForm({
        name: student.name || '',
        birthDate: student.birthDate || '',
        phone: student.phone || '',
        parentName: student.parentName || '',
        parentPhone: student.parentPhone || '',
        note: student.note || '',
        classIds: student.classIds || [],
      });
    }
  }, [student]);

  function toggleClass(classId) {
    setForm(f => ({
      ...f,
      classIds: f.classIds.includes(classId)
        ? f.classIds.filter(id => id !== classId)
        : [...f.classIds, classId],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      if (student) {
        await api.updateStudent(student.id, form);
      } else {
        await api.createStudent(form);
      }
      onSaved();
    } catch (e) { toast(e.message || '保存失败'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!student || saving) return;
    if (!confirm('确定删除此学生？')) return;
    setSaving(true);
    try {
      await api.deleteStudent(student.id);
      onSaved();
    } catch (e) { toast(e.message || '删除失败'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 w-full max-w-[480px] max-h-[90vh] overflow-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg mb-4">{student ? '编辑学生' : '新建学生'}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">姓名 *</label>
            <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
              value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
          </div>
          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">出生日期（可只填年份）</label>
            <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
              value={form.birthDate} onChange={e => setForm({...form, birthDate: e.target.value})}
              placeholder="如：2010 或 2010-05-15" />
          </div>
          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">电话</label>
            <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
              value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">父母姓名</label>
              <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.parentName} onChange={e => setForm({...form, parentName: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">父母联系方式</label>
              <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.parentPhone} onChange={e => setForm({...form, parentPhone: e.target.value})} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">备注</label>
            <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
              value={form.note} onChange={e => setForm({...form, note: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">所在班级（可多选）</label>
            <div className="flex flex-wrap gap-2">
              {classes.map(cls => (
                <button key={cls.id} type="button" onClick={() => toggleClass(cls.id)}
                  className={`px-3 py-1 rounded text-sm border ${
                    form.classIds.includes(cls.id)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600'
                  }`}>
                  <span className="inline-block w-2 h-2 rounded mr-1" style={{ backgroundColor: getClassColor(cls, dark) }} />
                  {cls.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={saving}
              className="flex-1 p-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
            {student && (
              <button type="button" onClick={handleDelete} disabled={saving}
                className="p-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">删除</button>
            )}
            <button type="button" onClick={onClose} disabled={saving}
              className="p-2 bg-gray-300 dark:bg-gray-600 rounded disabled:opacity-50">取消</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function StudentList() {
  const dark = useContext(DarkContext);
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // null | 'new' | student object
  const [filterClass, setFilterClass] = useState('all');

  const reload = useCallback(() => {
    api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败'));
    api.getAllStudents().then(setStudents).catch(e => toast(e.message || '加载学生失败')).finally(() => setLoading(false));
  }, []);

  const closeDialog = useCallback(() => setDialog(null), []);
  const onSaved = useCallback(() => { setDialog(null); reload(); }, [reload]);

  const getClassNames = useCallback((classIds) => {
    if (!classIds || classIds.length === 0) return '未分班';
    return classIds.map(id => classes.find(c => c.id === id)).filter(Boolean).map(c => c.name).join('、');
  }, [classes]);

  useEffect(() => { reload(); }, []);

  const filtered = filterClass === 'all'
    ? students
    : students.filter(s => s.classIds?.includes(+filterClass));

  return (
    <div>
      <div className="flex justify-between items-center mb-3 sm:mb-4 gap-2">
        <h2 className="text-lg sm:text-xl font-medium">学生管理</h2>
        <div className="flex gap-1 sm:gap-2 items-center">
          <select className="p-1.5 sm:p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-xs sm:text-sm max-w-[140px] sm:max-w-none truncate"
            value={filterClass} onChange={e => setFilterClass(e.target.value)}>
            <option value="all">全部 ({students.length}人)</option>
            {classes.map(cls => {
              const count = students.filter(s => s.classIds?.includes(cls.id)).length;
              return <option key={cls.id} value={cls.id}>{cls.name} ({count}人)</option>;
            })}
          </select>
          <button onClick={() => setDialog('new')}
            className="px-2 sm:px-4 py-1.5 sm:py-2 bg-blue-600 text-white rounded text-xs sm:text-sm whitespace-nowrap">新建</button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-center py-8">加载中...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 text-center py-8">
          {students.length === 0 ? '暂无学生，点击右上角新建' : '该班级暂无学生'}
        </p>
      ) : (
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-gray-200 dark:bg-gray-700">
                  <th className="text-left p-3">姓名</th>
                  <th className="text-left p-3">出生日期</th>
                  <th className="text-left p-3">电话</th>
                  <th className="text-left p-3">父母</th>
                  <th className="text-left p-3">联系方式</th>
                  <th className="text-left p-3">所在班级</th>
                  <th className="text-right p-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-3 font-medium">{s.name}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{s.birthDate || '-'}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{s.phone || '-'}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{s.parentName || '-'}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{s.parentPhone || '-'}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400 text-xs">{getClassNames(s.classIds)}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => setDialog(s)}
                        className="px-2 py-1 bg-gray-300 dark:bg-gray-600 rounded text-xs">编辑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialog && (
        <StudentDialog
          student={dialog === 'new' ? null : dialog}
          classes={classes}
          onClose={closeDialog}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
