import { describe, it, expect } from 'vitest';
import { getDefaultScheduleRange } from '../semesterRange';

// 教师实际只建 春季/秋季 两类学期，学期之间的空档就是寒暑假。
const SPRING = { startDate: '2026-03-01', endDate: '2026-07-15' };
const FALL = { startDate: '2026-09-01', endDate: '2027-01-20' };
const SEMESTERS = [FALL, SPRING]; // 故意乱序，函数须自行排序

const EXTENT = { first: '2025-10-08', last: '2027-03-12' };

describe('getDefaultScheduleRange', () => {
  it('今天在某学期内：取该学期的起止日期', () => {
    expect(getDefaultScheduleRange(SEMESTERS, '2026-09-14', EXTENT))
      .toEqual({ start: '2026-09-01', end: '2027-01-20' });
  });

  it('今天是学期的开始日或结束日：仍算在该学期内', () => {
    expect(getDefaultScheduleRange(SEMESTERS, '2026-03-01', EXTENT))
      .toEqual({ start: '2026-03-01', end: '2026-07-15' });
    expect(getDefaultScheduleRange(SEMESTERS, '2026-07-15', EXTENT))
      .toEqual({ start: '2026-03-01', end: '2026-07-15' });
  });

  it('今天在两个学期之间（暑假）：取整个空档，不含两端学期的边界日', () => {
    expect(getDefaultScheduleRange(SEMESTERS, '2026-08-01', EXTENT))
      .toEqual({ start: '2026-07-16', end: '2026-08-31' });
  });

  it('今天在最后一个学期之后：结束日取该班最后一节课', () => {
    expect(getDefaultScheduleRange(SEMESTERS, '2027-02-10', EXTENT))
      .toEqual({ start: '2027-01-21', end: '2027-03-12' });
  });

  it('今天在第一个学期之前：开始日取该班第一节课', () => {
    expect(getDefaultScheduleRange(SEMESTERS, '2026-01-05', EXTENT))
      .toEqual({ start: '2025-10-08', end: '2026-02-28' });
  });

  it('没有任何学期：取该班全部排课的起止', () => {
    expect(getDefaultScheduleRange([], '2026-09-14', EXTENT))
      .toEqual({ start: '2025-10-08', end: '2027-03-12' });
  });

  it('该班没有排课时，缺失的边界回退到今天', () => {
    expect(getDefaultScheduleRange([], '2026-09-14', { first: null, last: null }))
      .toEqual({ start: '2026-09-14', end: '2026-09-14' });
    expect(getDefaultScheduleRange(SEMESTERS, '2027-02-10', { first: null, last: null }))
      .toEqual({ start: '2027-01-21', end: '2027-02-10' });
  });

  // 两端的兜底各算各的：没有上一个学期时 start 退到第一节课，没有下一个学期时 end 退到
  // 最后一节课。两者互不知情，窗口可能倒挂成 start > end，把整个班的课全筛没。
  it('开学前打开一个只在新学期有课的班级：不返回倒挂的空窗口', () => {
    // 只建了秋季学期，暑假里批量排好了秋季的课
    expect(getDefaultScheduleRange([FALL], '2026-08-20', { first: '2026-09-05', last: '2026-12-20' }))
      .toEqual({ start: '2026-09-05', end: '2026-12-20' });
  });

  it('暑假里打开一个春季就结课的班级：不返回倒挂的空窗口', () => {
    // 只建了春季学期，该班最后一节课在春季学期之内
    expect(getDefaultScheduleRange([SPRING], '2026-08-01', { first: '2026-03-10', last: '2026-06-20' }))
      .toEqual({ start: '2026-03-10', end: '2026-06-20' });
  });

  it('相邻学期共用边界日时不存在空档，边界日归属先开始的那个学期', () => {
    const contiguous = [
      { startDate: '2026-09-01', endDate: '2027-01-15' },
      { startDate: '2027-01-15', endDate: '2027-02-20' },
    ];
    expect(getDefaultScheduleRange(contiguous, '2027-01-15', EXTENT))
      .toEqual({ start: '2026-09-01', end: '2027-01-15' });
  });
});
