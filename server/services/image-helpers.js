import { isHoliday, isWorkday, getHolidayName } from './holidays.js';

// ── Theme detection ─────────────────────────────────────────────
export function isDarkTheme(theme) {
  const hour = new Date().getHours();
  return theme === 'dark' ? true : theme === 'light' ? false : (hour < 7 || hour >= 19);
}

// ── Browser page lifecycle ──────────────────────────────────────
// Chromium silently paints nothing (or throws) once a screenshot exceeds
// roughly 1.3e8 device pixels — a 4x monthly export went blank after about
// seven months — so the scale factor is lowered, in half steps, until it fits.
const MAX_DEVICE_PIXELS = 1.2e8;
export function fitDeviceScaleFactor(requested, cssWidth, cssHeight) {
  const fit = Math.floor(Math.sqrt(MAX_DEVICE_PIXELS / (cssWidth * cssHeight)) * 2) / 2;
  return Math.min(requested, Math.max(1, fit));
}

export async function withBrowserPage(html, viewport, clipFn) {
  const { getBrowser } = await import('./browser.js');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.setViewport({ ...viewport, isMobile: !!viewport.isMobile });
    const opts = { type: 'png', timeout: 30000 };
    if (clipFn) opts.clip = await clipFn(page);
    const requested = viewport.deviceScaleFactor ?? 1;
    const cssHeight = opts.clip?.height ?? await page.evaluate(() => document.documentElement.scrollHeight);
    const dsf = fitDeviceScaleFactor(requested, opts.clip?.width ?? viewport.width, cssHeight);
    if (dsf !== requested) await page.setViewport({ ...viewport, deviceScaleFactor: dsf, isMobile: !!viewport.isMobile });
    const buf = await page.screenshot(opts);
    return Buffer.from(buf);
  } finally {
    // A page that died with the browser throws on close; keep the real error.
    await page.close().catch(() => {});
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
