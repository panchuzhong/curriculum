import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultsFromSemesters } from '../SemesterManager';

// 跨年学期模板：fall(y) 结束于 y+1-01-15，winter(y) 结束于 y+1-02-20，
// 即 endDate 的年份已经是 y+1。推荐下一学期时必须回退到模板年份 y，
// 否则推荐结果会整体晚一年。
describe('getDefaultsFromSemesters 跨年度学期推荐', () => {
  it('最新为 2026秋季（结束于 2027-01-15）时，推荐 2026寒假', () => {
    const d = getDefaultsFromSemesters([
      { name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' },
    ]);
    expect(d).toEqual({ name: '2026寒假', type: 'winter', startDate: '2027-01-15', endDate: '2027-02-20' });
  });

  it('最新为 2026寒假（结束于 2027-02-20）时，推荐 2027春季', () => {
    const d = getDefaultsFromSemesters([
      { name: '2026寒假', type: 'winter', startDate: '2027-01-15', endDate: '2027-02-20' },
    ]);
    expect(d).toEqual({ name: '2027春季', type: 'spring', startDate: '2027-02-23', endDate: '2027-07-05' });
  });

  it('最新为 2027春季（非跨年）时，推荐 2027暑假（不回归）', () => {
    const d = getDefaultsFromSemesters([
      { name: '2027春季', type: 'spring', startDate: '2027-02-23', endDate: '2027-07-05' },
    ]);
    expect(d).toEqual({ name: '2027暑假', type: 'summer', startDate: '2027-07-07', endDate: '2027-08-31' });
  });

  it('最新为 2027暑假（非跨年）时，推荐 2027秋季（不回归）', () => {
    const d = getDefaultsFromSemesters([
      { name: '2027暑假', type: 'summer', startDate: '2027-07-07', endDate: '2027-08-31' },
    ]);
    expect(d).toEqual({ name: '2027秋季', type: 'fall', startDate: '2027-09-01', endDate: '2028-01-15' });
  });
});

// 无学期时按当前日期猜模板：春季 02-23~07-05，暑假 07-07~08-31，秋季 09-01~次年 01-15，
// 寒假 01-15~02-20（模板年份为上一年）。猜出的范围不能整体落在过去。
describe('getDefaultsFromSemesters 无学期时按当月推荐', () => {
  afterEach(() => vi.useRealTimers());

  function at(iso) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it('3 月推荐当年春季', () => {
    at('2026-03-10T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.spring);
  });

  it('7 月推荐当年暑假（春季 07-05 已结束）', () => {
    at('2026-07-20T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.summer);
  });

  it('8 月推荐当年暑假', () => {
    at('2026-08-10T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.summer);
  });

  it('9 月推荐当年秋季（暑假 08-31 已结束）', () => {
    at('2026-09-05T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.fall);
  });

  it('1 月推荐上一年寒假', () => {
    at('2027-01-10T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.winter);
  });
});

const SEMESTER_TEMPLATE_2026 = {
  spring: { name: '2026春季', type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' },
  summer: { name: '2026暑假', type: 'summer', startDate: '2026-07-07', endDate: '2026-08-31' },
  fall:   { name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' },
  winter: { name: '2026寒假', type: 'winter', startDate: '2027-01-15', endDate: '2027-02-20' },
};
