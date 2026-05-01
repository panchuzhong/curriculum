import puppeteer from 'puppeteer';

const SUBJECT_COLORS = {
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
  '初一': 75, '初二': 68, '初三': 60,
  '高一': 52, '高二': 44, '高三': 36, '大学': 28,
};

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getColor(cls) {
  const sc = SUBJECT_COLORS[cls.subject] || { h: 0, s: 0 };
  const l = GRADE_LIGHTNESS[cls.grade] ?? 50;
  return `hsl(${sc.h}, ${sc.s}%, ${l}%)`;
}

function getTextColor(cls) {
  const l = GRADE_LIGHTNESS[cls.grade] ?? 50;
  return l < 55 ? '#ffffff' : '#1a1a1a';
}

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

function findConflictGroups(schedules) {
  if (!schedules.length) return [];
  const sorted = [...schedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const groups = [];
  let group = [sorted[0]];
  let groupEnd = toMin(sorted[0].endTime);
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (toMin(s.startTime) < groupEnd) {
      group.push(s);
      groupEnd = Math.max(groupEnd, toMin(s.endTime));
    } else {
      groups.push(group);
      group = [s];
      groupEnd = toMin(s.endTime);
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

export async function generateScheduleImage(schedulesWithClasses, startDate, endDate, { theme = 'auto', rowH = 30 } = {}) {
  const dates = getDateRange(startDate, endDate);
  const numDays = dates.length;

  const byDate = {};
  dates.forEach(d => byDate[d] = []);
  schedulesWithClasses.forEach(s => {
    if (byDate[s.date]) byDate[s.date].push(s);
  });

  const startHour = 7;
  const endHour = 23;
  const rowHSafe = Math.max(16, Math.min(60, +rowH || 30));
  const scale = rowHSafe / 30;
  // Match frontend: 15-min blank gap before first label (7:45–8:00)
  const TOP_GAP = Math.round(0.25 * rowHSafe);
  const firstLabelHour = startHour + 1; // 8
  const totalH = TOP_GAP + (endHour - firstLabelHour + 1) * rowHSafe;
  const timeColW = Math.round(50 * scale);
  const colW = Math.round(160 * scale);
  const totalW = timeColW + numDays * colW;

  const hour = new Date().getHours();
  const isDark = theme === 'dark' ? true : theme === 'light' ? false : (hour < 6 || hour >= 18);

  const c = isDark ? {
    bg: '#1a1a2e', text: '#e0e0e0', headerBg: '#16213e',
    gridBorder: '#333', timeText: '#888',
  } : {
    bg: '#ffffff', text: '#1a1a1a', headerBg: '#e5e7eb',
    gridBorder: '#d1d5db', timeText: '#6b7280',
  };

  // Build schedule blocks
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
        const height = Math.max(durMin / 60 * rowHSafe - 2, rowHSafe - 2);
        const itemColW = colW / totalCols;
        const left = timeColW + di * colW + item._col * itemColW + 1;
        const width = itemColW - 3;
        const bg = hasConflict ? '#dc2626' : getColor(item.class);
        const fg = hasConflict ? '#ffffff' : getTextColor(item.class);
        const border = hasConflict ? '2px solid #ff4444' : 'none';
        blocksHtml += `<div style="position:absolute;top:${top}px;left:${left}px;width:${width}px;height:${height}px;background:${bg};color:${fg};border:${border};border-radius:3px;padding:2px 4px;font-size:${Math.round(10*scale)}px;overflow:hidden;box-sizing:border-box;z-index:10;line-height:1.3">
          <div style="font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.class.isCompetition ? '★ ' : ''}${item.class.name}</div>
          <div style="opacity:0.8">${item.startTime}-${item.endTime}</div>
          ${item.locationName ? `<div style="opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📍${item.locationName}</div>` : ''}
        </div>`;
      });
    });
  });

  // Grid lines — labels 08:00–23:00 positioned AT the grid line (matching frontend)
  let gridHtml = '';
  for (let h = firstLabelHour; h <= endHour; h++) {
    const top = TOP_GAP + (h - firstLabelHour) * rowHSafe;
    gridHtml += `<div style="position:absolute;top:${top}px;left:${timeColW}px;width:${numDays * colW}px;height:1px;background:${c.gridBorder}"></div>`;
    gridHtml += `<div style="position:absolute;top:${top}px;left:0;width:${timeColW}px;font-size:${Math.round(11*scale)}px;color:${c.timeText};text-align:center;transform:translateY(-50%)">${String(h).padStart(2, '0')}:00</div>`;
  }
  for (let i = 1; i < numDays; i++) {
    const left = timeColW + i * colW;
    gridHtml += `<div style="position:absolute;top:0;left:${left}px;width:1px;height:${totalH}px;background:${c.gridBorder}"></div>`;
  }

  // Header
  let headerHtml = `<div style="display:flex;border-bottom:2px solid ${c.gridBorder}">
    <div style="width:${timeColW}px;padding:6px;background:${c.headerBg};text-align:center;font-size:${Math.round(12*scale)}px;color:${c.text};border:1px solid ${c.gridBorder}">时间</div>`;
  dates.forEach(date => {
    const d = new Date(date + 'T00:00:00');
    const wd = WEEKDAY_LABELS[d.getDay()];
    headerHtml += `<div style="width:${colW}px;padding:6px;background:${c.headerBg};text-align:center;font-size:${Math.round(12*scale)}px;border:1px solid ${c.gridBorder};color:${c.text}">${wd}<br><span style="font-size:${Math.round(10*scale)}px;opacity:0.7">${date.slice(5)}</span></div>`;
  });
  headerHtml += '</div>';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: sans-serif; background: ${c.bg}; color: ${c.text}; padding: 16px; }
  h1 { text-align: center; font-size: 16px; margin-bottom: 12px; }
</style></head><body>
  <h1>${startDate} ~ ${endDate}</h1>
  ${headerHtml}
  <div style="position:relative;width:${totalW}px;height:${totalH}px">
    ${gridHtml}
    ${blocksHtml}
  </div>
</body></html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--single-process',
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.setViewport({ width: totalW + 32, height: totalH + 100, deviceScaleFactor: 2 });
  const buffer = await page.screenshot({ type: 'png', fullPage: true });
  await browser.close();
  return buffer;
}
