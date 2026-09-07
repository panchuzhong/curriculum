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

export default function WeeklySchedule() {
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef(null);

  const {
    gridRef, weekStart, allDates, allSchedules, isMobile, visibleDays,
    navigateTo, navigateByDays, goToThisWeek, reload,
  } = useWeekNavigation({ searchParams, setSearchParams });

  const [dialog, setDialog] = useState(null);
  const [showBatch, setShowBatch] = useState(false);

  const {
    exporting, showExport, exportStart, exportEnd,
    openExport, exportPNG, exportCSV, setShowExport,
  } = useScheduleExport({ weekStart, visibleDays });

  const handleScheduleClick = useCallback((s) => {
    setDialog({ schedule: s, date: s.date, startTime: s.startTime });
  }, []);

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

      <div ref={gridRef} className="flex-1 min-h-0">
        <ScheduleGrid
          dates={allDates}
          schedules={allSchedules}
          visibleDays={visibleDays}
          weekStart={weekStart}
          onScheduleClick={handleScheduleClick}
          onCellClick={(date, startTime) => setDialog({ date, startTime })}
        />
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
