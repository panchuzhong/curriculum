import { describe, it, expect } from 'vitest';
import { DEFAULT_HISTORY_COLUMNS, parseHistoryColumns } from '../historyColumns';

// 排课历史的显示选项存在 localStorage 里，读回来的东西不可信：可能是旧版本写的、
// 被手改过的，或者压根不是 JSON。认得的键只收布尔值，其余一律回到默认——宁可
// 多显示一列，也不要因为一个坏值把用户要复制的那一列悄悄藏掉。
describe('parseHistoryColumns', () => {
  it('默认全部显示，和加这个功能之前一样', () => {
    expect(DEFAULT_HISTORY_COLUMNS).toEqual({ year: true, weekday: true, duration: true, location: true });
  });

  it('没存过（null）时用默认', () => {
    expect(parseHistoryColumns(null)).toEqual(DEFAULT_HISTORY_COLUMNS);
  });

  it('只存了一部分时，其余用默认', () => {
    expect(parseHistoryColumns('{"year":false,"location":false}'))
      .toEqual({ year: false, weekday: true, duration: true, location: false });
  });

  it('不是 JSON 时用默认', () => {
    expect(parseHistoryColumns('{year:false')).toEqual(DEFAULT_HISTORY_COLUMNS);
  });

  it('值不是布尔时那一项用默认', () => {
    // "false" 这个字符串是真值，照搬进去的话「星期」这一列会以为自己该显示，
    // 而 0 是假值，会把「时长」悄悄藏掉。
    expect(parseHistoryColumns('{"weekday":"false","duration":0,"location":null}'))
      .toEqual(DEFAULT_HISTORY_COLUMNS);
  });

  it('数组、数字之类的非对象用默认', () => {
    expect(parseHistoryColumns('[false,false]')).toEqual(DEFAULT_HISTORY_COLUMNS);
    expect(parseHistoryColumns('0')).toEqual(DEFAULT_HISTORY_COLUMNS);
  });

  it('不认得的键不带进来', () => {
    expect(parseHistoryColumns('{"year":false,"extra":true}'))
      .toEqual({ ...DEFAULT_HISTORY_COLUMNS, year: false });
  });

  it('每次返回新对象，改它不会污染默认值', () => {
    const cols = parseHistoryColumns(null);
    cols.year = false;
    expect(DEFAULT_HISTORY_COLUMNS.year).toBe(true);
  });
});
