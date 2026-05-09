import { drizzleDb } from '../db/index.js';
import { schedules, classes } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function resolveRange(query) {
  if (!query.range) return query;
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (query.range === 'today') {
    const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { ...query, start: s, end: s };
  }
  if (query.range === 'tomorrow') {
    const tmr = new Date(d);
    tmr.setDate(d.getDate() + 1);
    const s = `${tmr.getFullYear()}-${pad(tmr.getMonth() + 1)}-${pad(tmr.getDate())}`;
    return { ...query, start: s, end: s };
  }
  if (query.range === 'week') {
    const day = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      ...query,
      start: `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`,
      end: `${sun.getFullYear()}-${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}`,
    };
  }
  if (query.range === 'month') {
    const y = d.getFullYear(), m = d.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    return { ...query, start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${last}` };
  }
  return query;
}

export function toCSV(rows) {
  return '﻿' + rows.map(r =>
    r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
}

export function detectConflictGroups(daySchedules) {
  if (daySchedules.length < 2) return [];
  const sorted = [...daySchedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const groups = [];
  let group = [sorted[0]];
  let groupEnd = toMin(sorted[0].endTime) >= toMin(sorted[0].startTime)
    ? toMin(sorted[0].endTime)
    : toMin(sorted[0].endTime) + 24 * 60;

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const sStart = toMin(s.startTime);
    const sEnd = toMin(s.endTime) >= sStart ? toMin(s.endTime) : toMin(s.endTime) + 24 * 60;
    if (sStart < groupEnd) {
      group.push(s);
      groupEnd = Math.max(groupEnd, sEnd);
    } else {
      if (group.length > 1) groups.push(group);
      group = [s];
      groupEnd = sEnd;
    }
  }
  if (group.length > 1) groups.push(group);
  return groups;
}

export function getScheduleWithClass(id, teacherId) {
  const s = drizzleDb.select().from(schedules).where(eq(schedules.id, id)).get();
  if (!s) return null;
  const cls = drizzleDb.select().from(classes).where(eq(classes.id, s.classId)).get();
  if (teacherId != null && cls?.teacherId !== teacherId) return null;
  return { ...s, class: cls || null };
}

export function calcDurationBilling(startTime, endTime, manual) {
  if (manual != null) return manual;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}
