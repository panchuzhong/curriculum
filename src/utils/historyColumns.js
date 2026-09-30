import { WEEKDAYS } from './constants';
import { parseDateStr, toHours } from './date';

// 班级「排课历史」表格里可以关掉的几项：日期带不带年份、星期/时长/地点三列显示不显示。
// 默认全开，也就是加这个功能之前的样子。「时间」一列和日期本身始终显示。
export const DEFAULT_HISTORY_COLUMNS = Object.freeze({ year: true, weekday: true, duration: true, location: true });

export const HISTORY_COLUMNS_KEY = 'scheduleHistory.columns';

// localStorage 里读出来的东西不可信：可能是旧版本写的、被手改过的，或者压根不是 JSON。
// 读和写共用这一份「存的东西是什么形状」的判断，免得以后修了一处、另一处对「存坏了」
// 的定义悄悄分叉。
function readSavedColumns(raw) {
  let saved;
  try { saved = JSON.parse(raw); } catch { return null; }
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : null;
}

// 认得的键只收布尔值，其余一律回到默认——宁可多显示一列，也不要因为一个坏值把用户
// 要复制的那一列悄悄藏掉（"false" 这个字符串是真值，0 是假值，照搬都会错）。
export function parseHistoryColumns(raw) {
  const cols = { ...DEFAULT_HISTORY_COLUMNS };
  const saved = readSavedColumns(raw);
  if (!saved) return cols;
  for (const key of Object.keys(cols)) {
    if (typeof saved[key] === 'boolean') cols[key] = saved[key];
  }
  return cols;
}

// WEEKDAYS 从周一起算，getDay() 从周日起算。
function weekdayOf(dateStr) {
  return WEEKDAYS[(parseDateStr(dateStr).getDay() + 6) % 7];
}

// 表格要显示的列，按 cols 取舍、按顺序排好。表格渲染和「复制」按钮都从这里取：
// 按钮复制出去的就是屏幕上那几列、那种写法——各写一遍迟早对不上。
export function historyTableColumns(cols) {
  return [
    { key: 'date', label: '日期', value: s => (cols.year ? s.date : s.date.slice(5)) },
    cols.weekday && { key: 'weekday', label: '星期', value: s => weekdayOf(s.date) },
    { key: 'time', label: '时间', value: s => `${s.startTime}-${s.endTime}` },
    cols.duration && { key: 'duration', label: '时长', align: 'right', value: s => `${toHours(s.durationBilling).toFixed(1)}h` },
    cols.location && { key: 'location', label: '地点', value: s => s.locationName || '' },
  ].filter(Boolean);
}

// 以 = + - @ 开头的格前面加 '，粘进表格软件不会被当成公式——和服务端 CSV 导出同一条
// 规则（server/services/schedule-helpers.js 的 neutralizeFormula，由
// server/__tests__/data-consistency.test.js 盯着两边一致）。
export function neutralizeFormula(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// HTML 会合并掉的只有 ASCII 空白（空格、Tab、换行、换页、回车）；全角空格、不换行空格
// 页面上照样显示，所以不能用 \s——trim() 同理：它连首尾的 U+3000、U+00A0 一起剥掉，
// 复制出去的就比屏幕上、比框选复制的少了东西。
const HTML_WHITESPACE = /[ \t\n\f\r]+/g;
const HTML_WS_EDGE = /^[ \t\n\f\r]+|[ \t\n\f\r]+$/g;

// 「复制表格」按钮放进剪贴板的文本：表头加每节一行，Tab 分列、换行分行——和框选整张表
// 复制出来的一样，粘进表格软件照样分列。每格按页面的显示规整：连续空白合成一个、首尾
// 去掉（同样只去 ASCII 空白；地点是自由文本，里面的 Tab、换行原样留着会把一格拆成几格、
// 一行拆成几行），算不出来的值（坏日期的星期几）是空格子；再按上面的规则防公式。
export function historyTsv(rows, columns) {
  const cell = (v) => neutralizeFormula(String(v ?? '').replace(HTML_WHITESPACE, ' ').replace(HTML_WS_EDGE, ''));
  return [columns.map(c => c.label), ...rows.map(s => columns.map(c => cell(c.value(s))))]
    .map(cells => cells.join('\t'))
    .join('\n');
}

// 显示选项只在用户点的时候写，而且只写点到的这一项，别的原样留着：一打开就把整份
// 默认值写回去，以后改了默认值，只是看过一眼的用户也会被旧默认值钉住；整份覆盖还会
// 抹掉别的标签页刚存的选择、以及新版本才认得的键。raw 是存储里原来的字符串。
export function mergeHistoryColumnChoice(raw, key, value) {
  const base = readSavedColumns(raw) ?? {};
  return JSON.stringify({ ...base, [key]: value });
}
