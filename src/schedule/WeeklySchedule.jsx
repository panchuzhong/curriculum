import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import ScheduleGrid from './ScheduleGrid';
import ScheduleDialog from './ScheduleDialog';
import BatchScheduleDialog from './BatchScheduleDialog';
import ExportDialog from './ExportDialog';
import useWeekNavigation from './useWeekNavigation';
import useScheduleExport from './useScheduleExport';
import WeekNavBar from './WeekNavBar';
import { shortcutBlocked } from '../utils/keys';
import { isUsableDate, DATE_INVALID_HINT } from '../utils/date';
import { useToast } from '../components/ToastProvider';
import LoadingHint from '../components/LoadingHint';

export default function WeeklySchedule() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef(null);

  const {
    gridRef, weekStart, allDates, allSchedules, isMobile, visibleDays, loading, loadError,
    navigateTo, navigateByDays, goToThisWeek, reload, isStale,
  } = useWeekNavigation({ searchParams, setSearchParams });

  const [dialog, setDialog] = useState(null);
  const [showBatch, setShowBatch] = useState(false);

  const {
    exporting, showExport, exportStart, exportEnd,
    openExport, exportPNG, exportCSV, setShowExport,
  } = useScheduleExport({ weekStart, visibleDays });

  const handleScheduleClick = useCallback((s) => {
    // 刚保存/删除过、新数据还没回来：屏上这节课还是改动之前的样子，拿它回填弹窗再保存一次，
    // 会把刚做的修改写回去（见 useWeekNavigation 的 isStale）。
    if (isStale()) { toast('课表正在刷新，请稍后再点'); return; }
    setDialog({ schedule: s, date: s.date, startTime: s.startTime });
  }, [isStale, toast]);

  useEffect(() => { containerRef.current?.focus(); }, []);

  useLayoutEffect(() => {
    const onKey = (e) => {
      if (shortcutBlocked(e)) return;
      if (e.key === 'Home') { e.preventDefault(); goToThisWeek(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = e.ctrlKey || e.metaKey ? (visibleDays || 7) * (e.key === 'ArrowLeft' ? -1 : 1)
        : e.key === 'ArrowLeft' ? -1 : 1;
      navigateByDays(delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleDays, navigateByDays, goToThisWeek]);

  return (
    <div ref={containerRef} tabIndex={-1} className="outline-none h-full flex flex-col">
      <WeekNavBar
        weekStart={weekStart} visibleDays={visibleDays} isMobile={isMobile}
        navigateTo={navigateTo} goToThisWeek={goToThisWeek}
        showBatch={showBatch} setShowBatch={setShowBatch}
        exporting={exporting} openExport={openExport}
      />

      <div ref={gridRef} className="flex-1 min-h-0 relative">
        {/* 加载时网格照常显示、照常能点能滑：翻页后缓冲里已有的课不该被藏起来，
            提示为什么不接触摸见 LoadingHint。只有加载失败才藏网格：那时屏上是别的日期范围的旧数据。 */}
        <div className={`h-full ${loadError ? 'invisible' : ''}`} aria-busy={loading}>
        <ScheduleGrid
          dates={allDates}
          schedules={allSchedules}
          visibleDays={visibleDays}
          weekStart={weekStart}
          onScheduleClick={handleScheduleClick}
          onCellClick={(date, startTime) => {
            // 最后一屏的尾巴上排着 DATE_MAX 之后的空格子，那些日期存不下排课：
            // 开个弹窗让人填完再报「日期无效」，不如当场说清楚。
            if (!isUsableDate(date)) { toast(DATE_INVALID_HINT); return; }
            setDialog({ date, startTime });
          }}
        />
        </div>
        {loading && <LoadingHint />}
        {loadError && <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p role="alert" className="mb-3 text-red-500">课表加载失败：{loadError}</p>
          <button onClick={reload} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded">重试</button>
        </div>}
      </div>

      {dialog && (
        <ScheduleDialog
          date={dialog.date}
          startTime={dialog.startTime}
          schedule={dialog.schedule}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); reload(); }}
        />
      )}
      {showBatch && (
        <BatchScheduleDialog
          onClose={() => setShowBatch(false)}
          onSaved={() => { setShowBatch(false); reload(); }}
        />
      )}
      {showExport && exportStart && exportEnd && (
        <ExportDialog
          view="week"
          defaultStart={exportStart}
          defaultEnd={exportEnd}
          onClose={() => setShowExport(false)}
          onExportPNG={async (s, e) => { await exportPNG(s, e); setShowExport(false); }}
          onExportCSV={(s, e) => { exportCSV(s, e); setShowExport(false); }}
        />
      )}
    </div>
  );
}
