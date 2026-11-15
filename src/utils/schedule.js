import { isCalendarDate, addDays } from './date';

// 标跨午夜冲突要在范围前后各多取一天（与服务端 conflictContextRange 同规则，data-consistency
// 钉着两边）。原始外推、不夹上下限；抓取请求参数要夹的调用方自己夹（useWeekNavigation/MonthlySchedule）。
export function conflictContextRange(start, end) {
  return [addDays(start, -1), addDays(end, 1)];
}

export function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 画得出来的课：开始、结束时间都算得出分钟数。校验加上之前存进来的旧行（空时间、'10'、
// '9点'）toMin 是 NaN：进了按天分组会把 groupEnd 写成 NaN、把真正重叠的课拆开叠画，进了
// monthDayWindow 会吞掉早/晚课的时间窗延伸，进了周视图的时间轴会为一节画不出来的课撑开格子。
// 只判非空不够——非空但解析不了的值照样是 NaN。周/月视图和两种出图都按它取课，
// 服务端 schedule-helpers.js 同名函数同规则（data-consistency 钉着两边）。
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

// 分组、分列用的结束分钟。零时长按 1 分钟算：判冲突时它是空区间（见 datedConflictGroups），
// 但画出来的块有最小高度，和同一分钟开始的课顶边重合。按 0 算的话结果随输入顺序变，
// 两块会画成同一个满宽矩形、一个盖住另一个。服务端 schedule-helpers.js 同规则（data-consistency 钉着）。
function layoutEnd(s) {
  return toMin(s.startTime) + Math.max(duration(s.startTime, s.endTime), 1);
}

export function findConflictGroups(schedules) {
  if (!schedules.length) return [];
  const sorted = [...schedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
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

// 跨日冲突按绝对时间计算；与服务端规则由回归用例保持一致。
function scheduleBounds(schedule) {
  const [year, month, day] = schedule.date.split('-').map(Number);
  const dayStart = Date.UTC(year, month - 1, day) / 60000;
  const start = dayStart + toMin(schedule.startTime);
  return [start, start + duration(schedule.startTime, schedule.endTime)];
}

// 解析不了的行不参与，理由见服务端 datedSpan 的注释：NaN 会把扫描切断，
// '2026-10-1' 会和一节没有列显示它的课「冲突」。
function datedConflictGroups(items) {
  const spans = [];
  for (const s of items) {
    if (!isCalendarDate(s.date)) continue;
    const [start, end] = scheduleBounds(s);
    // 零时长（start === end）是空区间，和谁都不重叠（与服务端 datedSpan、schedulesOverlap 同规则）；
    // 不排除的话结果随输入顺序变——正常课在前时零时长课挤进它的组，两节都被误标冲突。
    if (Number.isFinite(start) && Number.isFinite(end) && start !== end) spans.push({ s, start, end });
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
  return new Set(datedConflictGroups(items).filter(group => group.length > 1).flat().map(s => s.id));
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

// A block is positioned from the grid's first visible hour, so a class that
// starts earlier has a negative top: the hidden part must come off its height,
// and a block that ends above the grid is not drawn at all.
export function clipBlock(topPx, heightPx, totalHeight) {
  const top = Math.max(0, topPx);
  const height = Math.min(heightPx + Math.min(0, topPx), totalHeight - top);
  return height > 0 ? { top, height } : null;
}

// durationBilling is always stored, so an edit form cannot tell "auto" from
// "manual" by null; the stored value matches the span exactly when it was auto.
export function isAutoBilling({ startTime, endTime, durationBilling }) {
  return durationBilling == null || durationBilling === duration(startTime, endTime);
}
