import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';
import { WEEKDAYS, DATE_MIN, DATE_MAX } from '../utils/constants';
import { parseDateStr, todayStr, toHours, dateRangeError, isUsableDate } from '../utils/date';
import { getDefaultScheduleRange } from '../utils/semesterRange';

// 「全部排课」的查询区间。就是 DATE_MIN/DATE_MAX：服务端的 isValidDate 带着同一对
// 上下限，超出去的区间参数会被 400 掉，整个排课历史页签变成空列表。
// 这两个常量本来就是这个接口能接受的全范围，另写一对只会在它们收窄时变成非法值。
const ALL_START = DATE_MIN;
const ALL_END = DATE_MAX;

// WEEKDAYS 从周一起算，getDay() 从周日起算。
function weekdayOf(dateStr) {
  return WEEKDAYS[(parseDateStr(dateStr).getDay() + 6) % 7];
}

export default function ScheduleHistory({ classId }) {
  const toast = useToast();
  const [all, setAll] = useState(null);
  const [range, setRange] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAll(null);
    setRange(null);
    setLoadError('');
    // 学期列表只用于推导默认范围：拉取失败时退化为「全部排课」，排课本身
    // 拉取成功就照常展示，不能让次要请求把已到手的数据丢掉。
    Promise.all([
      // 带 classId 时不受 365 天上限约束，所以一次拉完该班全部排课，之后改范围纯前端过滤
      api.getSchedules(ALL_START, ALL_END, classId),
      api.getSemesters().catch(() => {
        if (!cancelled) toast('学期列表加载失败，默认显示全部排课');
        return [];
      }),
    ])
      .then(([schedules, semesters]) => {
        if (cancelled) return;
        setAll(schedules); // 服务端已按 date, startTime 排序
        const defaults = getDefaultScheduleRange(semesters, todayStr(), {
          first: schedules[0]?.date || null,
          last: schedules[schedules.length - 1]?.date || null,
        });
        // 默认区间是从学期行推算的（学期末 +1 天之类）。学期行里的坏值已经由
        // getDefaultScheduleRange 自己筛掉了（必须在那一层筛：'2026' 这种会被 V8 宽松
        // 解成 2026-01-01，算出一个完全合法的 '2026-01-02'，在这里怎么校验也看不出来）。
        //
        // 这里还要再校验一遍，但不是为了排课行：上面那一发已经把区间卡在
        // DATE_MIN ~ DATE_MAX，服务端又是按区间查的，旧库里的 0261 排课行根本进不了
        // schedules[0]。拦的是推算本身溢出。
        //
        // 说清楚：按现在的 getDefaultScheduleRange，这一步走不到。start 只可能是
        // addDays(prev.endDate, 1)，而 prev 是按 endDate < today 选出来的，要溢出得
        // 2999-12-31 < today；today 在范围内就不可能。end 那一端同理（next.startDate > today），
        // first/last 又是服务端按区间筛过的。所以这是兼容未来改动的兜底，
        // 不是今天跑得到的分支——别拿它当成「有用例就能盖到」的东西去写测试。
        //
        // 所以不夹：只要推出来的值不可用，整个区间退成不设限（= 显示全部排课），
        // 另给一句提示。一端坏就两端一起退：另一端单独留着会成为一个谁也没要求过的
        // 过滤条件，而提示却说「显示全部排课」。
        if (!isUsableDate(defaults.start) || !isUsableDate(defaults.end)) {
          toast('默认日期范围算不出来，已改为显示全部排课');
          setRange({ start: '', end: '' });
        } else {
          setRange(defaults);
        }
      })
      .catch(e => {
        if (cancelled) return;
        setLoadError(e.message || '加载排课历史失败');
      });
    return () => { cancelled = true; };
  }, [classId, retry]);

  // 空值是用户的意图（该方向不设限），位数不对或越界是输入错误：后者也当成
  // 「不设限」的话，输入框里还显示着 0261-08-26，下面的总计却静默涨成了全部历史。
  const rangeError = range ? dateRangeError(range.start, range.end, { allowOpen: true }) : null;

  const rows = useMemo(() => {
    if (!all || !range || rangeError) return [];
    // 边界只在区间变化时算一次：放进 filter 里就是每行各跑一遍正则。
    const from = range.start || ALL_START;
    const to = range.end || ALL_END;
    return all.filter(s => s.date >= from && s.date <= to);
  }, [all, range, rangeError]);
  const totalHours = rows.reduce((sum, s) => sum + toHours(s.durationBilling), 0);

  if (loadError) return (
    <div className="mt-3 text-sm">
      <p role="alert" className="text-red-500">排课历史加载失败：{loadError}</p>
      <button onClick={() => setRetry(n => n + 1)} className="mt-2 px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded">重试</button>
    </div>
  );
  if (!range) return <p role="status" className="mt-3 text-sm text-gray-400 dark:text-gray-500">加载中...</p>;

  const inp = 'p-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded';

  return (
    <div className="mt-3">
      {/* 两个输入框写同一个 range，用函数式更新：展开渲染时的 range 的话，同一批里
          的第二个改动会把第一个覆掉——丢掉一端边界正好是这整套改动要消灭的那种静默算错。 */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始日期</label>
          <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={inp} value={range.start}
            onChange={e => setRange(r => ({ ...r, start: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束日期</label>
          <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={inp} value={range.end}
            onChange={e => setRange(r => ({ ...r, end: e.target.value }))} />
        </div>
        {rangeError ? (
          <p className="text-sm text-red-500 pb-2">{rangeError}</p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 pb-2">
            共 {rows.length} 节 · {totalHours.toFixed(1)}h
          </p>
        )}
      </div>

      {rangeError ? null : rows.length === 0 ? (
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
