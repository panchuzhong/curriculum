export function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
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

export function findConflictGroups(schedules) {
  if (!schedules.length) return [];
  const sorted = [...schedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
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
