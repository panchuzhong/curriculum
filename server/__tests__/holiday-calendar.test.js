import { describe, it, expect } from 'vitest';
import { buildHolidayCalendar } from '../services/holiday-calendar.js';
import { HOLIDAYS, WORKDAYS } from '../services/holidays-data.js';

// 某位教师的节假日日历：库里的记录 + 内置数据。排课（跳不跳）和出图（标不标）
// 用的都是这一份——此前两处各写一遍，只是碰巧还没改出分歧。

describe('buildHolidayCalendar', () => {
  it('库里的节假日：是节假日、不上课、名字取库里的', () => {
    const cal = buildHolidayCalendar([{ date: '2027-03-10', type: 'holiday', name: '校庆' }]);
    expect(cal.isHoliday('2027-03-10')).toBe(true);
    expect(cal.isOffDay('2027-03-10')).toBe(true);
    expect(cal.holidayName('2027-03-10')).toBe('校庆');
  });

  it('库里的调休上班日：是上班日、照常上课', () => {
    const cal = buildHolidayCalendar([{ date: '2027-03-13', type: 'workday', name: '调休上班' }]);
    expect(cal.isWorkday('2027-03-13')).toBe(true);
    expect(cal.isHoliday('2027-03-13')).toBe(false);
    expect(cal.isOffDay('2027-03-13')).toBe(false);
  });

  it('同一天既有节假日又有调休：两个标签都给，排课按上班日', () => {
    // 节假日接口按日期去重，但还原备份不去重，这种矛盾数据进得来。标签照实都显示
    // （前端、导出图一致）；「跳不跳」必须有个结论，调休优先——宁可多排一节课让
    // 老师自己删，也不要静默少排。
    const cal = buildHolidayCalendar([
      { date: '2027-03-10', type: 'holiday', name: '校庆' },
      { date: '2027-03-10', type: 'workday', name: '调休上班' },
    ]);
    expect(cal.isHoliday('2027-03-10')).toBe(true);
    expect(cal.isWorkday('2027-03-10')).toBe(true);
    expect(cal.isOffDay('2027-03-10')).toBe(false);
  });

  it('某年库里只要有一条记录，内置数据对这一年整体作废', () => {
    // 老师删掉了某个法定假（那天要上课），库里就不再有它；内置那份若还算数，
    // 课表上照旧标着红色的「国庆」，批量排课也照旧跳过它。
    const cal = buildHolidayCalendar([{ date: '2026-03-10', type: 'holiday', name: '校庆' }]);
    expect(cal.isHoliday('2026-10-01')).toBe(false);   // 内置节假日
    expect(cal.isOffDay('2026-10-01')).toBe(false);
    expect(cal.isWorkday('2026-10-10')).toBe(false);   // 内置调休
    // 只作废这一年：别的年份照用内置数据
    expect(cal.isHoliday('2025-10-01')).toBe(true);
  });

  it('某年库里没有记录时用内置数据', () => {
    const cal = buildHolidayCalendar([]);
    expect(cal.isHoliday('2026-10-01')).toBe(true);
    expect(cal.isOffDay('2026-10-01')).toBe(true);
    expect(cal.holidayName('2026-10-01')).toBe('国庆');
    expect(cal.isWorkday('2026-10-10')).toBe(true);
    expect(cal.isOffDay('2026-10-10')).toBe(false);
  });

  it('库里的节假日没起名字时退回通用名', () => {
    const cal = buildHolidayCalendar([{ date: '2027-03-10', type: 'holiday', name: '' }]);
    expect(cal.holidayName('2027-03-10')).toBe('节假日');
  });

  it('uncoveredYears 只报既无内置也无自定义数据的年份', () => {
    expect(buildHolidayCalendar([]).uncoveredYears(['2026-05-01', '2999-01-01', '2999-02-01']))
      .toEqual(['2999']);
    expect(buildHolidayCalendar([{ date: '2999-06-01', type: 'holiday', name: 'x' }])
      .uncoveredYears(['2999-01-01'])).toEqual([]);
  });
});

describe('内置数据的前提', () => {
  // isOffDay = isHoliday && !isWorkday。在同一年里没有库记录时，它等于「内置节假日
  // 且不是内置调休日」；只有两份内置列表互不相交，这才和「内置节假日」是同一回事。
  // 哪天有人把同一天同时录进两份列表，排课会悄悄改成不跳过它——这条用例先挂。
  it('同一年的内置节假日与内置调休日互不相交', () => {
    for (const year of Object.keys(HOLIDAYS)) {
      const both = HOLIDAYS[year].filter(d => (WORKDAYS[year] || []).includes(d));
      expect(both, `${year} 年同时出现在两份列表里的日期`).toEqual([]);
    }
  });
});
