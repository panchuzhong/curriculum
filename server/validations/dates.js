// 与前端 src/utils/constants.js 的 DATE_MIN/DATE_MAX 一致（两侧是否一致由
// server/__tests__/data-consistency.test.js 盯着）。上下限之外的日期在界面上永远
// 查不到：所有视图都按区间查询，存进去的行既看不见也删不掉。API key 客户端
// （见 agent-help）不走前端表单，所以这一层也得拦。
export const DATE_MIN = '1900-01-01';
export const DATE_MAX = '2999-12-31';
export const YEAR_MIN = +DATE_MIN.slice(0, 4);
export const YEAR_MAX = +DATE_MAX.slice(0, 4);

// 越界和格式错误走的是同一个 isValidDate，提示语得把两件事都说清楚：
// 否则 1899-09-01 这种格式完全正确的值会得到一句「格式须为 YYYY-MM-DD」。
export const DATE_RANGE_SUFFIX = `（${DATE_MIN} ~ ${DATE_MAX}）`;

// 只管日历，不管上下限。
export function isCalendarDate(val) {
  // 先卡类型：正则会把 ['2026-05-01'] 这种值强转成字符串而放行，接着 val.split
  // 直接 TypeError。express-validator 的 .custom() 会把 throw 吃成 400，但还原接口
  // 是普通同步 handler，抛出去就是一个带堆栈的 500。
  if (typeof val !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [y, m, d] = val.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // new Date(y, ...) 把 0-99 年映射到 19xx。对带上下限的日期无所谓（1900 之下本就越界），
  // 但出生日期不卡上下限：不撤销这个映射的话，'0050-03-01' 会被当成非法值，
  // 那条学生记录改个电话号码都会 400。年月日一次性设完，中间不会先滑一次（先
  // setFullYear(0) 再比的话，'0000-02-29' 会先落到 1900 年而滑成 3 月 1 日）。
  const date = new Date(2000, 0, 1);
  date.setFullYear(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isValidDate(val) {
  return isCalendarDate(val) && val >= DATE_MIN && val <= DATE_MAX;
}

// 出生日期允许只写年份。students 和 classes 两处校验各抄一份同样的规则，
// 还原接口又需要第三份，放在这里共用。
// 出生日期是唯一不卡上下限的日期字段：它只用于展示，不参与任何区间查询，
// 所以不存在「写进去就看不到也删不掉」的问题；反过来，旧校验放行过任意 4 位年份，
// 卡上下限会让已存着 1850 这类值的学生记录再也存不下来——只改个电话号码都会 400。
export function isValidBirthDate(val) {
  // 旧接口靠正则的隐式转换接受过数字年份（birthDate: 1990），一刀切掉的话，
  // 这些客户端连改个电话号码都会 400。数组之类的非标量仍要拦在 .split 之前。
  if (typeof val === 'number') return Number.isInteger(val) && /^\d{4}$/.test(String(val));
  if (typeof val !== 'string') return false;
  return /^\d{4}$/.test(val) || isCalendarDate(val);
}

// 同 isCalendarDate：数组会被正则强转成字符串而漏过，接着 .split 就是一个 500。
// 现在还不可达（Express 5 的 simple query parser 只会把重复参数拼成多元素数组，
// 那种值过不了正则），但换成 extended parser、或者像 isValidDate 那样被拿去校 JSON
// 请求体，它就变成了。
export function isValidTime(val) {
  if (typeof val !== 'string') return false;
  if (!/^\d{2}:\d{2}$/.test(val)) return false;
  const [h, m] = val.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidScheduleEndTime(val) {
  if (typeof val !== 'string') return false;
  if (!/^\d{2}:\d{2}$/.test(val)) return false;
  const [h, m] = val.split(':').map(Number);
  return h >= 0 && h <= 47 && m >= 0 && m <= 59;
}

export function normalizeScheduleEndTime(val) {
  const [h, m] = val.split(':').map(Number);
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// End times may use 24:00-47:59 to spell an explicit next-day clock time.
// Regardless of spelling, a schedule must occupy more than 0 and less than
// 24 hours; otherwise normalizing the hour would silently turn a 25-hour span
// into a 1-hour span.
export function isValidScheduleSpan(startTime, endTime) {
  if (!isValidTime(startTime) || !isValidScheduleEndTime(endTime)) return false;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (eh < 24 && diff <= 0) diff += 24 * 60;
  return diff > 0 && diff < 24 * 60;
}
