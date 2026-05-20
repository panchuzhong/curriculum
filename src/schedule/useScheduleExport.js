import { useState } from 'react';
import { api, API_BASE, getToken } from '../api';
import { useToast } from '../components/ToastProvider';

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
      const token = getToken();
      if (!token) throw new Error('未登录');
      const res = await fetch(`${API_BASE}/schedule-image?start=${start}&end=${end}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `课表_${start}_${end}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (e) { toast('导出失败'); } finally {
      setExporting(false);
    }
  }

  async function exportCSV(start, end) {
    setExporting(true);
    try {
      const blob = await api.exportScheduleCSV(start, end);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `课表_${start}_${end}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (e) { toast(e.message || '导出失败'); }
    finally { setExporting(false); }
  }

  return {
    exporting, showExport, exportStart, exportEnd,
    openExport, exportPNG, exportCSV, setShowExport,
  };
}
