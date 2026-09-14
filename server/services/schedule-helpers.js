import { drizzleDb } from '../db/index.js';
import { schedules, classes, semesters } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
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
    r.map(c => {
      const s = String(c ?? '');
      // CSV formula-injection guard: prefix cells starting with =,+,-,@ (or tab/CR)
      // with a single quote so Excel/Sheets treat them as text.
      const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
      return `"${safe.replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
}

export function duration(startTime, endTime) {
  const s = toMin(startTime);
  const e = toMin(endTime);
  if (s === e) return 0;
  return e > s ? e - s : e + 24 * 60 - s;
}

export function detectConflictGroups(daySchedules) {
  if (!daySchedules.length) return [];
  const sorted = [...daySchedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const groups = [];
  let group = [sorted[0]];
  let groupEnd = toMin(sorted[0].startTime) + duration(sorted[0].startTime, sorted[0].endTime);
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const sStart = toMin(s.startTime);
    if (sStart < groupEnd) {
      group.push(s);
      groupEnd = Math.max(groupEnd, sStart + duration(s.startTime, s.endTime));
    } else {
      groups.push({ schedules: group, end: groupEnd });
      group = [s];
      groupEnd = sStart + duration(s.startTime, s.endTime);
    }
  }
  groups.push({ schedules: group, end: groupEnd });

  return groups.map(g => g.schedules);
}

export function scheduleBounds(schedule) {
  const [year, month, day] = schedule.date.split('-').map(Number);
  const dayStart = Date.UTC(year, month - 1, day) / 60000;
  const start = dayStart + toMin(schedule.startTime);
  return [start, start + duration(schedule.startTime, schedule.endTime)];
}

export function schedulesOverlap(a, b) {
  const [aStart, aEnd] = scheduleBounds(a);
  const [bStart, bEnd] = scheduleBounds(b);
  return aStart < bEnd && bStart < aEnd;
}

// Unlike detectConflictGroups(), this accepts schedules from multiple dates
// and therefore catches a late class overlapping an early class on the next
// calendar day.
export function detectDatedConflictGroups(items) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => scheduleBounds(a)[0] - scheduleBounds(b)[0]);
  const groups = [];
  let group = [sorted[0]];
  let groupEnd = scheduleBounds(sorted[0])[1];
  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = scheduleBounds(sorted[i]);
    if (start < groupEnd) {
      group.push(sorted[i]);
      groupEnd = Math.max(groupEnd, end);
    } else {
      groups.push(group);
      group = [sorted[i]];
      groupEnd = end;
    }
  }
  groups.push(group);
  return groups;
}

export function assignColumns(group) {
  const sorted = [...group].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const colEnds = [];
  return sorted.map(s => {
    const start = toMin(s.startTime);
    const end = start + duration(s.startTime, s.endTime);
    let col = colEnds.findIndex(ce => ce <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(0); }
    colEnds[col] = end;
    return { ...s, _col: col };
  });
}

export function getScheduleWithClass(id, teacherId) {
  const s = drizzleDb.select().from(schedules).where(eq(schedules.id, id)).get();
  if (!s) return null;
  const cls = drizzleDb.select().from(classes).where(eq(classes.id, s.classId)).get();
  if (cls?.teacherId !== teacherId) return null;
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

export function buildPricingLookup(allPricing) {
  const byClass = {};
  for (const p of allPricing) {
    (byClass[p.classId] ??= []).push(p);
  }
  for (const arr of Object.values(byClass)) {
    // matchPricing below compares code units (<=), so order the same way:
    // locale collation can disagree for non-ISO strings (e.g. a restore that
    // smuggled in garbage effectiveFrom), which would make the scan break early.
    arr.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  }
  return function matchPricing(classId, date) {
    const records = byClass[classId];
    if (!records || records.length === 0) return null;
    let match = null;
    for (const p of records) {
      if (p.effectiveFrom <= date) match = p;
      else break;
    }
    return match;
  };
}

const _semesterCache = new Map();
// Invalidation from this process is explicit (clearSemesterCache), but other
// processes sharing the SQLite file never trigger it. The report cache bounds
// that staleness with a TTL; this cache had none, so semester edits made by
// another process were never seen. TTL mirrors the report cache's 60s.
const SEMESTER_CACHE_TTL_MS = 60_000;
export function getTeacherSemesters(db, teacherId) {
  const cached = _semesterCache.get(teacherId);
  if (cached && Date.now() - cached.at < SEMESTER_CACHE_TTL_MS) return cached.value;
  const result = db.select().from(semesters).where(eq(semesters.teacherId, teacherId)).all();
  _semesterCache.set(teacherId, { value: result, at: Date.now() });
  return result;
}
export function clearSemesterCache() { _semesterCache.clear(); }
