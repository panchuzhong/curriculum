import { useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';

function downloadBlob(blob, filename) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}

export default function useViewExport({ view }) {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportStart, setExportStart] = useState(null);
  const [exportEnd, setExportEnd] = useState(null);

  function openExport(start, end, extra) {
    setExportStart(start);
    setExportEnd(end);
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
      setShowExport(false);
    } catch (e) {
      toast(e.message || '导出PNG失败');
    } finally {
      setExporting(false);
    }
  }

  async function exportCSV(start, end) {
    try {
      const blob = await api.exportScheduleCSV(start, end);
      downloadBlob(blob, `课表_${start}_${end}.csv`);
      setShowExport(false);
    } catch (e) {
      toast(e.message || '导出CSV失败');
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
