import { addDays, isUsableDate } from '../utils/date';

export default function WeekNavBar({
  weekStart, visibleDays, isMobile,
  navigateTo, goToThisWeek,
  showBatch, setShowBatch,
  exporting, openExport,
}) {
  const navBtn = isMobile
    ? 'px-2 py-1.5 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-xs select-none'
    : 'px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm select-none';
  const todayBtn = isMobile
    ? 'px-4 py-1.5 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm font-medium select-none'
    : navBtn;
  const actBtn = (color) => isMobile
    ? `px-2 py-1.5 ${color} text-white rounded text-sm select-none`
    : `px-3 py-2 ${color} text-white rounded text-sm select-none`;

  // 越界的一步 navigateTo 会直接不走（见 useWeekNavigation）。按钮还亮着的话，
  // 点下去没任何反应，和页面卡死了没区别——拦了就得让人看得出来。
  // 判的是首列，和 navigateTo 一致（为什么只管首列见 useWeekNavigation）。
  const canStep = (days) => isUsableDate(addDays(weekStart, days));
  // 这里故意不夹。站在 2999-12-31 时标题会写「2999-12-31 ~ 3000-01-06」，
  // 印出一个超过 DATE_MAX 的日期——看着确实别扭（审阅里被提过两次）。
  // 但夹了更坏：夹出来是「2999-12-31 ~ 2999-12-31」，一个 7 列的网格配一句
  // 只有一天的标题，那才真像个 bug。标题描述的就是屏上列出来的那几列（含尾巴上
  // 那几个点不动的空格子），所以它和网格保持一致；真正要夹的是发出去的东西
  // ——抓取区间和导出默认值（fetchRange / openExport）。见 audit-regressions 的边界用例。
  const weekEnd = addDays(weekStart, visibleDays - 1);
  const dateLabel = isMobile
    ? `${weekStart.slice(5)} ~ ${weekEnd.slice(5)}`
    : `${weekStart} ~ ${weekEnd}`;

  return (
    <div className={`flex items-center justify-between shrink-0 px-6 ${isMobile ? 'mb-2' : 'mb-3'}`}>
      <div className="flex items-center gap-1">
        {!isMobile && (
          <>
            <button onClick={() => navigateTo(addDays(weekStart, -7))} disabled={!canStep(-7)} className={`${navBtn} disabled:opacity-40`}>上一周</button>
            <button onClick={() => navigateTo(addDays(weekStart, -1))} disabled={!canStep(-1)} className={`${navBtn} disabled:opacity-40`}>前一天</button>
          </>
        )}
      </div>

      <span className={`tabular-nums font-medium ${isMobile ? 'text-base' : 'text-xl'}`}>
        {dateLabel}
      </span>

      <div className="flex items-center gap-1">
        {!isMobile && (
          <>
            <button onClick={() => navigateTo(addDays(weekStart, 1))} disabled={!canStep(1)} className={`${navBtn} disabled:opacity-40`}>后一天</button>
            <button onClick={() => navigateTo(addDays(weekStart, 7))} disabled={!canStep(7)} className={`${navBtn} disabled:opacity-40`}>下一周</button>
          </>
        )}
        <button onClick={goToThisWeek} className={todayBtn}>{isMobile ? '今天' : '本周'}</button>
        <div className={`flex gap-1 ${isMobile ? 'ml-1' : 'ml-2'}`}>
          <button onClick={() => setShowBatch(true)} className={actBtn('bg-green-600 hover:bg-green-700')}>
            {isMobile ? '批量' : '批量操作'}
          </button>
          <button disabled={exporting} onClick={openExport}
            className={actBtn('bg-purple-600 hover:bg-purple-700 disabled:opacity-50')}>
            {exporting ? '…' : '导出'}
          </button>
        </div>
      </div>
    </div>
  );
}
