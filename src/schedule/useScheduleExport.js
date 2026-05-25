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

export default function useScheduleExport({ weekStart, visibleDays, addDays }) {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportStart, setExportStart] = useState(null);
  const [exportEnd, setExportEnd] = useState(null);

  function openExport() {
    setExportStart(weekStart);
    setExportEnd(addDays(weekStart, visibleDays - 1));
    setShowExport(true);
  }

  async function exportPNG(start, end) {
    setExporting(true);
    try {
      const blob = await api.exportScheduleImage(start, end);
      downloadBlob(blob, `课表_${start}_${end}.png`);
    } catch (e) { toast('导出失败'); } finally {
      setExporting(false);
    }
  }

  async function exportCSV(start, end) {
    setExporting(true);
    try {
      const blob = await api.exportScheduleCSV(start, end);
      downloadBlob(blob, `课表_${start}_${end}.csv`);
    } catch (e) { toast(e.message || '导出失败'); }
    finally { setExporting(false); }
  }

  return {
    exporting, showExport, exportStart, exportEnd,
    openExport, exportPNG, exportCSV, setShowExport,
  };
}
