import { useState } from 'react';
import { api } from '../api';
import { parseDateStr } from '../utils/date';
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
      const token = localStorage.getItem('token');
      if (!token) throw new Error('未登录');
      const res = await fetch(`/api/schedule-image?start=${start}&end=${end}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `课表_${start}_${end}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast('导出失败'); } finally {
      setExporting(false);
    }
  }

  async function exportCSV(start, end) {
    try {
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const data = await api.getSchedules(start, end);
    const rows = [['日期', '星期', '班级', '年级', '学科', '开始时间', '结束时间', '计费时长(分钟)', '上课地点', '竞赛课', '单价', '学生人数', '优惠金额']];
    const sorted = [...data].sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime)
    );
    sorted.forEach(s => {
      const d = parseDateStr(s.date);
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
    } catch (e) { toast('导出失败'); }
  }

  return {
    exporting, showExport, exportStart, exportEnd,
    openExport, exportPNG, exportCSV, setShowExport,
  };
}
