import { getBrowser } from './browser.js';
import { isHoliday, isWorkday, getHolidayName } from './holidays.js';
import { getColor, getTextColor } from './colors.js';
import { toMin, toLocalDateStr, escapeHtml, detectConflictGroups, assignColumns } from './schedule-helpers.js';

function getMonthDates(year, month) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay() || 7;
  const last = new Date(year, month + 1, 0);
  const dates = [];
  for (let i = 1; i < startDay; i++) dates.push(null);
  for (let d = 1; d <= last.getDate(); d++) dates.push(d);
  return dates;
}

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Build list of (year, month) from range ────────────────────────
function buildMonthList(startYear, startMonth, endYear, endMonth) {
  const months = [];
  let cy = startYear, cm = startMonth;
  while (cy < endYear || (cy === endYear && cm <= endMonth)) {
    months.push({ year: cy, month: cm });
    cm++;
    if (cm > 11) { cm = 0; cy++; }
  }
  return months;
}

// ── Generate HTML for one month ────────────────────────────────────
function renderMonthHtml(schedulesWithClasses, year, month, { theme, dbHolidayMap, dbWorkdaySet, hasDbData, todayStr }) {
  const dates = getMonthDates(year, month);
  const dayRows = Math.ceil(dates.length / 7);

  const byDate = {};
  dates.forEach(d => {
    if (d === null) return;
    const ds = formatDate(year, month, d);
    byDate[ds] = [];
  });
  schedulesWithClasses.forEach(s => {
    if (byDate[s.date]) byDate[s.date].push(s);
  });
  Object.values(byDate).forEach(arr => arr.sort((a, b) => a.startTime.localeCompare(b.startTime)));

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

  const hour = new Date().getHours();
  const isDark = theme === 'dark' ? true : theme === 'light' ? false : (hour < 7 || hour >= 19);

  const c = isDark ? {
    bg: '#111827', text: '#f3f4f6',
    headerBg: '#1f2937', headerText: '#e5e7eb',
    cellBg: '#1f2937', cellEmptyBg: 'rgba(31,41,55,0.5)',
    todayBorder: '#3b82f6', todayBg: 'rgba(30,58,138,0.3)',
    todayText: '#93c5fd',
    holidayBg: 'rgba(127,29,29,0.25)', workdayBg: 'rgba(120,53,15,0.25)',
    badgeRed: '#ef4444', badgeOrange: '#f97316', badgeBlue: '#3b82f6',
    dayNumText: '#d1d5db',
  } : {
    bg: '#f9fafb', text: '#111827',
    headerBg: '#f3f4f6', headerText: '#111827',
    cellBg: '#f3f4f6', cellEmptyBg: 'rgba(243,244,246,0.5)',
    todayBorder: '#3b82f6', todayBg: 'rgba(219,234,254,0.7)',
    todayText: '#1d4ed8',
    holidayBg: 'rgba(254,242,242,0.8)', workdayBg: 'rgba(255,247,237,0.8)',
    badgeRed: '#ef4444', badgeOrange: '#f97316', badgeBlue: '#3b82f6',
    dayNumText: '#374151',
  };

  const CELL_W = 160;
  const HEADER_H_CELL = 22;
  const CELL_PAD = 4;
  const CONTENT_H = CELL_W;
  const CELL_H = CONTENT_H + HEADER_H_CELL + CELL_PAD;
  const GAP = 4;
  const PAD = 10;

  const DEFAULT_START = 8 * 60;
  const DEFAULT_END = 22 * 60 + 30;
  const DEFAULT_TOTAL = DEFAULT_END - DEFAULT_START;

  function renderDayCell(day) {
    if (day === null) {
      return `<div style="width:${CELL_W}px;height:${CELL_H}px;background:${c.cellEmptyBg};border-radius:6px"></div>`;
    }
    const dateStr = formatDate(year, month, day);
    const daySchedules = byDate[dateStr] || [];
    const holiday = checkIsHoliday(dateStr);
    const workday = checkIsWorkday(dateStr);
    const isToday = dateStr === todayStr;

    let cellBg = c.cellBg;
    if (isToday) cellBg = c.todayBg;
    else if (holiday) cellBg = c.holidayBg;
    else if (workday) cellBg = c.workdayBg;

    const borderStyle = isToday ? `border:2px solid ${c.todayBorder};` : '';

    let badgesHtml = '';
    if (isToday) badgesHtml += `<span style="font-size:9px;background:${c.badgeBlue};color:#fff;padding:1px 5px;border-radius:999px;font-weight:500;margin-left:2px">今</span>`;
    if (holiday) badgesHtml += `<span style="font-size:9px;background:${c.badgeRed};color:#fff;padding:1px 5px;border-radius:999px;font-weight:500;margin-left:2px">${escapeHtml(checkHolidayName(dateStr))}</span>`;
    if (workday) badgesHtml += `<span style="font-size:9px;background:${c.badgeOrange};color:#fff;padding:1px 5px;border-radius:999px;font-weight:500;margin-left:2px">班</span>`;

    let barsHtml = '';
    if (daySchedules.length > 0) {
      // Check if any schedule extends beyond default range
      const earliest = Math.min(...daySchedules.map(s => toMin(s.startTime)));
      const latest = Math.max(...daySchedules.map(s => {
        const st = toMin(s.startTime);
        const et = toMin(s.endTime);
        return et > st ? et : et + 24 * 60;
      }));
      const hasEarly = earliest < DEFAULT_START;
      const hasLate = latest > DEFAULT_END;
      const dayStart = hasEarly ? earliest : DEFAULT_START;
      const dayEnd = hasLate ? latest : DEFAULT_END;
      const dayTotal = dayEnd - dayStart;

      const groups = detectConflictGroups(daySchedules);
      for (const group of groups) {
        const hasConflict = group.length > 1;
        const items = hasConflict ? assignColumns(group) : group.map(s => ({ ...s, _col: 0 }));
        const totalCols = Math.max(...items.map(it => (it._col || 0))) + 1;
        for (const item of items) {
          const startMin = toMin(item.startTime);
          const endMinRaw = toMin(item.endTime);
          const endMin = endMinRaw > startMin ? endMinRaw : endMinRaw + 24 * 60;
          const dur = endMin - startMin;
          const topPct = (startMin - dayStart) / dayTotal * 100;
          const heightPct = dur / dayTotal * 100;
          const barTop = HEADER_H_CELL + topPct / 100 * CONTENT_H;
          const barH = Math.max(6, heightPct / 100 * CONTENT_H);
          const isEarly = startMin < DEFAULT_START;
          const isLate = endMin > DEFAULT_END;
          const isOvertime = isEarly || isLate;
          const widthPct = hasConflict ? 100 / totalCols : 100;
          const leftPct = hasConflict ? (item._col || 0) * widthPct : 0;
          const cellInnerW = isOvertime ? CELL_W : CELL_W - 8;
          const barLeft = isOvertime ? (leftPct / 100 * CELL_W) : (leftPct / 100 * (CELL_W - 8) + 4);
          const barW = (widthPct / 100 * cellInnerW) - (isOvertime ? 0 : 2);
          const bg = hasConflict ? '#ef4444' : getColor(item.class, isDark);
          const fg = hasConflict ? '#ffffff' : getTextColor(item.class, isDark);
          const name = escapeHtml(item.class?.name ?? '');
          const star = item.class?.isCompetition ? '★ ' : '';
          const fontSize = Math.max(7, Math.min(14, Math.floor(barH * 0.8)));
          const ring = hasConflict ? 'box-shadow:0 0 0 1px #ef4444;z-index:1;' : '';
          const overtimeRing = isOvertime ? 'border-left:3px solid #f59e0b;border-right:3px solid #f59e0b;' : '';
          const borderRad = isEarly && isLate ? '0' : isEarly ? '0 0 4px 4px' : isLate ? '4px 4px 0 0' : '4px';
          barsHtml += `<div style="position:absolute;left:${barLeft}px;top:${barTop}px;width:${barW}px;height:${barH}px;background:${bg};color:${fg};border-radius:${borderRad};display:flex;align-items:center;padding:0 ${isOvertime ? 6 : 4}px;font-size:${fontSize}px;overflow:hidden;white-space:nowrap;${ring}${overtimeRing}" title="${star}${name} ${item.startTime}-${item.endTime}${hasConflict ? ' [冲突]' : ''}${isOvertime ? ' [非正常时段]' : ''}">${star}${name}</div>`;
        }
      }
    }

    return `<div style="width:${CELL_W}px;height:${CELL_H}px;background:${cellBg};border-radius:6px;${borderStyle}position:relative;overflow:hidden;padding:4px 6px">
      <div style="display:flex;align-items:center;margin-bottom:2px">
        <span style="font-size:11px;font-weight:800;color:${isToday ? c.todayText : c.dayNumText}">${day}</span>
        ${badgesHtml}
      </div>
      ${barsHtml}
    </div>`;
  }

  let gridHtml = '';
  for (let row = 0; row < dayRows; row++) {
    gridHtml += '<div style="display:flex;gap:4px;margin-bottom:4px">';
    for (let col = 0; col < 7; col++) {
      const idx = row * 7 + col;
      const day = idx < dates.length ? dates[idx] : null;
      gridHtml += renderDayCell(day);
    }
    gridHtml += '</div>';
  }

  const HEADER_H = 36;
  const totalW = PAD * 2 + CELL_W * 7 + GAP * 6;

  return {
    html: `<div>
      <div style="text-align:center;font-size:20px;font-weight:600;margin-bottom:16px;color:${c.text}">${year}年${month + 1}月</div>
      <div style="display:flex;gap:4px;margin-bottom:4px">
        ${['周一','周二','周三','周四','周五','周六','周日'].map(d =>
          `<div style="width:${CELL_W}px;text-align:center;font-size:12px;padding:8px 0;background:${c.headerBg};border-radius:6px;color:${c.headerText}">${d}</div>`).join('')}
      </div>
      ${gridHtml}
    </div>`,
    bg: c.bg,
    totalW,
  };
}

// ── Public API ────────────────────────────────────────────────────
export async function generateMonthlyImage(schedulesWithClasses, year, month, { theme = 'auto', dbHolidays = [], endYear, endMonth } = {}) {
  const todayStr = toLocalDateStr(new Date());

  // Build DB holiday overrides (shared across all months)
  const dbHolidayMap = {};
  const dbWorkdaySet = new Set();
  for (const h of dbHolidays) {
    if (h.type === 'holiday') dbHolidayMap[h.date] = h.name || '';
    else if (h.type === 'workday') dbWorkdaySet.add(h.date);
  }
  const hasDbData = dbHolidays.length > 0;

  const ey = endYear != null ? endYear : year;
  const em = endMonth != null ? endMonth : month;
  const monthList = buildMonthList(year, month, ey, em);

  const shared = { theme, dbHolidayMap, dbWorkdaySet, hasDbData, todayStr };

  // Build combined HTML
  let combinedHtml = '';
  let bg = '#f9fafb';
  let maxW = 0;
  for (let i = 0; i < monthList.length; i++) {
    const m = monthList[i];
    // Filter schedules for this month
    const prefix = `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
    const monthScheds = schedulesWithClasses.filter(s => s.date.startsWith(prefix));
    const result = renderMonthHtml(monthScheds, m.year, m.month, shared);
    combinedHtml += i > 0
      ? result.html.replace('<div>', '<div style="margin-top:24px">')
      : result.html;
    bg = result.bg;
    maxW = Math.max(maxW, result.totalW);
  }

  const PAD = 10;
  const totalW = maxW;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 0; height: auto; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: ${bg}; padding: ${PAD}px; -webkit-font-smoothing: antialiased; }
</style></head><body>
  ${combinedHtml}
</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.setViewport({ width: totalW + 4, height: 800, deviceScaleFactor: 4 });
    const clipRect = await page.evaluate(() => {
      const r = document.documentElement.getBoundingClientRect();
      return { x: 0, y: 0, w: r.width, h: r.height };
    });
    const buffer = await page.screenshot({
      type: 'png', timeout: 30000,
      clip: { x: 0, y: 0, width: totalW, height: clipRect.h },
    });
    return buffer;
  } finally {
    await page.close();
  }
}
