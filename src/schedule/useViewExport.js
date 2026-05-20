import { useState } from 'react';
import { api, API_BASE, getToken } from '../api';
import { useToast } from '../components/ToastProvider';

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
      let url;
      if (view === 'monthly') {
        const { startYear, startMonth, endYear, endMonth } = extraParams || {};
        url = `${API_BASE}/schedule-image/monthly?year=${startYear}&month=${startMonth}`;
        if (endYear !== undefined && endMonth !== undefined && (endYear !== startYear || endMonth !== startMonth)) {
          url += `&endYear=${endYear}&endMonth=${endMonth}`;
        }
      } else if (view === 'yearly') {
        const { startYear, endYear } = extraParams || {};
        url = `${API_BASE}/schedule-image/yearly?year=${startYear}`;
        if (endYear !== undefined && endYear !== startYear) {
          url += `&endYear=${endYear}`;
        }
      } else {
        url = `${API_BASE}/schedule-image?start=${start}&end=${end}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try { const p = JSON.parse(text); msg = p.error || msg; } catch {}
        throw new Error(msg || '导出失败');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `课表_${start}_${end}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
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
      const a = document.createElement('a');
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `课表_${start}_${end}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
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
