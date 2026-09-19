import { schedules, classes, semesters } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// 年份补到 4 位，和前端的 fmt() 一致。不补的话年份小于 1000 会算出 '261-04-30'，
// 而库里存的是 '0261-05-01'——按字符串比大小 '0261-...' 反而小于 '261-...'。
// getConflictsForSchedule 拿 shiftDate(s.date, ±1) 当区间端点，而 s.date 是直接从库里
// 读的、不经校验：旧库里那些被原生控件左移成 0261 的行，区间一算就什么都匹配不到，
// 接口会报「没有冲突」而不是真实的冲突。
export function toLocalDateStr(d) {
  const y = String(d.getFullYear()).padStart(4, '0');
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

// 课程块的位置和高度。网页（ScheduleBlock.jsx）和导出的 PNG（image-gen.js）必须
// 给同一节课算出同一个块，所以这段只在这里写一次，两边都调它。
// 之前 image-gen.js 把时长公式抄了一遍、漏掉 duration() 的 s === e 分支，
// 于是 08:00~08:00 在网页上是一行高，在 PNG 里却画成覆盖整天的一条。
// 高度有 rowHeight - 1 的下限：0 时长的课也得留得下一行文字，否则点不到也看不见。
export function blockGeometry(startTime, endTime, { rowHeight, topGapHeight, firstLabelMin }) {
  const top = topGapHeight + (toMin(startTime) - firstLabelMin) / 60 * rowHeight + 1;
  const height = Math.max(duration(startTime, endTime) / 60 * rowHeight - 1, rowHeight - 1);
  return { top, height };
}

// 月历里一天的时间窗。默认画 08:00~22:30，有课越出去就把窗口撑到那节课。
// 网页（MonthlySchedule.jsx）和导出的月历 PNG（image-gen-monthly.js）必须算出
// 同一个窗口，所以只写这一次，两边都调它（由 data-consistency 钉着）。
// latest 用 duration()：自己写 et > st ? et : et + 1440 的话，08:00~08:00 会被
// 当成上到次日 08:00，把窗口拉到 32 点，当天其它课的条形全被压扁。
export const MONTH_DAY_START = 8 * 60;
export const MONTH_DAY_END = 22 * 60 + 30;

export function monthDayWindow(daySchedules) {
  const earliest = Math.min(...daySchedules.map(s => toMin(s.startTime)));
  const latest = Math.max(...daySchedules.map(s => toMin(s.startTime) + duration(s.startTime, s.endTime)));
  const hasEarly = earliest < MONTH_DAY_START;
  const hasLate = latest > MONTH_DAY_END;
  const dayStart = hasEarly ? earliest : MONTH_DAY_START;
  const dayEnd = hasLate ? latest : MONTH_DAY_END;
  return { dayStart, dayEnd, dayTotal: dayEnd - dayStart };
}

// 一节课在那个窗口里的位置和长度，按百分比给（两边的容器单位不同：
// 网页用 %，出图再乘像素高度）。
export function monthBarPct(startTime, endTime, { dayStart, dayTotal }) {
  const startMin = toMin(startTime);
  const dur = duration(startTime, endTime);
  const endMin = startMin + dur;
  return {
    topPct: (startMin - dayStart) / dayTotal * 100,
    heightPct: dur / dayTotal * 100,
    isEarly: startMin < MONTH_DAY_START,
    isLate: endMin > MONTH_DAY_END,
  };
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

export function getScheduleWithClass(db, id, teacherId) {
  const s = db.select().from(schedules).where(eq(schedules.id, id)).get();
  if (!s) return null;
  const cls = db.select().from(classes).where(eq(classes.id, s.classId)).get();
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
