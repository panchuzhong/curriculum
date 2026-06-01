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

  // If the last group wraps past midnight (end > 1440), it may overlap the
  // first group's early-morning schedules; merge them. Mirrors the server's
  // detectConflictGroups so UI conflict layout matches the exported image.
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    if (last.end > 24 * 60) {
      const morningReach = last.end - 24 * 60;
      const firstStart = toMin(groups[0].schedules[0].startTime);
      if (firstStart < morningReach) {
        groups[0].schedules.push(...last.schedules);
        groups[0].end = Math.max(groups[0].end, last.end);
        groups.pop();
      }
    }
  }

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
