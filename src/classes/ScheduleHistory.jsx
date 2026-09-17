import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';
import { WEEKDAYS, DATE_MIN, DATE_MAX } from '../utils/constants';
import { parseDateStr, todayStr, toHours, isUsableDate } from '../utils/date';
import { getDefaultScheduleRange } from '../utils/semesterRange';

// 清空某一端的输入框表示该方向不设限，用不了的值（位数不对、越界）同样按不设限
// 处理：筛选是按字符串比大小的，年份多一位就会把整张表静默筛空。
function dateBound(value, fallback) {
  return isUsableDate(value) ? value : fallback;
}

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
      // 带 classId 时不受 365 天上限约束，所以一次拉完该班全部排课，之后改范围纯前端过滤
      api.getSchedules(DATE_MIN, DATE_MAX, classId),
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

  const rows = useMemo(() => {
    if (!all || !range) return [];
    // 边界只在区间变化时算一次：放进 filter 里就是每行各跑一遍正则。
    const from = dateBound(range.start, DATE_MIN);
    const to = dateBound(range.end, DATE_MAX);
    return all.filter(s => s.date >= from && s.date <= to);
  }, [all, range]);
  const totalHours = rows.reduce((sum, s) => sum + toHours(s.durationBilling), 0);

  if (!range) return <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">加载中...</p>;

  const inp = 'p-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded';

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始日期</label>
          <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={inp} value={range.start}
            onChange={e => setRange({ ...range, start: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束日期</label>
          <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={inp} value={range.end}
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
              {/* 同定价历史：w-full 的表格把多出来的宽度加在右对齐列文字的左边，
                  「时长 → 地点」这个交界处只剩两侧 padding 之和，得给地点列补一段
                  左缩进；窄屏整张表本来就密，不加。 */}
              <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                <th className="text-left p-2 font-medium">日期</th>
                <th className="text-left p-2 font-medium">星期</th>
                <th className="text-left p-2 font-medium">时间</th>
                <th className="text-right p-2 font-medium">时长</th>
                <th className="text-left p-2 sm:pl-10 font-medium">地点</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="p-2">{s.date}</td>
                  <td className="p-2">{weekdayOf(s.date)}</td>
                  <td className="p-2">{`${s.startTime}-${s.endTime}`}</td>
                  <td className="text-right p-2">{`${toHours(s.durationBilling).toFixed(1)}h`}</td>
                  <td className="p-2 sm:pl-10">{s.locationName || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
