import { describe, it, expect } from 'vitest';
import { pickDefaultSemesterId } from '../BatchScheduleDialog';

// GET /api/semesters has no ORDER BY, so the list arrives in insertion order.
// Every case below therefore feeds deliberately unsorted input.
describe('pickDefaultSemesterId', () => {
  const spring = { id: 1, name: '2026春季', startDate: '2026-02-23', endDate: '2026-07-05' };
  const summer = { id: 2, name: '2026暑假', startDate: '2026-07-07', endDate: '2026-08-31' };
  const fall = { id: 3, name: '2026秋季', startDate: '2026-09-01', endDate: '2027-01-15' };

  it('选中正在进行的学期，而不是列表里排在前面的', () => {
    expect(pickDefaultSemesterId([fall, spring, summer], '2026-07-20')).toBe(summer.id);
  });

  it('学期首日算作正在进行', () => {
    expect(pickDefaultSemesterId([fall, spring, summer], '2026-02-23')).toBe(spring.id);
  });

  it('学期末日算作正在进行', () => {
    expect(pickDefaultSemesterId([fall, spring, summer], '2026-07-05')).toBe(spring.id);
  });

  it('没有进行中的学期时，选最近即将开始的一个', () => {
    // 2026-07-06 落在春季结束与暑假开始之间的空档
    expect(pickDefaultSemesterId([fall, summer, spring], '2026-07-06')).toBe(summer.id);
  });

  it('按开始日期而非列表顺序挑选即将开始的学期', () => {
    expect(pickDefaultSemesterId([fall, summer], '2026-01-01')).toBe(summer.id);
  });

  it('全部学期都已结束时不做预选', () => {
    expect(pickDefaultSemesterId([spring, summer, fall], '2027-06-01')).toBeNull();
  });

  it('学期列表为空时不做预选', () => {
    expect(pickDefaultSemesterId([], '2026-07-20')).toBeNull();
  });

  // 178b146 relaxed the server's overlap check to a half-open comparison so
  // contiguous semesters may share a boundary date. Ranges are inclusive
  // everywhere else, so on that one day two semesters are both "in progress"
  // and the choice must not depend on the order the API happened to return.
  it('在两个学期共享的边界日上，结果与列表顺序无关', () => {
    const ending = { id: 1, name: '春季', startDate: '2026-01-01', endDate: '2026-06-30' };
    const starting = { id: 2, name: '暑期', startDate: '2026-06-30', endDate: '2026-08-31' };
    const boundary = '2026-06-30';
    expect(pickDefaultSemesterId([ending, starting], boundary))
      .toBe(pickDefaultSemesterId([starting, ending], boundary));
  });

  it('边界日优先选刚开始的那个学期，而不是当天结束的', () => {
    const ending = { id: 1, name: '春季', startDate: '2026-01-01', endDate: '2026-06-30' };
    const starting = { id: 2, name: '暑期', startDate: '2026-06-30', endDate: '2026-08-31' };
    // 从今天起排课：结束的学期只剩 1 天，刚开始的才是有意义的目标
    expect(pickDefaultSemesterId([ending, starting], '2026-06-30')).toBe(starting.id);
  });
});
