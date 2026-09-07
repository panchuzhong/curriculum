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
