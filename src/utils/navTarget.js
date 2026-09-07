// The stored week is the first visible day, and its span can straddle a month or
// year boundary — the week beginning 2026-08-31 runs into September. Asking
// whether the span *touches* a period, rather than testing its first day alone,
// keeps "this week" recognisable as belonging to "this month" on such a week.
// The span is 7 days on desktop but only 2 on mobile, where the store holds a
// bare day rather than a Monday — so the caller says how many days are shown.
function weekSpan(weekStart, spanDays) {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + spanDays - 1);
  return [start, end];
}

function weekTouchesMonth(weekStart, spanDays, year, month) {
  const [start, end] = weekSpan(weekStart, spanDays);
  const target = year * 12 + month;
  return target >= start.getFullYear() * 12 + start.getMonth()
    && target <= end.getFullYear() * 12 + end.getMonth();
}

function weekTouchesYear(weekStart, spanDays, year) {
  const [start, end] = weekSpan(weekStart, spanDays);
  return year >= start.getFullYear() && year <= end.getFullYear();
}

// With nothing to agree with, a straddling week belongs to the period holding
// most of its days — the one containing its middle day (Thursday of a Monday
// week, which is also the ISO 8601 rule). A two-day span anchors on its first day.
function weekAnchor(weekStart, spanDays) {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + Math.floor((spanDays - 1) / 2));
  return d;
}

// Pure function: computes navigation target URL from current view context.
// Parameters:
//   path       - target path (e.g. '/monthly')
//   currentPath - current window.location.pathname
//   getDate    - function(view) → string|null (viewDate store reader)
//   spanDays   - days the weekly view shows from the stored week (7 desktop, 2 mobile)
export function getNavTarget(path, currentPath, getDate, spanDays = 7) {
  const cp = currentPath;
  // FROM week → derive from week
  if (cp === '/' || cp === '') {
    const wk = getDate('week');
    if (wk) {
      const d = weekAnchor(wk, spanDays);
      if (path === '/monthly') {
        // A week spanning two months belongs to whichever the views last agreed
        // on, so long as the span still reaches it; else the anchor day's month.
        const mo = getDate('month');
        if (mo) {
          const [my, mm] = mo.split('-').map(Number);
          if (weekTouchesMonth(wk, spanDays, my, mm)) return `/monthly?year=${my}&month=${mm}`;
        }
        return `/monthly?year=${d.getFullYear()}&month=${d.getMonth()}`;
      }
      if (path === '/yearly') {
        const yr = getDate('year');
        if (yr && weekTouchesYear(wk, spanDays, +yr)) return `/yearly?year=${yr}`;
        return `/yearly?year=${d.getFullYear()}`;
      }
    }
    if (path === '/' || path === '') return wk ? `/?week=${wk}` : '/';
  }
  // FROM month → derive from month
  if (cp === '/monthly') {
    const mo = getDate('month');
    if (mo) {
      const [y, m] = mo.split('-');
      if (path === '/' || path === '') {
        // Prefer stored week if it belongs to the current displayed month
        const wk = getDate('week');
        if (wk && weekTouchesMonth(wk, spanDays, +y, +m)) return `/?week=${wk}`;
        return `/?date=${y}-${String(+m + 1).padStart(2, '0')}-10`;
      }
      if (path === '/yearly') return `/yearly?year=${y}`;
    }
    if (path === '/monthly') return mo ? `/monthly?year=${mo.split('-')[0]}&month=${mo.split('-')[1]}` : '/monthly';
  }
  // FROM year → derive from year
  if (cp === '/yearly') {
    const yr = getDate('year');
    if (yr) {
      const n = new Date();
      if (path === '/' || path === '') {
        // Prefer stored week if in same year
        const wk = getDate('week');
        if (wk && weekTouchesYear(wk, spanDays, +yr)) return `/?week=${wk}`;
        // Prefer stored month if in same year
        const mo = getDate('month');
        if (mo) {
          const [my, mm] = mo.split('-');
          if (my === yr) return `/?date=${yr}-${String(+mm + 1).padStart(2, '0')}-10`;
        }
        return `/?date=${yr}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
      }
      if (path === '/monthly') {
        // Prefer stored month if in same year
        const mo = getDate('month');
        if (mo) {
          const [my, mm] = mo.split('-');
          if (my === yr) return `/monthly?year=${yr}&month=${mm}`;
        }
        return `/monthly?year=${yr}&month=${n.getMonth()}`;
      }
    }
    if (path === '/yearly') return yr ? `/yearly?year=${yr}` : '/yearly';
  }

  // Fallback: use target view's stored date
  if (path === '/' || path === '') {
    const wk = getDate('week');
    if (wk) return `/?week=${wk}`;
    return path;
  }
  if (path === '/monthly') {
    const mo = getDate('month');
    if (mo) { const [y, m] = mo.split('-'); return `/monthly?year=${y}&month=${m}`; }
    const wk = getDate('week');
    if (wk) {
      const d = weekAnchor(wk, spanDays);
      return `/monthly?year=${d.getFullYear()}&month=${d.getMonth()}`;
    }
    return path;
  }
  if (path === '/yearly') {
    const yr = getDate('year');
    if (yr) return `/yearly?year=${yr}`;
    const mo = getDate('month');
    if (mo) return `/yearly?year=${mo.split('-')[0]}`;
    const wk = getDate('week');
    if (wk) return `/yearly?year=${weekAnchor(wk, spanDays).getFullYear()}`;
    return path;
  }
  return path;
}
