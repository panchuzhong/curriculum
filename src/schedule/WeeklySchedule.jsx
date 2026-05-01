import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import ScheduleGrid from './ScheduleGrid';
import ScheduleDialog from './ScheduleDialog';
import BatchScheduleDialog from './BatchScheduleDialog';
import ExportDialog from './ExportDialog';

const TOTAL_COLS = 21;
const BUFFER = 7;
const INITIAL_OFFSET = -(BUFFER / TOTAL_COLS * 100); // -33.333...%
const ANIM_MS = 150;

function getMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day2 = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day2}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getAllDates(ws) {
  const start = addDays(ws, -BUFFER);
  return Array.from({ length: TOTAL_COLS }, (_, i) => addDays(start, i));
}

function toOffset(colIndex) {
  return -(colIndex / TOTAL_COLS * 100);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

export default function WeeklySchedule() {
  const [searchParams] = useSearchParams();
  const initialWeek = searchParams.get('week') || getMonday(todayStr());

  const [weekStart, setWeekStart] = useState(initialWeek);
  const [allDates, setAllDates] = useState(() => getAllDates(initialWeek));
  const [allSchedules, setAllSchedules] = useState([]);

  const gridRef = useRef(null);
  const navLockRef = useRef(false);

  const [dialog, setDialog] = useState(null);
  const [showBatch, setShowBatch] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportStart, setExportStart] = useState(null);
  const [exportEnd, setExportEnd] = useState(null);

  // Snap to INITIAL_OFFSET after every allDates change (including mount).
  // useLayoutEffect fires synchronously after DOM commit, before browser paints —
  // this ensures new data and correct position are always painted in the same frame.
  useLayoutEffect(() => {
    snapToOffset(INITIAL_OFFSET);
  }, [allDates]);

  // Initial data load
  useEffect(() => {
    api.getSchedules(allDates[0], allDates[TOTAL_COLS - 1]).then(setAllSchedules);
  }, []);

  function reload() {
    api.getSchedules(allDates[0], allDates[TOTAL_COLS - 1]).then(setAllSchedules);
  }

  async function animateToOffset(pct) {
    if (!gridRef.current) return;
    gridRef.current.style.setProperty('--day-transition', `transform ${ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`);
    await new Promise(r => requestAnimationFrame(r));
    gridRef.current.style.setProperty('--day-offset', `${pct}%`);
    await new Promise(r => setTimeout(r, ANIM_MS + 16));
  }

  function snapToOffset(pct) {
    if (!gridRef.current) return;
    gridRef.current.style.setProperty('--day-transition', 'none');
    gridRef.current.style.setProperty('--day-offset', `${pct}%`);
    gridRef.current.getBoundingClientRect(); // force layout
  }

  async function navigateTo(newWeekStart, direction) {
    if (navLockRef.current) return;
    if (newWeekStart === weekStart) return;
    navLockRef.current = true;

    const days = daysBetween(weekStart, newWeekStart); // +N right, -N left
    setWeekStart(newWeekStart); // header updates immediately

    const newAllDates = getAllDates(newWeekStart);
    const newSchedules = await api.getSchedules(newAllDates[0], newAllDates[TOTAL_COLS - 1]);

    if (Math.abs(days) <= BUFFER) {
      // Animate in old allDates context: old allDates[BUFFER+days] = newWeekStart
      await animateToOffset(toOffset(BUFFER + days));
    }
    // useLayoutEffect([allDates]) snaps to INITIAL_OFFSET after React commits new data,
    // before the browser paints — no frame ever shows old data at the snap position.
    setAllDates(newAllDates);
    setAllSchedules(newSchedules);

    navLockRef.current = false;
  }

  function openExport() {
    setExportStart(weekStart);
    setExportEnd(addDays(weekStart, 6));
    setShowExport(true);
  }

  async function exportPNG(start, end) {
    setExporting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/schedule-image?start=${start}&end=${end}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `课表_${start}_${end}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function exportCSV(start, end) {
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const data = await api.getSchedules(start, end);
    const rows = [['日期', '星期', '班级', '年级', '学科', '开始时间', '结束时间', '计费时长(分钟)', '上课地点', '竞赛课', '单价', '学生人数', '优惠金额']];
    const sorted = [...data].sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime)
    );
    sorted.forEach(s => {
      const d = new Date(s.date + 'T00:00:00');
      rows.push([
        s.date, weekdayNames[d.getDay()],
        s.class?.name || '', s.class?.grade || '', s.class?.subject || '',
        s.startTime, s.endTime, s.durationBilling, s.locationName || '',
        s.class?.isCompetition ? '是' : '否',
        s.class?.unitPrice || '', s.class?.studentCount || '', s.class?.discountAmount || '',
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `课表_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const gridProps = {
    onScheduleClick: s => setDialog({ schedule: s, date: s.date, startTime: s.startTime }),
    onCellClick: (date, startTime) => setDialog({ date, startTime }),
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => navigateTo(addDays(weekStart, -7), 'left')}
            className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm">上一周</button>
          <button onClick={() => navigateTo(addDays(weekStart, -1), 'left')}
            className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm">前一天</button>
        </div>
        <span className="text-lg tabular-nums">
          {weekStart} ~ {addDays(weekStart, 6)}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => navigateTo(addDays(weekStart, 1), 'right')}
            className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm">后一天</button>
          <button onClick={() => navigateTo(addDays(weekStart, 7), 'right')}
            className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm">下一周</button>
          <button onClick={() => {
            const today = getMonday(todayStr());
            navigateTo(today, today > weekStart ? 'right' : 'left');
          }} className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform text-sm">本周</button>
          <div className="flex gap-1.5 ml-2">
            <button onClick={() => setShowBatch(true)}
              className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm">批量排课</button>
            <button disabled={exporting} onClick={openExport}
              className="px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 text-sm">
              {exporting ? '导出中…' : '导出'}
            </button>
          </div>
        </div>
      </div>

      {/* Grid wrapper — holds CSS vars that ScheduleGrid tracks inherit */}
      <div ref={gridRef} className="flex-1 min-h-0">
        <ScheduleGrid dates={allDates} schedules={allSchedules} {...gridProps} />
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
