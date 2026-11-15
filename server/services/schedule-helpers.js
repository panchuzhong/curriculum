import { schedules, classes, semesters } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { isCalendarDate } from '../validations/dates.js';

// 年份补到 4 位，和前端的 fmt() 一致。不补的话年份小于 1000 会算出 '261-04-30'，
// 而库里存的是 '0261-05-01'——按字符串比大小 '0261-...' 反而小于 '261-...'。
// findConflicts（routes/schedules.js）拿 shiftDate(date, ±1) 算出相邻日期，再按日期精确
// 匹配库里的行，而 date 是直接从库里读的、不经校验：旧库里那些被原生控件左移成 0261
// 的行，推出来的相邻日期若不补位就对不上库里的写法，接口会报「没有冲突」而不是真实的冲突。
export function toLocalDateStr(d) {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 不夹上下限的原始日期算术。多数调用拿它拼查询条件、按日期取键（'1899-12-31' 当查询
// 下界照样能用）；也有调用方把结果写库或拼进错误消息（批量位移的目标日期、挪出学期的
// 提示）——那类调用方自己负责校验/夹取（位移目标逐个过 isValidDate），别指望这里兜底。
export function shiftDate(date, days) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
}

// 标跨午夜冲突要在范围前后各多取一天，相邻日的晚课才比得上。原始外推、不夹上下限
// （'1899-12-31' 当查询下界照样能用）；请求参数要夹的调用方自己夹。前端同名函数同规则，
// data-consistency 钉着两边。新增标冲突的消费方调它，别再手写 ±1。
export function conflictContextRange(start, end) {
  return [shiftDate(start, -1), shiftDate(end, 1)];
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

// Formula-injection guard for anything meant to be opened in Excel/Sheets:
// prefix cells starting with =,+,-,@ (or tab/CR) with a single quote so they are
// treated as text. The 复制表格 button applies the same rule on the client
// (src/utils/historyColumns.js); data-consistency.test.js pins the two together.
export function neutralizeFormula(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export function toCSV(rows) {
  return '﻿' + rows.map(r =>
    r.map(c => {
      const safe = neutralizeFormula(c);
      return `"${safe.replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
}

// 画得出来的课：开始、结束时间都算得出分钟数。校验加上之前存进来的旧行（空时间、'10'、
// '9点'）toMin 是 NaN：进了按天分组会把 groupEnd 写成 NaN、把真正重叠的课拆开叠画，进了
// monthDayWindow 会吞掉早/晚课的时间窗延伸，进了周视图的时间轴会为一节画不出来的课撑开格子。
// 只判非空不够——非空但解析不了的值照样是 NaN。周/月视图和两种出图都按它取课，
// 前端 src/utils/schedule.js 同名函数同规则（data-consistency 钉着两边）。
export function hasDrawableTimes(s) {
  return [s.startTime, s.endTime].every(t => typeof t === 'string' && Number.isFinite(toMin(t)));
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
// 零时长/极短课的最小条高（px）：网页用 minHeight、PNG 用 Math.max 下限，必须是同一个数，
// 否则 0 时长的课在网页上 height:0% 看不见、PNG 里却画出一条。data-consistency 钉着两边。
export const MONTH_BAR_MIN_HEIGHT = 6;

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

// 分组、分列用的结束分钟。零时长按 1 分钟算：判冲突时它是空区间（见 datedSpan），
// 但画出来的块有最小高度，和同一分钟开始的课顶边重合。按 0 算的话结果随输入顺序变，
// 两块会画成同一个满宽矩形、一个盖住另一个。src/utils/schedule.js 同规则（data-consistency 钉着）。
function layoutEnd(s) {
  return toMin(s.startTime) + Math.max(duration(s.startTime, s.endTime), 1);
}

export function detectConflictGroups(daySchedules) {
  if (!daySchedules.length) return [];
  const sorted = [...daySchedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const groups = [];
  let group = [sorted[0]];
  let groupEnd = layoutEnd(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const sStart = toMin(s.startTime);
    if (sStart < groupEnd) {
      group.push(s);
      groupEnd = Math.max(groupEnd, layoutEnd(s));
    } else {
      groups.push({ schedules: group, end: groupEnd });
      group = [s];
      groupEnd = layoutEnd(s);
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
  // 零时长是空区间，和谁都不重叠（与 datedSpan 同规则）。只比 aStart < bEnd && bStart < aEnd
  // 的话，夹在另一节课中间的零时长旧行会让保存报冲突，而标红和 GET /conflicts 都不认它。
  return aStart !== aEnd && bStart !== bEnd && aStart < bEnd && bStart < aEnd;
}

// 能按绝对时间参与比较的区间 [start, end]（分钟），否则 null：解析不了的行（校验加上之前
// 存进来的 '2026-10-1'、'2026-10-01T00:00:00'、空时间）算出的 NaN 会把扫描从中切断；
// '2026-10-1' 又会被当成一个真实的日子，而没有哪一列按这个写法取课，于是一节看得见的课
// 会和一节看不见的课「冲突」。零时长是空区间，和谁都不重叠，也不占空闲时段——不排除的话
// 冲突结果随输入顺序变，空闲时段会在那个点被切成两段。冲突扫描和空闲时段共用这一条，
// 前端 src/utils/schedule.js 的 datedConflictGroups 和这里一致（data-consistency 盯着）。
export function datedSpan(s) {
  if (!isCalendarDate(s.date)) return null;
  const [start, end] = scheduleBounds(s);
  return Number.isFinite(start) && Number.isFinite(end) && start !== end ? [start, end] : null;
}

// Unlike detectConflictGroups(), this accepts schedules from multiple dates
// and therefore catches a late class overlapping an early class on the next
// calendar day. 参与比较的行由 datedSpan 决定（解析不了的、零时长的不参与）。
export function detectDatedConflictGroups(items) {
  const spans = [];
  for (const s of items) {
    const span = datedSpan(s);
    if (span) spans.push({ s, start: span[0], end: span[1] });
  }
  if (!spans.length) return [];
  spans.sort((a, b) => a.start - b.start);
  const groups = [];
  let group = [spans[0].s];
  let groupEnd = spans[0].end;
  for (let i = 1; i < spans.length; i++) {
    const { s, start, end } = spans[i];
    if (start < groupEnd) {
      group.push(s);
      groupEnd = Math.max(groupEnd, end);
    } else {
      groups.push(group);
      group = [s];
      groupEnd = end;
    }
  }
  groups.push(group);
  return groups;
}

export function findDatedConflictIds(items) {
  return new Set(detectDatedConflictGroups(items).filter(group => group.length > 1).flat().map(s => s.id));
}

export function assignColumns(group) {
  const sorted = [...group].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const colEnds = [];
  return sorted.map(s => {
    const start = toMin(s.startTime);
    const end = layoutEnd(s);
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
