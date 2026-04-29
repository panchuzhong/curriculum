import puppeteer from 'puppeteer';

const SUBJECT_COLORS = {
  '数学': { h: 210, s: 79, baseL: 44 },
  '物理': { h: 122, s: 50, baseL: 33 },
  '英语': { h: 45, s: 93, baseL: 55 },
  '化学': { h: 280, s: 62, baseL: 27 },
  '语文': { h: 0, s: 68, baseL: 38 },
  '生物': { h: 187, s: 100, baseL: 28 },
  '历史': { h: 20, s: 35, baseL: 40 },
  '地理': { h: 200, s: 20, baseL: 25 },
  '政治': { h: 25, s: 100, baseL: 45 },
};

const GRADE_LIGHTNESS = {
  '初一': 75, '初二': 68, '初三': 60,
  '高一': 52, '高二': 44, '高三': 36, '大学': 28,
};

function getColor(cls) {
  const sc = SUBJECT_COLORS[cls.subject] || { h: 0, s: 0, baseL: 50 };
  const l = GRADE_LIGHTNESS[cls.grade] ?? 50;
  return `hsl(${sc.h}, ${sc.s}%, ${l}%)`;
}

function getDateForWeekday(startDateStr, targetDay) {
  // targetDay: 1=Mon..5=Fri
  const start = new Date(startDateStr + 'T00:00:00');
  const startDay = start.getDay() || 7; // 1=Mon..7=Sun
  const diff = targetDay - startDay;
  const d = new Date(start);
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function generateScheduleImage(schedulesWithClasses, startDate, endDate) {
  // Group by date
  const byDate = {};
  for (const s of schedulesWithClasses) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  // Find time range
  let minHour = 22, maxHour = 0;
  for (const s of schedulesWithClasses) {
    const sh = parseInt(s.startTime.split(':')[0]);
    const eh = parseInt(s.endTime.split(':')[0]) + (parseInt(s.endTime.split(':')[1]) > 0 ? 1 : 0);
    if (sh < minHour) minHour = sh;
    if (eh > maxHour) maxHour = eh;
  }
  if (minHour >= maxHour) { minHour = 8; maxHour = 22; }

  const hours = [];
  for (let h = minHour; h <= maxHour; h++) hours.push(h);

  const weekdays = ['周一', '周二', '周三', '周四', '周五'];

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  body { font-family: sans-serif; margin: 20px; background: #1a1a2e; color: #e0e0e0; }
  h1 { text-align: center; font-size: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #333; padding: 2px; }
  th { background: #16213e; padding: 8px; }
  .time { width: 60px; color: #888; font-size: 12px; text-align: center; }
  .course { border-radius: 4px; padding: 4px 6px; font-size: 11px; color: white; margin-bottom: 2px; }
  .conflict { border: 3px solid #ff0000 !important; }
  .legend { margin-top: 12px; font-size: 12px; }
  .legend span { margin-right: 12px; }
</style></head><body>
  <h1>${startDate} ~ ${endDate}</h1>
  <table>
    <thead><tr><th class="time">时间</th>
      ${weekdays.map(d => `<th>${d}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${hours.map(h => `<tr>
        <td class="time">${String(h).padStart(2,'0')}:00</td>
        ${[1,2,3,4,5].map(day => {
          const dateStr = getDateForWeekday(startDate, day);
          const daySchedules = (byDate[dateStr] || []).filter(s => {
            const sh = parseInt(s.startTime.split(':')[0]);
            const eh = parseInt(s.endTime.split(':')[0]) + (parseInt(s.endTime.split(':')[1]) > 0 ? 1 : 0);
            return sh <= h && eh > h;
          });
          if (daySchedules.length === 0) return '<td></td>';
          const hasConflict = daySchedules.length > 1;
          return `<td style="vertical-align:top;padding:2px">
            ${daySchedules.map(s => `<div class="course ${hasConflict ? 'conflict' : ''}" style="background:${getColor(s.class)}">
              ${s.class.isCompetition ? '★ ' : ''}${s.class.name}<br>
              <span style="opacity:0.7">${s.startTime}-${s.endTime}</span>
            </div>`).join('')}
          </td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="legend">
    ${Object.entries(SUBJECT_COLORS).map(([name, c]) =>
      `<span><span style="display:inline-block;width:12px;height:12px;background:hsl(${c.h},${c.s}%,45%);border-radius:2px;vertical-align:middle"></span> ${name}</span>`
    ).join('')}
    <span>★ 竞赛课</span>
  </div>
</body></html>`;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.setViewport({ width: 1200, height: 800 });
  const buffer = await page.screenshot({ type: 'png', fullPage: true });
  await browser.close();
  return buffer;
}
