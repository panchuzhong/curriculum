import { getBrowser } from './browser.js';
import { getCategoryColor } from './colors.js';

// ── Category logic — mirrors frontend YearlySchedule ──────────────
function getCategory(cls) {
  if (!cls) return '未知';
  const s = cls.subject || '未知';
  const g = cls.grade || '';
  const level = ['初一','初二','初三'].includes(g) ? '初中'
    : ['高一','高二','高三'].includes(g) ? '高中'
    : g === '大学' ? '大学' : '';
  const prefix = cls.isCompetition ? `${level}竞赛` : level;
  return prefix ? `${prefix}${s}` : s;
}

function getGradeLevel(cat) {
  const match = cat.match(/^(初中竞赛|高中竞赛|初中|高中|大学)/);
  return match ? match[1] : '其他';
}

function groupByGrade(entries) {
  const grouped = {};
  entries.forEach(([cat, h]) => {
    const level = getGradeLevel(cat);
    if (!grouped[level]) grouped[level] = { hours: 0, dominantCat: cat, dominantH: 0 };
    grouped[level].hours += h;
    if (h > grouped[level].dominantH) {
      grouped[level].dominantH = h;
      grouped[level].dominantCat = cat;
    }
  });
  return Object.entries(grouped)
    .map(([level, d]) => [level, d.hours, d.dominantCat])
    .sort((a, b) => b[1] - a[1]);
}

function resolveColor(label, dominantCategory, dark) {
  return getCategoryColor(label, dark) || getCategoryColor(dominantCategory, dark) || 'hsl(0,0%,50%)';
}

function toHoursAbs(durationBilling) {
  if (durationBilling != null) return +durationBilling / 60;
  return 0;
}

const COLLAPSE_LIMIT = 9;

// ── Build year list from range ────────────────────────────────────
function buildYearList(startYear, endYear) {
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  return years;
}

// ── Generate HTML for one year ────────────────────────────────────
function renderYearHtml(schedulesWithClasses, year, { theme }) {
  const hour = new Date().getHours();
  const isDark = theme === 'dark' ? true : theme === 'light' ? false : (hour < 7 || hour >= 19);

  const c = isDark ? {
    bg: '#111827', text: '#f3f4f6',
    cardBg: '#1f2937', mutedText: '#6b7280', accent: '#3b82f6',
    barBg: '#374151', barEmpty: '#374151',
  } : {
    bg: '#f9fafb', text: '#111827',
    cardBg: '#f3f4f6', mutedText: '#9ca3af', accent: '#2563eb',
    barBg: '#e5e7eb', barEmpty: '#e5e7eb',
  };

  const byMonth = {};
  for (let m = 0; m < 12; m++) byMonth[m] = { dates: new Set(), schedules: [] };
  schedulesWithClasses.forEach(s => {
    const m = parseInt(s.date.split('-')[1]) - 1;
    byMonth[m].dates.add(s.date);
    byMonth[m].schedules.push(s);
  });

  // Year-level stats
  const yearByCategory = {};
  let yearTotalHours = 0;
  const yearDates = new Set();
  schedulesWithClasses.forEach(s => {
    const cat = getCategory(s.class);
    if (!yearByCategory[cat]) yearByCategory[cat] = 0;
    const h = toHoursAbs(s.durationBilling);
    yearByCategory[cat] += h;
    yearTotalHours += h;
    yearDates.add(s.date);
  });
  const yearCategoryEntries = Object.entries(yearByCategory).sort((a, b) => b[1] - a[1]);
  const yearCondensed = yearCategoryEntries.length > COLLAPSE_LIMIT;
  const yearDisplayEntries = yearCondensed ? groupByGrade(yearCategoryEntries) : yearCategoryEntries;
  const yearMaxHours = yearDisplayEntries.length > 0 ? yearDisplayEntries[0][1] : 1;

  function renderMonthCard(m) {
    const data = byMonth[m] || { dates: new Set(), schedules: [] };
    const totalHours = data.schedules.reduce((sum, s) => sum + toHoursAbs(s.durationBilling), 0);

    if (totalHours === 0) {
      return `<div style="background:${c.cardBg};border-radius:8px;padding:12px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:15px;font-weight:bold">${m + 1}月</span>
        <span style="font-size:12px;color:${c.mutedText}">无排课</span>
      </div>`;
    }

    const byCategory = {};
    data.schedules.forEach(s => {
      const cat = getCategory(s.class);
      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat] += toHoursAbs(s.durationBilling);
    });
    const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    const condensed = categoryEntries.length > COLLAPSE_LIMIT;
    const displayEntries = condensed ? groupByGrade(categoryEntries) : categoryEntries;

    let chipsHtml = displayEntries.map(entry => {
      const [label, h, dominantCat] = condensed ? entry : [entry[0], entry[1]];
      const color = resolveColor(label, dominantCat, isDark);
      return `<span style="display:inline-flex;align-items:center;padding:2px 6px;border-radius:4px;background:${color};color:#fff;font-size:10px;margin-right:4px;margin-bottom:3px">${label} ${h.toFixed(1)}h</span>`;
    }).join('');

    let barHtml = displayEntries.map(entry => {
      const [label, h, dominantCat] = condensed ? entry : [entry[0], entry[1]];
      const color = resolveColor(label, dominantCat, isDark);
      return `<div style="height:100%;width:${(h / totalHours) * 100}%;background:${color};border-radius:3px" title="${label}"></div>`;
    }).join('');

    return `<div style="background:${c.cardBg};border-radius:8px;padding:12px;display:flex;flex-direction:column;justify-content:space-between">
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:15px;font-weight:bold">${m + 1}月</span>
          <span style="font-size:11px;color:${c.mutedText}">${data.dates.size}天 · ${data.schedules.length}次</span>
          <span style="font-size:13px;font-weight:600;color:${c.accent}">${totalHours.toFixed(1)}h</span>
        </div>
        <div style="margin-bottom:6px;line-height:1.8">${chipsHtml}</div>
      </div>
      <div style="height:8px;background:${c.barEmpty};border-radius:4px;overflow:hidden;display:flex">${barHtml}</div>
    </div>`;
  }

  const monthCardsHtml = Array.from({ length: 12 }, (_, m) => renderMonthCard(m)).join('');

  let summaryHtml = '';
  if (yearTotalHours > 0) {
    const barsHtml = yearDisplayEntries.map(entry => {
      const [label, h, dominantCat] = yearCondensed ? entry : [entry[0], entry[1]];
      const color = resolveColor(label, dominantCat, isDark);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
        <span style="width:80px;text-align:right;font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${label}</span>
        <div style="flex:1;height:14px;background:${c.barBg};border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${(h / yearMaxHours) * 100}%;background:${color};border-radius:4px"></div>
        </div>
        <span style="width:48px;text-align:right;font-size:11px;font-weight:600">${h.toFixed(1)}h</span>
      </div>`;
    }).join('');

    summaryHtml = `<div style="background:${c.cardBg};border-radius:8px;padding:12px;margin-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:14px;font-weight:bold">${year} 年度统计</span>
        <span style="font-size:11px;color:${c.mutedText}">${yearTotalHours.toFixed(1)}h · ${yearDates.size}天 · ${schedulesWithClasses.length}次</span>
      </div>
      ${barsHtml}
    </div>`;
  }

  const CARD_W = 280;
  const GAP = 8;
  const PAD = 20;
  const totalW = PAD * 2 + CARD_W * 3 + GAP * 2;

  return {
    html: `<div>
      <div style="text-align:center;font-size:22px;font-weight:600;margin-bottom:16px;color:${c.text}">${year}年</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${monthCardsHtml}</div>
      ${summaryHtml}
    </div>`,
    bg: c.bg,
    totalW,
  };
}

// ── Public API ────────────────────────────────────────────────────
export async function generateYearlyImage(schedulesWithClasses, year, { theme = 'auto', endYear } = {}) {
  const ey = endYear != null ? endYear : year;
  const yearList = buildYearList(year, ey);

  let combinedHtml = '';
  let bg = '#f9fafb';
  let maxW = 0;
  for (let i = 0; i < yearList.length; i++) {
    const yr = yearList[i];
    const yearScheds = schedulesWithClasses.filter(s => s.date.startsWith(`${yr}-`));
    const result = renderYearHtml(yearScheds, yr, { theme });
    combinedHtml += i > 0
      ? result.html.replace('<div>', '<div style="margin-top:24px">')
      : result.html;
    bg = result.bg;
    maxW = Math.max(maxW, result.totalW);
  }

  const PAD = 20;
  const totalW = maxW + PAD * 2;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 0; height: auto; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: ${bg}; padding: ${PAD}px; }
</style></head><body>
  ${combinedHtml}
</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.setViewport({ width: totalW + 32, height: 800, deviceScaleFactor: 2 });
    const bodyBox = await page.evaluate(() => {
      const r = document.body.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const buffer = await page.screenshot({
      type: 'png', timeout: 30000,
      clip: { x: bodyBox.x, y: bodyBox.y, width: bodyBox.w, height: bodyBox.h },
    });
    return buffer;
  } finally {
    await page.close();
  }
}
