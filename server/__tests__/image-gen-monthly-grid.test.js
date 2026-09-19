import { describe, it, expect } from 'vitest';
import { getMonthDates } from '../services/image-gen-monthly.js';

// 月历网格是周一开头的：JS 的 getDay() 里 0 是周日，必须映射成第 7 列。
// 写成 getDay() + 1 之类的话，每个月的每一天都会挪到错误的星期列，
// 而以周日开头的月份会整体错开一整周。导出的 PNG 看上去仍是一张正常日历，
// 只是所有课都排在了错误的星期几下面。
describe('月历网格的起始列', () => {
  // [年, 月(0-11), 该月1号是周几(中文), 前导空格数, 该月天数]
  it.each([
    ['2026-09（周二开头）', 2026, 8, 1, 30],
    ['2026-01（周四开头）', 2026, 0, 3, 31],
    ['2026-02（周日开头）', 2026, 1, 6, 28],
    ['2026-03（周日开头）', 2026, 2, 6, 31],
    ['2027-08（周日开头）', 2027, 7, 6, 31],
  ])('%s 前面留 %i 个空格', (_label, year, month, leading, days) => {
    const cells = getMonthDates(year, month);

    expect(cells.slice(0, leading)).toEqual(Array(leading).fill(null));
    expect(cells[leading]).toBe(1);
    expect(cells.length).toBe(leading + days);
    expect(cells[cells.length - 1]).toBe(days);
  });

  // 周日开头的月份是这段逻辑唯一真正吃劲的地方：0 必须当成 7。
  it('周日开头的月份，1 号排在第 7 列而不是第 1 列', () => {
    const cells = getMonthDates(2026, 1); // 2026-02-01 是周日
    expect(cells.indexOf(1)).toBe(6);
  });

  // 对照：不是周日开头的月份，空格数正好等于 getDay()-1
  it('周二开头的月份只留 1 个空格', () => {
    expect(getMonthDates(2026, 8).indexOf(1)).toBe(1);
  });
});
