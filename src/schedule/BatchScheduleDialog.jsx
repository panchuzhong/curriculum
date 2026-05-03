import { useState, useEffect } from 'react';
import { api } from '../api';

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

export default function BatchScheduleDialog({ onClose, onSaved }) {
  const [classes, setClasses] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [op, setOp] = useState('create'); // create | delete
  const [mode, setMode] = useState('semester'); // semester | dates
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    classId: '',
    semesterId: '',
    weekday: 1,
    startTime: '08:00',
    endTime: '10:00',
    durationBilling: '',
    dates: '',
  });

  useEffect(() => {
    api.getClasses().then(setClasses);
    api.getSemesters().then(setSemesters);
  }, []);

  const selectedSemester = semesters.find(s => s.id === +form.semesterId);

  async function handleSubmit() {
    if (!form.classId) return;

    if (op === 'create') {
      if (!form.startTime || !form.endTime) return;
      const body = {
        classId: +form.classId,
        startTime: form.startTime,
        endTime: form.endTime,
        durationBilling: form.durationBilling ? +form.durationBilling : undefined,
      };
      if (mode === 'semester') {
        if (!form.semesterId) return;
        body.semesterId = +form.semesterId;
        body.weekday = form.weekday;
      } else {
        const dates = form.dates.split(/[,，\s]+/).map(d => d.trim()).filter(Boolean);
        if (dates.length === 0) return;
        body.dates = dates;
      }
      const res = await api.batchSchedules(body);
      setResult({ op: 'create', count: res.count });
    } else {
      // delete mode
      let start, end;
      if (mode === 'semester') {
        if (!form.semesterId || !selectedSemester) return;
        start = selectedSemester.startDate;
        end = selectedSemester.endDate;
      } else {
        const dates = form.dates.split(/[,，\s]+/).map(d => d.trim()).filter(Boolean);
        if (dates.length < 2) return;
        start = dates[0];
        end = dates[dates.length - 1];
      }
      const res = await api.batchDeleteSchedules({ classId: +form.classId, start, end });
      setResult({ op: 'delete', count: res.count });
    }
  }

  const sel = 'w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3" onClick={onClose}>
      <div className="modal-enter bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 w-full max-w-[500px] max-h-[90vh] overflow-auto thin-scroll shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">批量操作</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-sm transition-colors leading-none">✕</button>
        </div>

        {!result ? (
          <div className="space-y-3">
            {/* 操作类型 */}
            <div className="flex gap-2">
              <button onClick={() => setOp('create')}
                className={`flex-1 p-2 rounded font-medium ${op === 'create' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                批量排课
              </button>
              <button onClick={() => setOp('delete')}
                className={`flex-1 p-2 rounded font-medium ${op === 'delete' ? 'bg-red-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                批量删课
              </button>
            </div>

            {op === 'delete' && (
              <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
                将删除所选班级在学期/日期范围内的全部排课，操作不可撤销。
              </p>
            )}

            {/* 班级 */}
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">选择班级</label>
              <select className={sel} value={form.classId} onChange={e => setForm({...form, classId: e.target.value})}>
                <option value="">-- 请选择 --</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.isCompetition ? '★ ' : ''}{c.name} ({c.grade} {c.subject})</option>
                ))}
              </select>
            </div>

            {/* 模式 */}
            <div className="flex gap-2">
              <button onClick={() => setMode('semester')}
                className={`flex-1 p-2 rounded ${mode === 'semester' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                学期模式
              </button>
              <button onClick={() => setMode('dates')}
                className={`flex-1 p-2 rounded ${mode === 'dates' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                {op === 'delete' ? '日期范围' : '指定日期'}
              </button>
            </div>

            {mode === 'semester' && (
              <>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">选择学期（必填，自动跳过节假日）</label>
                  <select className={sel} value={form.semesterId} onChange={e => setForm({...form, semesterId: e.target.value})}>
                    <option value="">-- 请选择 --</option>
                    {semesters.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.startDate} ~ {s.endDate})</option>
                    ))}
                  </select>
                </div>
                {op === 'create' && (
                  <div>
                    <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">每周几上课</label>
                    <select className={sel} value={form.weekday} onChange={e => setForm({...form, weekday: +e.target.value})}>
                      {WEEKDAY_OPTIONS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                  </div>
                )}
                {op === 'delete' && selectedSemester && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    将删除 {selectedSemester.startDate} ~ {selectedSemester.endDate} 范围内该班级的所有排课
                  </p>
                )}
              </>
            )}

            {mode === 'dates' && op === 'create' && (
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">日期列表（逗号分隔）</label>
                <textarea className={`${sel} h-24`} value={form.dates}
                  onChange={e => setForm({...form, dates: e.target.value})}
                  placeholder="2026-05-01, 2026-05-08, 2026-05-15" />
              </div>
            )}

            {mode === 'dates' && op === 'delete' && (
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始日期 ~ 结束日期（两个日期，逗号分隔）</label>
                <textarea className={`${sel} h-16`} value={form.dates}
                  onChange={e => setForm({...form, dates: e.target.value})}
                  placeholder="2026-05-01, 2026-05-31" />
              </div>
            )}

            {op === 'create' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始时间</label>
                  <input type="time" className={sel} value={form.startTime}
                    onChange={e => setForm({...form, startTime: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束时间</label>
                  <input type="time" className={sel} value={form.endTime}
                    onChange={e => setForm({...form, endTime: e.target.value})} />
                </div>
              </div>
            )}

            {op === 'create' && (
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">计费时长（分钟，留空自动计算）</label>
                <input type="number" className={sel} value={form.durationBilling}
                  onChange={e => setForm({...form, durationBilling: e.target.value})}
                  placeholder="默认由结束-开始时间计算" />
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={handleSubmit}
                className={`flex-1 p-2 text-white rounded ${op === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                {op === 'delete' ? '确认删除' : '批量排课'}
              </button>
              <button onClick={onClose} className="p-2 bg-gray-300 dark:bg-gray-600 rounded">取消</button>
            </div>
          </div>
        ) : (
          <div className="text-center">
            {result.op === 'create'
              ? <p className="text-lg mb-4">成功排课 {result.count} 次</p>
              : <p className="text-lg mb-4">已删除 {result.count} 条排课</p>
            }
            <button onClick={onSaved}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">完成</button>
          </div>
        )}
      </div>
    </div>
  );
}
