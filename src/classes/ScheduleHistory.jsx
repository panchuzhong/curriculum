import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';
import { WEEKDAYS } from '../utils/constants';
import { parseDateStr, todayStr, toHours } from '../utils/date';
import { getDefaultScheduleRange } from '../utils/semesterRange';

// GET /api/schedules 带 classId 时不受 365 天上限约束，所以一次拉完该班全部排课，
// 之后改日期范围纯前端过滤，不再请求。
const ALL_START = '1970-01-01';
const ALL_END = '2999-12-31';

// WEEKDAYS 从周一起算，getDay() 从周日起算。
function weekdayOf(dateStr) {
  return WEEKDAYS[(parseDateStr(dateStr).getDay() + 6) % 7];
}

export default function ScheduleHistory({ classId }) {
  const toast = useToast();
  const [all, setAll] = useState(null);
  const [range, setRange] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setAll(null);
    setRange(null);
    // 学期列表只用于推导默认范围：拉取失败时退化为「全部排课」，排课本身
    // 拉取成功就照常展示，不能让次要请求把已到手的数据丢掉。
    Promise.all([
      api.getSchedules(ALL_START, ALL_END, classId),
      api.getSemesters().catch(() => {
        toast('学期列表加载失败，默认显示全部排课');
        return [];
      }),
    ])
      .then(([schedules, semesters]) => {
        if (cancelled) return;
        setAll(schedules); // 服务端已按 date, startTime 排序
        setRange(getDefaultScheduleRange(semesters, todayStr(), {
          first: schedules[0]?.date || null,
          last: schedules[schedules.length - 1]?.date || null,
        }));
      })
      .catch(e => {
        if (cancelled) return;
        setAll([]);
        setRange({ start: todayStr(), end: todayStr() });
        toast(e.message || '加载排课历史失败');
      });
    return () => { cancelled = true; };
  }, [classId]);

  // 清空某一端的输入框表示该方向不设限
  const rows = useMemo(
    () => (all && range
      ? all.filter(s => s.date >= (range.start || ALL_START) && s.date <= (range.end || ALL_END))
      : []),
    [all, range],
  );
  const totalHours = rows.reduce((sum, s) => sum + toHours(s.durationBilling), 0);

  if (!range) return <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">加载中...</p>;

  const inp = 'p-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded';

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始日期</label>
          <input type="date" lang="zh-CN" className={inp} value={range.start}
            onChange={e => setRange({ ...range, start: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束日期</label>
          <input type="date" lang="zh-CN" className={inp} value={range.end}
            onChange={e => setRange({ ...range, end: e.target.value })} />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 pb-2">
          共 {rows.length} 节 · {totalHours.toFixed(1)}h
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">该时段无排课</p>
      ) : (
        /* 单元格内不嵌套元素，框选复制后粘进表格软件仍保持分列 */
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                <th className="text-left p-2 font-medium">日期</th>
                <th className="text-left p-2 font-medium">星期</th>
                <th className="text-left p-2 font-medium">时间</th>
                <th className="text-right p-2 font-medium">时长</th>
                <th className="text-left p-2 font-medium">地点</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="p-2">{s.date}</td>
                  <td className="p-2">{weekdayOf(s.date)}</td>
                  <td className="p-2">{`${s.startTime}-${s.endTime}`}</td>
                  <td className="text-right p-2">{`${toHours(s.durationBilling).toFixed(1)}h`}</td>
                  <td className="p-2">{s.locationName || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
