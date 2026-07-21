import { useState } from 'react';
import { api } from '../api';
import { addDays } from '../utils/date';
import { useToast } from '../components/ToastProvider';
import { downloadBlob } from '../utils/download';

export default function useScheduleExport({ weekStart, visibleDays, view } = {}) {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportStart, setExportStart] = useState(null);
  const [exportEnd, setExportEnd] = useState(null);

  function openExport(start, end) {
    if (view) {
      // Month/year mode: start and end are passed explicitly
      setExportStart(start);
      setExportEnd(end);
    } else {
      // Week mode: compute from weekStart and visibleDays
      setExportStart(weekStart);
      setExportEnd(addDays(weekStart, visibleDays - 1));
    }
    setShowExport(true);
  }

  async function exportPNG(start, end, extraParams) {
    setExporting(true);
    try {
      let blob;
      if (view === 'monthly') {
        const { startYear, startMonth, endYear, endMonth } = extraParams || {};
        blob = await api.exportMonthlyImage(startYear, startMonth, endYear, endMonth);
      } else if (view === 'yearly') {
        const { startYear, endYear } = extraParams || {};
        blob = await api.exportYearlyImage(startYear, endYear);
      } else {
        blob = await api.exportScheduleImage(start, end);
      }
      downloadBlob(blob, `课表_${start}_${end}.png`);
      if (view) setShowExport(false);
    } catch (e) {
      toast(e.message || '导出PNG失败');
    } finally {
      setExporting(false);
    }
  }

  async function exportCSV(start, end) {
    setExporting(true);
    try {
      const blob = await api.exportScheduleCSV(start, end);
      downloadBlob(blob, `课表_${start}_${end}.csv`);
      if (view) setShowExport(false);
    } catch (e) {
      toast(e.message || '导出CSV失败');
    } finally {
      setExporting(false);
    }
  }

  return {
    exporting,
    showExport,
    exportStart,
    exportEnd,
    openExport,
    exportPNG,
    exportCSV,
    setShowExport,
  };
}
