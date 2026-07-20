import { describe, it, expect } from 'vitest';
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
