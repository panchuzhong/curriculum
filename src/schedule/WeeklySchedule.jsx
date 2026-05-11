import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays } from '../utils/date';
import ScheduleGrid from './ScheduleGrid';
import ScheduleDialog from './ScheduleDialog';
import BatchScheduleDialog from './BatchScheduleDialog';
import ExportDialog from './ExportDialog';
import useWeekNavigation from './useWeekNavigation';
import useScheduleExport from './useScheduleExport';
import WeekNavBar from './WeekNavBar';

export default function WeeklySchedule() {
  const [searchParams] = useSearchParams();
  const containerRef = useRef(null);

  const {
    gridRef, weekStart, allDates, allSchedules, isMobile, visibleDays,
    navigateTo, goToThisWeek, reload,
  } = useWeekNavigation({ searchParams });

  const [dialog, setDialog] = useState(null);
  const [showBatch, setShowBatch] = useState(false);

  const {
    exporting, showExport, exportStart, exportEnd,
    openExport, exportPNG, exportCSV, setShowExport,
  } = useScheduleExport({ weekStart, visibleDays, addDays });

  useEffect(() => { containerRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      e.preventDefault();
      const delta = e.ctrlKey || e.metaKey ? (visibleDays || 7) * (e.key === 'ArrowLeft' ? -1 : 1)
        : e.key === 'ArrowLeft' ? -1 : 1;
      navigateTo(addDays(weekStart, delta));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [weekStart, visibleDays, navigateTo]);

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
          onScheduleClick={s => setDialog({ schedule: s, date: s.date, startTime: s.startTime })}
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
