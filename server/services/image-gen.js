import { getBrowser } from './browser.js';
import { isHoliday, isWorkday, getHolidayName } from './holidays.js';

// ── Color system — mirrors frontend src/utils/colors.js ──────────
const SUBJECT_HUES = {
  '数学': { h: 210, s: 79 },
  '物理': { h: 122, s: 50 },
  '英语': { h: 45, s: 93 },
  '化学': { h: 280, s: 62 },
  '语文': { h: 0, s: 68 },
  '生物': { h: 187, s: 100 },
  '历史': { h: 20, s: 35 },
  '地理': { h: 200, s: 20 },
  '政治': { h: 25, s: 100 },
};

const GRADE_LIGHTNESS = {
  '初一': 70, '初二': 64, '初三': 58,
  '高一': 52, '高二': 46, '高三': 42, '大学': 38,
};

function mappedLightness(baseL, dark) {
  const t = (baseL - 38) / 32;
  return dark ? 35 + t * 23 : 33 + t * 45;
}

function satMod(baseL, dark) {
  const t = (baseL - 38) / 32;
  return dark ? 0.45 + t * 0.15 : 0.85 + t * 0.15;
}

function getColor(cls, dark) {
  const hue = SUBJECT_HUES[cls.subject] || { h: 0, s: 0 };
  const baseL = GRADE_LIGHTNESS[cls.grade] ?? 50;
  const l = mappedLightness(baseL, dark);
  const s = Math.round(hue.s * satMod(baseL, dark));
  return `hsl(${hue.h}, ${s}%, ${Math.round(l)}%)`;
}

function getTextColor(cls, dark) {
  if (dark) return 'rgba(255,255,255,0.92)';
  const baseL = GRADE_LIGHTNESS[cls.grade] ?? 50;
  return mappedLightness(baseL, false) < 55 ? '#ffffff' : '#1a1a1a';
}

// ── Schedule helpers ─────────────────────────────────────────────
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function getDateRange(startDateStr, endDateStr) {
  const dates = [];
  const d = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');
  while (d <= end) {
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function findConflictGroups(schedules) {
  if (!schedules.length) return [];
  const sorted = [...schedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const endMin = (s) => {
    const e = toMin(s.endTime), st = toMin(s.startTime);
    return e >= st ? e : e + 24 * 60;
  };
  const groups = [];
  let group = [sorted[0]];
  let groupEnd = endMin(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (toMin(s.startTime) < groupEnd) {
      group.push(s);
      groupEnd = Math.max(groupEnd, endMin(s));
    } else {
      groups.push(group);
      group = [s];
      groupEnd = endMin(s);
    }
  }
  groups.push(group);
  return groups;
}

function assignColumns(group) {
  const sorted = [...group].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const colEnds = [];
  return sorted.map(s => {
    const start = toMin(s.startTime);
    let col = colEnds.findIndex(end => end <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(0); }
    colEnds[col] = toMin(s.endTime);
    return { ...s, _col: col };
  });
}

// ── Image generation ─────────────────────────────────────────────
export async function generateScheduleImage(schedulesWithClasses, startDate, endDate, { theme = 'auto', rowH = 30, scale, highlight, dbHolidays = [] } = {}) {
  const dates = getDateRange(startDate, endDate);
  const numDays = dates.length;
  const todayStr = localDateStr(new Date());

  // Build lookup from DB holidays (teacher-defined), fall back to built-in
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

  const byDate = {};
  dates.forEach(d => byDate[d] = []);
  schedulesWithClasses.forEach(s => {
    if (byDate[s.date]) byDate[s.date].push(s);
  });

  const DEFAULT_START = 7;
  const DEFAULT_END = 22;
  const BOTTOM_OFFSET_MIN = 30;

  let startHour = DEFAULT_START;
  let latestEndMin = DEFAULT_END * 60;
  schedulesWithClasses.forEach(s => {
    const sh = parseInt(s.startTime.split(':')[0]);
    if (sh < startHour) startHour = sh;
    const eMin = toMin(s.endTime);
    const sMin = toMin(s.startTime);
    const actualEnd = eMin < sMin ? eMin + 24 * 60 : eMin;
    if (actualEnd > latestEndMin) latestEndMin = actualEnd;
  });
  startHour = Math.max(0, Math.min(startHour, DEFAULT_START));
  const minBottom = DEFAULT_END * 60 + BOTTOM_OFFSET_MIN;
  const bottomMin = latestEndMin > minBottom ? latestEndMin + BOTTOM_OFFSET_MIN : minBottom;
  const endHour = Math.max(DEFAULT_END, Math.floor(bottomMin / 60));
  const rowHSafe = Math.max(16, Math.min(60, +rowH || 40));
  const TOP_GAP = Math.round(5 / 60 * rowHSafe);
  const firstLabelHour = startHour + 1;
  const numHours = endHour - firstLabelHour + 1;
  const totalH = TOP_GAP + numHours * rowHSafe;
  const timeColW = 64;
  const TARGET_TOTAL_WIDTH = Math.min(1800, Math.max(600, numDays * 160));
  const colW = Math.max(80, Math.floor((TARGET_TOTAL_WIDTH - timeColW) / numDays));
  const totalW = timeColW + numDays * colW;
  const HEADER_H = 52;

  const hour = new Date().getHours();
  const isDark = theme === 'dark' ? true : theme === 'light' ? false : (hour < 7 || hour >= 19);

  const c = isDark ? {
    bg: '#111827', text: '#f3f4f6', headerBg: '#1f2937',
    headerText: '#e5e7eb', gridBorder: '#374151', gridLight: '#1f2937',
    timeText: '#6b7280', todayBg: 'rgba(30,58,138,0.25)', todayHeader: 'rgba(30,64,175,0.3)',
    todayText: '#93c5fd', todayBadge: '#3b82f6',
    holidayHeader: 'rgba(127,29,29,0.2)', workdayHeader: 'rgba(120,53,15,0.2)',
  } : {
    bg: '#f9fafb', text: '#111827', headerBg: '#f9fafb',
    headerText: '#111827', gridBorder: '#d1d5db', gridLight: '#f3f4f6',
    timeText: '#6b7280', todayBg: 'rgba(219,234,254,0.6)', todayHeader: 'rgba(239,246,255,0.8)',
    todayText: '#1d4ed8', todayBadge: '#3b82f6',
    holidayHeader: 'rgba(254,242,242,0.8)', workdayHeader: 'rgba(255,247,237,0.8)',
  };

  // ── Header row ─────────────────────────────────────────────────
  let headerHtml = `<div style="display:flex;border-bottom:2px solid ${c.gridBorder}">
    <div style="width:${timeColW}px;height:${HEADER_H}px;padding:6px;background:${isDark ? '#1f2937' : '#f3f4f6'};text-align:center;font-size:12px;color:${c.headerText};display:flex;align-items:center;justify-content:center;border-right:1px solid ${c.gridBorder}">时间</div>`;
  dates.forEach(date => {
    const d = new Date(date + 'T00:00:00');
    const wd = WEEKDAY_LABELS[d.getDay()];
    const isToday = date === todayStr;
    const holiday = checkIsHoliday(date);
    const workday = checkIsWorkday(date);
    let bg;
    if (isToday) bg = c.todayHeader;
    else if (workday) bg = c.workdayHeader;
    else if (holiday) bg = c.holidayHeader;
    else bg = c.headerBg;
    headerHtml += `<div style="width:${colW}px;height:${HEADER_H}px;padding:6px;background:${bg};text-align:center;border-right:1px solid ${c.gridBorder};display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div style="display:flex;align-items:center;gap:4px">
        <span style="font-size:13px;font-weight:${isToday ? 600 : 400};color:${isToday ? c.todayText : c.text}">${wd}</span>
        ${isToday ? `<span style="font-size:10px;background:${c.todayBadge};color:#fff;padding:2px 6px;border-radius:9999px;font-weight:500">今天</span>` : ''}
        ${holiday ? `<span style="font-size:10px;background:#ef4444;color:#fff;padding:2px 6px;border-radius:9999px;font-weight:500">${escapeHtml(checkHolidayName(date))}</span>` : ''}
        ${workday ? `<span style="font-size:10px;background:#f97316;color:#fff;padding:2px 6px;border-radius:9999px;font-weight:500">调休</span>` : ''}
      </div>
      <span style="font-size:11px;color:${c.timeText}">${date.slice(5)}</span>
    </div>`;
  });
  headerHtml += '</div>';

  // ── Grid lines & labels (08:00–23:00) ──────────────────────────
  let gridHtml = '';
  for (let h = firstLabelHour; h <= endHour; h++) {
    const top = TOP_GAP + (h - firstLabelHour) * rowHSafe;
    gridHtml += `<div style="position:absolute;top:${top}px;left:0;width:${totalW}px;height:1px;background:${c.gridBorder}"></div>`;
    gridHtml += `<div style="position:absolute;top:${top}px;left:0;width:${timeColW}px;pointer-events:none">`;
    gridHtml +=   `<span style="position:absolute;top:-7px;left:50%;transform:translateX(-50%);font-size:11px;color:${c.timeText};background:${c.bg};padding:0 4px;white-space:nowrap">${String(h).padStart(2, '0')}:00</span>`;
    gridHtml += `</div>`;
  }
  for (let i = 1; i < numDays; i++) {
    const left = timeColW + i * colW;
    gridHtml += `<div style="position:absolute;top:0;left:${left}px;width:1px;height:${totalH}px;background:${c.gridBorder}"></div>`;
  }

  // ── Today column highlight ──────────────────────────────────────
  const todayIdx = dates.indexOf(todayStr);
  if (todayIdx >= 0) {
    const left = timeColW + todayIdx * colW;
    gridHtml += `<div style="position:absolute;top:0;left:${left}px;width:${colW}px;height:${totalH}px;background:${c.todayBg};pointer-events:none"></div>`;
  }

  // ── Highlight column ─────────────────────────────────────────────
  if (highlight && dates.includes(highlight)) {
    const hlIdx = dates.indexOf(highlight);
    const left = timeColW + hlIdx * colW;
    gridHtml += `<div style="position:absolute;top:0;left:${left}px;width:${colW}px;height:${totalH}px;border:3px solid #f59e0b;box-shadow:inset 0 0 12px rgba(245,158,11,0.15);pointer-events:none;z-index:5;border-radius:2px"></div>`;
  }

  // ── Schedule blocks ────────────────────────────────────────────
  let blocksHtml = '';
  dates.forEach((date, di) => {
    const daySchedules = byDate[date] || [];
    const groups = findConflictGroups(daySchedules);
    groups.forEach(group => {
      const hasConflict = group.length > 1;
      const items = assignColumns(group);
      const totalCols = Math.max(...items.map(it => it._col)) + 1;
      items.forEach(item => {
        const startMin = toMin(item.startTime);
        const endMin = toMin(item.endTime);
        const durMin = endMin > startMin ? endMin - startMin : endMin + 24 * 60 - startMin;
        const top = TOP_GAP + (startMin - firstLabelHour * 60) / 60 * rowHSafe;
        const h = Math.max(durMin / 60 * rowHSafe - 2, rowHSafe - 2);
        const clippedTop = Math.max(0, top);
        const clippedH = Math.min(h, totalH - clippedTop);
        const itemColW = colW / totalCols;
        const left = timeColW + di * colW + item._col * itemColW + 1;
        const width = itemColW - 2;
        const bg = hasConflict ? '#ef4444' : getColor(item.class, isDark);
        const fg = hasConflict ? '#ffffff' : getTextColor(item.class, isDark);

        // Adaptive font — mirrors ScheduleBlock.jsx
        const wp = totalCols > 2 ? 2 : totalCols > 1 ? 1 : 0;
        const isShort = clippedH < 1.5 * rowHSafe;
        const fs = isShort
          ? Math.max(9, Math.min(12, Math.floor(clippedH * 0.7)) - wp)
          : Math.max(10, Math.min(13, Math.floor(clippedH / 3)) - wp);
        const lh = fs * 1.3;
        const maxNameLines = isShort ? 1 : Math.max(1, Math.floor((clippedH - lh * 2) / lh));

        const name = escapeHtml(item.class.name);
        const safeLoc = item.locationName ? escapeHtml(item.locationName) : '';
        const nameStyle = isShort
          ? 'font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
          : `font-weight:bold;overflow:hidden;display:-webkit-box;-webkit-line-clamp:${maxNameLines};-webkit-box-orient:vertical;word-break:break-word`;
        const timeFs = Math.max(7, fs - 1);
        const locFs = Math.max(7, fs - 3);

        const starHtml = item.class.isCompetition ? '<span style="color:#f59e0b">★ </span>' : '';
        blocksHtml += `<div style="position:absolute;top:${clippedTop}px;left:${left}px;width:${width}px;height:${clippedH}px;background:${bg};color:${fg};border-radius:6px;box-shadow:${hasConflict ? '0 0 0 2px #ef4444' : 'none'};overflow:hidden;z-index:10;${isShort ? `display:flex;align-items:center;gap:4px;padding:0 6px` : 'padding:4px'}">
          ${isShort
            ? `<div style="font-size:${fs}px;line-height:1.25;${nameStyle};flex:1;min-width:0">${starHtml}${name}</div><div style="font-size:${timeFs}px;opacity:0.6;white-space:nowrap;flex-shrink:0">${item.startTime}-${item.endTime}</div>`
            : `<div style="font-size:${fs}px;line-height:${lh}px;${nameStyle}">${starHtml}${name}</div><div style="font-size:${timeFs}px;line-height:${lh}px;opacity:0.65">${item.startTime}-${item.endTime}</div>${safeLoc ? `<div style="font-size:${locFs}px;opacity:0.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📍${safeLoc}</div>` : ''}`
          }
        </div>`;
      });
    });
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: ${c.bg}; color: ${c.text}; padding: 16px; }
  h1 { text-align: center; font-size: 15px; margin-bottom: 12px; font-weight: 600; }
</style></head><body>
  <h1>${startDate} ~ ${endDate}</h1>
  ${headerHtml}
  <div style="position:relative;width:${totalW}px;height:${totalH}px">
    ${gridHtml}
    ${blocksHtml}
  </div>
</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const scaleFactor = scale ? Math.max(0.25, Math.min(3, +scale)) : 2;
    await page.setViewport({ width: totalW + 32, height: totalH + HEADER_H + 100, deviceScaleFactor: scaleFactor });
    const buffer = await page.screenshot({ type: 'png', fullPage: true, timeout: 30000 });
    return buffer;
  } finally {
    await page.close();
  }
}
