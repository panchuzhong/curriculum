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
  const hasDbData = dbHolidays.length > 0;

  function checkIsHoliday(dateStr) {
    if (hasDbData && dbHolidayMap[dateStr] !== undefined) return true;
    if (hasDbData && dbWorkdaySet.has(dateStr)) return false;
    return isHoliday(dateStr);
  }
  function checkIsWorkday(dateStr) {
    if (hasDbData && dbWorkdaySet.has(dateStr)) return true;
    if (hasDbData && dbHolidayMap[dateStr] !== undefined) return false;
    return isWorkday(dateStr);
  }
  function checkHolidayName(dateStr) {
    if (dbHolidayMap[dateStr]) return dbHolidayMap[dateStr];
    return getHolidayName(dateStr);
  }

  return { checkIsHoliday, checkIsWorkday, checkHolidayName };
}
