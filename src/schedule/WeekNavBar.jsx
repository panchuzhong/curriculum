import { addDays } from '../utils/date';

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

  const weekEnd = addDays(weekStart, visibleDays - 1);
  const dateLabel = isMobile
    ? `${weekStart.slice(5)} ~ ${weekEnd.slice(5)}`
    : `${weekStart} ~ ${weekEnd}`;

  return (
    <div className={`flex items-center justify-between shrink-0 ${isMobile ? 'mb-2' : 'mb-3'}`}>
      <div className="flex items-center gap-1">
        {!isMobile && (
          <>
            <button onClick={() => navigateTo(addDays(weekStart, -7))} className={navBtn}>上一周</button>
            <button onClick={() => navigateTo(addDays(weekStart, -1))} className={navBtn}>前一天</button>
          </>
        )}
      </div>

      <span className={`tabular-nums font-medium ${isMobile ? 'text-sm' : 'text-lg'}`}>
        {dateLabel}
      </span>

      <div className="flex items-center gap-1">
        {!isMobile && (
          <>
            <button onClick={() => navigateTo(addDays(weekStart, 1))} className={navBtn}>后一天</button>
            <button onClick={() => navigateTo(addDays(weekStart, 7))} className={navBtn}>下一周</button>
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
