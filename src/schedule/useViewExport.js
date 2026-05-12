import { useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';

function getToken() {
  return localStorage.getItem('token');
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
      let url;
      if (view === 'monthly') {
        const { startYear, startMonth, endYear, endMonth } = extraParams || {};
        url = `/api/schedule-image/monthly?year=${startYear}&month=${startMonth}`;
        if (endYear !== undefined && endMonth !== undefined && (endYear !== startYear || endMonth !== startMonth)) {
          url += `&endYear=${endYear}&endMonth=${endMonth}`;
        }
      } else if (view === 'yearly') {
        const { startYear, endYear } = extraParams || {};
        url = `/api/schedule-image/yearly?year=${startYear}`;
        if (endYear !== undefined && endYear !== startYear) {
          url += `&endYear=${endYear}`;
        }
      } else {
        url = `/api/schedule-image?start=${start}&end=${end}`;
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
      a.href = URL.createObjectURL(blob);
      a.download = `课表_${start}_${end}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      setShowExport(false);
    } catch (e) {
      toast(e.message || '导出PNG失败');
    } finally {
      setExporting(false);
    }
  }

  async function exportCSV(start, end) {
    try {
      const schedules = await api.getSchedules(start, end);
      if (schedules.length === 0) {
        toast('所选范围内没有排课');
        return;
      }
      const rows = schedules
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
        .map(s => {
          const d = new Date(s.date + 'T00:00:00');
          const wd = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
          return [
            s.date, wd,
            s.class?.name ?? '',
            s.class?.grade ?? '',
            s.class?.subject ?? '',
            s.startTime, s.endTime,
            s.durationBilling ?? '',
            s.locationName ?? '',
            s.class?.isCompetition ? '是' : '否',
            s.class?.unitPrice ?? '',
            (s.class?.studentCount ?? '').toString(),
            (s.class?.discountAmount ?? ''),
          ].map(v => {
            const str = String(v);
            const safe = /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
            return `"${safe.replace(/"/g, '""')}"`;
          }).join(',');
        });
      const header = '日期,星期,班级,年级,学科,开始时间,结束时间,计费时长(分钟),上课地点,竞赛课,单价,学生人数,优惠金额';
      const bom = '﻿';
      const csv = bom + [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `课表_${start}_${end}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
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
