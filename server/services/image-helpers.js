import { isHoliday, isWorkday, getHolidayName } from './holidays.js';

// ── Theme detection ─────────────────────────────────────────────
export function isDarkTheme(theme) {
  const hour = new Date().getHours();
  return theme === 'dark' ? true : theme === 'light' ? false : (hour < 7 || hour >= 19);
}

// ── Browser page lifecycle ──────────────────────────────────────
export async function withBrowserPage(html, viewport, clipFn) {
  const { getBrowser } = await import('./browser.js');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.setViewport({ ...viewport, isMobile: !!viewport.isMobile });
    const opts = { type: 'png', timeout: 30000 };
    if (clipFn) opts.clip = await clipFn(page);
    const buf = await page.screenshot(opts);
    return Buffer.from(buf);
  } finally {
    await page.close();
  }
}

// ── DB holiday override helpers ─────────────────────────────────
export function buildDbHolidayHelpers(dbHolidays) {
  const dbHolidayMap = {};
  const dbWorkdaySet = new Set();
  for (const h of dbHolidays) {
    if (h.type === 'holiday') dbHolidayMap[h.date] = h.name || '';
    else if (h.type === 'workday') dbWorkdaySet.add(h.date);
  }
  // DB entries are authoritative per year (same semantics as the frontend's
  // src/utils/holidays.js): once a teacher has any holiday record for a year,
  // built-in data for that year is ignored, so deleting a built-in holiday in
  // Settings also removes it from exported images.
  const dbHolidayYears = new Set(dbHolidays.map(h => h.date.slice(0, 4)));

  function checkIsHoliday(dateStr) {
    if (dbHolidayMap[dateStr] !== undefined) return true;
    if (dbWorkdaySet.has(dateStr)) return false;
    if (dbHolidayYears.has(dateStr.slice(0, 4))) return false;
    return isHoliday(dateStr);
  }
  function checkIsWorkday(dateStr) {
    if (dbWorkdaySet.has(dateStr)) return true;
    if (dbHolidayMap[dateStr] !== undefined) return false;
    if (dbHolidayYears.has(dateStr.slice(0, 4))) return false;
    return isWorkday(dateStr);
  }
  function checkHolidayName(dateStr) {
    if (dbHolidayMap[dateStr]) return dbHolidayMap[dateStr];
    return getHolidayName(dateStr);
  }

  return { checkIsHoliday, checkIsWorkday, checkHolidayName };
}
