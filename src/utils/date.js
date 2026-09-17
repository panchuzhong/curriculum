import { DATE_MIN, DATE_MAX } from './constants';

export function parseDateStr(dateStr) {
  return new Date(dateStr + 'T00:00:00');
}

export function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayStr() {
  return fmt(new Date());
}

export function getMonday(dateStr) {
  const d = parseDateStr(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return fmt(d);
}

export function addDays(dateStr, days) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return fmt(d);
}

export function getMonthRange(year, month) {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const last = new Date(year, month + 1, 0);
  return { start, end: fmt(last) };
}

export function getYearRange(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function toHours(durationBilling) {
  return durationBilling / 60;
}

export function toHoursAbs(durationBilling) {
  if (durationBilling == null) return 0;
  return Math.abs(durationBilling) / 60;
}

// URL query params are user-editable. `+'abc'` is NaN, and a NaN year poisons
// every date derived from it — the view renders "NaN年" and the API call 400s
// with no way back except editing the URL by hand.
export function intParam(value, fallback, { min, max } = {}) {
  if (value == null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  if (min != null && n < min) return fallback;
  if (max != null && n > max) return fallback;
  return n;
}

// 日期输入框给出的值不一定能用：年份段不会在第 4 位后自动跳段，能打出 5 位以上的
// 年份；min/max 也只是把越界值标成 invalid，value 照样传出来。位数不对的值比大小
// 会静默算错，交给 new Date() 是 Invalid Date，当循环边界还会一天天跑上几十万次。
export function isUsableDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < DATE_MIN || value > DATE_MAX) return false;
  // 还要拦 2026-02-31 这类位数正确、日历上却不存在的值：它们比大小看着正常，
  // 交给 new Date() 同样是 Invalid Date。DATE_MIN 之上不会触发 0-99 映射到 19xx。
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}
