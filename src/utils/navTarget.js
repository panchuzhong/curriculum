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
      if (path === '/' || path === '') {
        // Prefer stored week if in same year
        const wk = getDate('week');
        if (wk && new Date(wk + 'T00:00:00').getFullYear() === +yr) return `/?week=${wk}`;
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
    return path;
  }
  if (path === '/yearly') {
    const yr = getDate('year');
    if (yr) return `/yearly?year=${yr}`;
    return path;
  }
  return path;
}
