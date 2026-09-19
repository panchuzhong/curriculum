import { DATE_MIN, DATE_MAX } from './constants';

export function parseDateStr(dateStr) {
  return new Date(dateStr + 'T00:00:00');
}

// 年份也要补齐到 4 位：旧服务端收下的 0261 年数据经 addDays 算一次就是 '261-07-01'，
// 这个字符串排序上落在 DATE_MIN ~ DATE_MAX 之间，clampDate 看不出它越界、原样放过，
// 下游再拿正则一卡就成了「日期无效」。
export function fmt(d) {
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  // 年份同样补齐：只给 fmt() 补的话，这里会返回一个 start='261-01-01'、
  // end='0261-01-31' 的区间——两端位数不一样，clampDate 还看不出前者越界。
  const start = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
  // 补齐还不够：new Date(y, ...) 把 0-99 年映射到 19xx，getMonthRange(61, 0) 的
  // start 是 '0061-01-01'、end 却是 '1961-01-31'，两端直接差了一个世纪。
  // 今天唯一的调用方把年份夹在 YEAR_MIN 以上，轮不到；但这是个导出的纯函数，
  // 三参数的 setFullYear 一次写完就绕开了映射（和 isCalendarDate 同一个写法）。
  const last = new Date(2000, 0, 1);
  last.setFullYear(year, month + 1, 0);
  return { start, end: fmt(last) };
}

export function getYearRange(year) {
  const y = String(year).padStart(4, '0');
  return { start: `${y}-01-01`, end: `${y}-12-31` };
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
// 只管日历，不管上下限（与服务端 isCalendarDate 一致，由 data-consistency 测试盯着）。
export function isCalendarDate(value) {
  // 正则会把 ['2026-05-01'] 这种值强转成字符串而放行，接着 value.split 就是 TypeError。
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // 还要拦 2026-02-31 这类位数正确、日历上却不存在的值：它们比大小看着正常，
  // 交给 new Date() 同样是 Invalid Date。
  const [y, m, d] = value.split('-').map(Number);
  // new Date(y, ...) 把 0-99 年映射到 19xx。对带上下限的日期无所谓（1900 之下本就越界），
  // 但出生日期不卡上下限：不撤销这个映射的话，'0050-03-01' 会被当成非法值，
  // 那条学生记录改个电话号码都会 400。年月日一次性设完，中间不会先滑一次（先
  // setFullYear(0) 再比的话，'0000-02-29' 会先落到 1900 年而滑成 3 月 1 日）。
  const parsed = new Date(2000, 0, 1);
  parsed.setFullYear(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

export function isUsableDate(value) {
  return isCalendarDate(value) && value >= DATE_MIN && value <= DATE_MAX;
}

export const DATE_INVALID_HINT = `日期无效，须在 ${DATE_MIN} ~ ${DATE_MAX} 之间`;

// 周/月/年视图的区间是翻页和 URL 参数给出的，不经过日期输入框。服务端的
// isValidDate 带着同一对上下限，翻出去之后区间查询直接 400，整屏课表就都没了。
export const YEAR_MIN = +DATE_MIN.slice(0, 4);
export const YEAR_MAX = +DATE_MAX.slice(0, 4);

export function clampYear(year) {
  return Math.min(YEAR_MAX, Math.max(YEAR_MIN, year));
}

// 翻页后的目标年月；越过上下限时返回 null，调用方停在原处。
export function stepMonthTarget(year, month, delta) {
  const total = year * 12 + month + delta;
  const y = Math.floor(total / 12);
  if (y < YEAR_MIN || y > YEAR_MAX) return null;
  return { year: y, month: total - y * 12 };
}

// 把推算出来的日期夹回服务端接受的范围（周视图前后各多取 7 天的缓冲、
// 「开始 + 9 天」这类自动填充）。只夹日历上真实存在的日期；其余一律原样送回，
// 交给调用方的 isUsableDate 去拦。用户直接输的值请先用 isUsableDate 拦。
//
// 不能对任意字符串比大小：fmt() 把年份补到 4 位后，Invalid Date 会格成
// '0NaN-NaN-NaN'，它排在 DATE_MIN 之下，直接比大小就会把一堆垃圾变成一个看着
// 完全正常的 1900-01-01——跟 ScheduleHistory 那一处不夹的理由是同一个。
export function clampDate(value) {
  // 夹不动的一律原样返回：空字符串（多处表示「该方向不设限」，夹成 DATE_MIN
  // 会把这个意图静默改掉）、非字符串、日历上不存在的值，走的都是下面这条
  // isCalendarDate 的门——'' 本来就过不了它，不必再单列一个 value === '' 的分支。
  if (typeof value !== 'string') return value;
  if (!isCalendarDate(value)) return value;
  return value < DATE_MIN ? DATE_MIN : value > DATE_MAX ? DATE_MAX : value;
}

// 「开始 ~ 结束」两个日期输入框被拒的原因，null 表示可用。拦截条件和提示语
// 必须出自同一处：各写一套就会出现「拦了但不说」——该发的请求没发，页面却还
// 摆着上一个区间的数字，看起来就像当前区间的结果。
// allowOpen：某一端留空表示该方向不设限（排课历史的筛选框）；不开时两端都必填。
export function dateRangeError(start, end, { allowOpen = false } = {}) {
  if (!allowOpen && (!start || !end)) return '请填写完整的日期区间';
  if ((start && !isUsableDate(start)) || (end && !isUsableDate(end))) return DATE_INVALID_HINT;
  if (start && end && start > end) return '开始日期晚于结束日期';
  return null;
}
