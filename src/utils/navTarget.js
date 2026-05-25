// Pure function: computes navigation target URL from current view context.
// Parameters:
//   path       - target path (e.g. '/monthly')
//   currentPath - current window.location.pathname
//   getDate    - function(view) → string|null (viewDate store reader)
export function getNavTarget(path, currentPath, getDate) {
  const cp = currentPath;
  // FROM week → derive from week
  if (cp === '/' || cp === '') {
    const wk = getDate('week');
    if (wk) {
      const d = new Date(wk + 'T00:00:00');
      if (path === '/monthly') return `/monthly?year=${d.getFullYear()}&month=${d.getMonth()}`;
      if (path === '/yearly') return `/yearly?year=${d.getFullYear()}`;
    }
    if (path === '/' || path === '') return wk ? `/?date=${wk}` : '/';
  }
  // FROM month → derive from month
  if (cp === '/monthly') {
    const mo = getDate('month');
    if (mo) {
      const [y, m] = mo.split('-');
      if (path === '/' || path === '') {
        // Prefer stored week if it belongs to the current displayed month
        const wk = getDate('week');
        if (wk) {
          const d = new Date(wk + 'T00:00:00');
          if (d.getFullYear() === +y && d.getMonth() === +m) return `/?week=${wk}`;
        }
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
      const mm = String(n.getMonth() + 1).padStart(2, '0');
      const dd = String(n.getDate()).padStart(2, '0');
      if (path === '/' || path === '') return `/?date=${yr}-${mm}-${dd}`;
      if (path === '/monthly') return `/monthly?year=${yr}&month=${n.getMonth()}`;
    }
    if (path === '/yearly') return yr ? `/yearly?year=${yr}` : '/yearly';
  }

  // Fallback: use target view's stored date
  if (path === '/' || path === '') {
    const wk = getDate('week');
    if (wk) return `/?date=${wk}`;
    return path;
  }
  if (path === '/monthly') {
    const mo = getDate('month');
    if (mo) { const [y, m] = mo.split('-'); return `/monthly?year=${y}&month=${m}`; }
    return path;
  }
  if (path === '/yearly') {
    const yr = getDate('year');
    if (yr) return `/yearly?year=${yr}`;
    return path;
  }
  return path;
}
