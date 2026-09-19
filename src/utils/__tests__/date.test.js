import { describe, it, expect } from 'vitest';
import { parseDateStr, fmt, todayStr, getMonday, addDays, getMonthRange, getYearRange, toHours, toHoursAbs, intParam, isUsableDate, dateRangeError, DATE_INVALID_HINT, clampYear, clampDate, stepMonthTarget } from '../date';

describe('parseDateStr', () => {
  it('parses YYYY-MM-DD to Date at midnight', () => {
    const d = parseDateStr('2026-05-25');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // 0-indexed
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
  });
});

describe('fmt', () => {
  it('年份补齐到 4 位', () => {
    expect(fmt(new Date(261, 6, 1))).toBe('0261-07-01');
    expect(fmt(new Date(2026, 8, 17))).toBe('2026-09-17');
  });

  it('formats Date to YYYY-MM-DD', () => {
    expect(fmt(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('zero-pads month and day', () => {
    expect(fmt(new Date(2026, 10, 1))).toBe('2026-11-01');
  });
});

describe('todayStr', () => {
  it('returns today in YYYY-MM-DD format', () => {
    const result = todayStr();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getMonday', () => {
  it('returns Monday of same week for a Wednesday', () => {
    // 2026-05-25 is a Monday
    expect(getMonday('2026-05-25')).toBe('2026-05-25');
  });
  it('returns previous Monday for a Sunday', () => {
    // 2026-05-31 is a Sunday
    expect(getMonday('2026-05-31')).toBe('2026-05-25');
  });
  it('returns same Monday for a Saturday', () => {
    // 2026-05-30 is a Saturday
    expect(getMonday('2026-05-30')).toBe('2026-05-25');
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2026-05-25', 7)).toBe('2026-06-01');
  });
  it('adds negative days', () => {
    expect(addDays('2026-05-25', -1)).toBe('2026-05-24');
  });
  it('handles month boundary', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('handles year boundary', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('getMonthRange', () => {
  it('returns range for January (month=0)', () => {
    expect(getMonthRange(2026, 0)).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });
  it('returns range for February non-leap', () => {
    expect(getMonthRange(2025, 1)).toEqual({ start: '2025-02-01', end: '2025-02-28' });
  });
  it('returns range for February leap year', () => {
    expect(getMonthRange(2028, 1)).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
  it('returns range for December', () => {
    expect(getMonthRange(2026, 11)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });
  // new Date(y, ...) 把 0-99 年映射到 19xx：不绕开的话 end 会变成 '1961-01-31'，
  // 和 start 差一个世纪。今天调用方都把年份夹在 YEAR_MIN 以上，轮不到这一步，
  // 但它是个导出的纯函数，两端得自己对得上。
  it('keeps both ends in the same century for a two-digit year', () => {
    expect(getMonthRange(61, 0)).toEqual({ start: '0061-01-01', end: '0061-01-31' });
  });
});

describe('getYearRange', () => {
  it('returns full year range', () => {
    expect(getYearRange(2026)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  // 和 getMonthRange 同一回事：年份不补到 4 位的话，'61-01-01' 拿去和
  // 'YYYY-MM-DD' 比大小就没意义了。只用 2026 试的话这一句 padStart 删了也不会红。
  it('pads years shorter than 4 digits', () => {
    expect(getYearRange(61)).toEqual({ start: '0061-01-01', end: '0061-12-31' });
  });
});

describe('toHours', () => {
  it('converts minutes to hours', () => {
    expect(toHours(120)).toBe(2);
  });
  it('handles fractional hours', () => {
    expect(toHours(90)).toBe(1.5);
  });
});

describe('toHoursAbs', () => {
  it('returns absolute value', () => {
    expect(toHoursAbs(-120)).toBe(2);
  });
  it('returns 0 for null', () => {
    expect(toHoursAbs(null)).toBe(0);
  });
  it('returns 0 for undefined', () => {
    expect(toHoursAbs(undefined)).toBe(0);
  });
  it('returns 0 for zero', () => {
    expect(toHoursAbs(0)).toBe(0);
  });
});

describe('intParam', () => {
  // ?year=abc used to become NaN and render "NaN年" with an unrecoverable view.
  it('falls back on non-numeric, empty and missing values', () => {
    expect(intParam('abc', 2026)).toBe(2026);
    expect(intParam('', 2026)).toBe(2026);
    expect(intParam(null, 2026)).toBe(2026);
    expect(intParam('  ', 2026)).toBe(2026);
  });

  it('falls back on non-integers and out-of-range values', () => {
    expect(intParam('2026.5', 2026)).toBe(2026);
    expect(intParam('13', 5, { min: 0, max: 11 })).toBe(5);
    expect(intParam('-1', 5, { min: 0, max: 11 })).toBe(5);
  });

  it('accepts valid values, including 0', () => {
    expect(intParam('2027', 2026, { min: 1000, max: 9999 })).toBe(2027);
    expect(intParam('0', 5, { min: 0, max: 11 })).toBe(0);
    // 上界也要贴着测：只测 13 被拒 + 0 被收的话，把 n > max 写成 n >= max
    // 察觉不到——而那会让 /monthly?year=2999、/yearly?year=2999 和 ?year=1900
    // 这些正好落在上下限上的 URL 悄悄回落到今年。
    expect(intParam('11', 5, { min: 0, max: 11 })).toBe(11);
    expect(intParam('2999', 2026, { min: 1900, max: 2999 })).toBe(2999);
    expect(intParam('1900', 2026, { min: 1900, max: 2999 })).toBe(1900);
  });
});

// 原生日期输入框的年份段不会在第 4 位后自动跳段，min/max 也只是把越界值标成
// invalid，值照样传出来。这类值比大小会静默算错，交给 new Date() 是 Invalid Date，
// 当循环边界还会一天天跑上几十万次。
describe('isUsableDate', () => {
  it('接受定长且在上下限之内的日期', () => {
    expect(isUsableDate('2026-09-17')).toBe(true);
    expect(isUsableDate('1900-01-01')).toBe(true);
    expect(isUsableDate('2999-12-31')).toBe(true);
  });

  it('拒绝位数不对的年份', () => {
    expect(isUsableDate('20261-08-26')).toBe(false);
    expect(isUsableDate('261-08-26')).toBe(false);
  });

  it('拒绝上下限之外的日期', () => {
    expect(isUsableDate('0002-01-01')).toBe(false);
    expect(isUsableDate('1899-12-31')).toBe(false);
    expect(isUsableDate('3000-01-01')).toBe(false);
  });

  it('拒绝位数正确但日历上不存在的日期', () => {
    expect(isUsableDate('2026-13-01')).toBe(false);
    expect(isUsableDate('2026-02-31')).toBe(false);
    expect(isUsableDate('2026-02-29')).toBe(false);
    expect(isUsableDate('2026-00-10')).toBe(false);
    // 闰年 2 月 29 日是真日期，不能连带拒掉
    expect(isUsableDate('2024-02-29')).toBe(true);
  });

  it('拒绝空值和非日期', () => {
    expect(isUsableDate('')).toBe(false);
    expect(isUsableDate(undefined)).toBe(false);
    expect(isUsableDate('2026-09')).toBe(false);
  });

  // 正则会把参数强转成字符串：['2026-05-01'] 能过正则，下一行 value.split 就是 TypeError。
  it('非字符串一律拒绝，而不是抛异常', () => {
    expect(isUsableDate(['2026-05-01'])).toBe(false);
    expect(isUsableDate({ toString: () => '2026-05-01' })).toBe(false);
    expect(isUsableDate(20260501)).toBe(false);
    expect(isUsableDate(null)).toBe(false);
  });
});

// fmt() 把年份补到 4 位后，Invalid Date 格成 '0NaN-NaN-NaN'，它排在 DATE_MIN 之下。
// 直接比大小的话一堆垃圾会变成一个看着完全正常的 1900-01-01，下游再也看不出来。
describe('clampDate 不把垃圾变成看着正常的日期', () => {
  it('非日历日期原样送回', () => {
    expect(clampDate('0NaN-NaN-NaN')).toBe('0NaN-NaN-NaN');
    expect(clampDate('20261-08-26')).toBe('20261-08-26');
    expect(clampDate('2026-02-31')).toBe('2026-02-31');
  });

  it('真实日期照常夹', () => {
    expect(clampDate('0261-07-01')).toBe('1900-01-01');
    expect(clampDate('3000-01-01')).toBe('2999-12-31');
    expect(clampDate('2026-05-01')).toBe('2026-05-01');
  });
});

describe('dateRangeError', () => {
  it('两端都可用且不倒挂时返回 null', () => {
    expect(dateRangeError('2026-01-01', '2026-12-31')).toBe(null);
    expect(dateRangeError('2026-05-01', '2026-05-01')).toBe(null);
  });

  it('默认两端必填，清空一端也要给出理由', () => {
    expect(dateRangeError('', '2026-12-31')).toBe('请填写完整的日期区间');
    expect(dateRangeError('2026-01-01', '')).toBe('请填写完整的日期区间');
    expect(dateRangeError(undefined, undefined)).toBe('请填写完整的日期区间');
  });

  it('allowOpen 时空值表示该方向不设限', () => {
    expect(dateRangeError('', '', { allowOpen: true })).toBe(null);
    expect(dateRangeError('', '2026-12-31', { allowOpen: true })).toBe(null);
    expect(dateRangeError('2026-01-01', '', { allowOpen: true })).toBe(null);
  });

  it('越界或位数不对的值即使 allowOpen 也不当作不设限', () => {
    expect(dateRangeError('0261-08-26', '2026-12-31')).toBe(DATE_INVALID_HINT);
    expect(dateRangeError('0261-08-26', '', { allowOpen: true })).toBe(DATE_INVALID_HINT);
    expect(dateRangeError('2026-01-01', '20261-08-26', { allowOpen: true })).toBe(DATE_INVALID_HINT);
  });

  it('倒挂的区间单独给理由', () => {
    expect(dateRangeError('2026-12-31', '2026-01-01')).toBe('开始日期晚于结束日期');
    expect(dateRangeError('2026-12-31', '2026-01-01', { allowOpen: true })).toBe('开始日期晚于结束日期');
  });

  it('提示语把上下限写清楚', () => {
    expect(DATE_INVALID_HINT).toContain('1900-01-01');
    expect(DATE_INVALID_HINT).toContain('2999-12-31');
  });
});

// 周/月/年视图的区间是翻页和 URL 参数给出的，不经过日期输入框。服务端的
// isValidDate 带着同一对上下限，翻出去之后区间查询直接 400，整屏课表就都没了。
describe('clampYear', () => {
  it('范围内原样返回', () => {
    expect(clampYear(2026)).toBe(2026);
    expect(clampYear(1900)).toBe(1900);
    expect(clampYear(2999)).toBe(2999);
  });

  it('越界时夹到边界', () => {
    expect(clampYear(1899)).toBe(1900);
    expect(clampYear(3000)).toBe(2999);
    expect(clampYear(9999)).toBe(2999);
  });
});

describe('clampDate', () => {
  // 旧服务端收下的 0261 年数据经 addDays 算一次，年份不补齐就成了 '261-07-01'，
  // 字符串排序上落在上下限之间，clampDate 就看不出它越界。
  it('跨过 addDays 的低年份仍能被夹住', () => {
    expect(addDays('0261-06-30', 1)).toBe('0261-07-01');
    expect(clampDate(addDays('0261-06-30', 1))).toBe('1900-01-01');
  });

  it('范围内原样返回', () => {
    expect(clampDate('2026-09-17')).toBe('2026-09-17');
    expect(clampDate('1900-01-01')).toBe('1900-01-01');
    expect(clampDate('2999-12-31')).toBe('2999-12-31');
  });

  // 周视图前后各多取 7 天做缓冲，贴着上下限时这几天会越界
  it('越界时夹到边界', () => {
    expect(clampDate('1899-12-25')).toBe('1900-01-01');
    expect(clampDate('3000-01-13')).toBe('2999-12-31');
  });
});

describe('stepMonthTarget', () => {
  it('普通翻页', () => {
    expect(stepMonthTarget(2026, 5, 1)).toEqual({ year: 2026, month: 6 });
    expect(stepMonthTarget(2026, 5, -1)).toEqual({ year: 2026, month: 4 });
  });

  it('跨年进位/退位', () => {
    expect(stepMonthTarget(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(stepMonthTarget(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('翻到下限之前就停住', () => {
    expect(stepMonthTarget(1900, 0, -1)).toBe(null);
    expect(stepMonthTarget(1900, 0, 1)).toEqual({ year: 1900, month: 1 });
  });

  it('翻到上限之后就停住', () => {
    expect(stepMonthTarget(2999, 11, 1)).toBe(null);
    expect(stepMonthTarget(2999, 11, -1)).toEqual({ year: 2999, month: 10 });
  });
});
