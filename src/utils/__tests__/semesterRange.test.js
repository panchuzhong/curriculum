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

  // 倒挂要退回全部排课，但"正好一天"不是倒挂，得留住。学期之间只隔一天时
  // （上一个 07-05 结束、下一个 07-07 开始），窗口算出来 start === end === 07-06。
  // 把 start > end 写成 >= 的话这一天会被当成倒挂丢掉，排课历史默认范围
  // 悄悄放宽成该班全部排课——看着有数据，其实不是用户要的那一段。
  it('学期之间只隔一天时，那一天的窗口要留住', () => {
    const r = getDefaultScheduleRange(
      [
        { type: 'spring', startDate: '2026-03-01', endDate: '2026-07-05' },
        { type: 'summer', startDate: '2026-07-07', endDate: '2026-08-31' },
      ],
      '2026-07-06',
      { first: '2024-01-01', last: '2027-12-31' },
    );
    expect(r).toEqual({ start: '2026-07-06', end: '2026-07-06' });
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

// 还原时故意不校验 semesters，所以库里可能存着 endDate:'2026' 这种行。
// addDays 走的是 new Date('2026' + 'T00:00:00')，V8 宽松解成 2026-01-01，再加一天
// 就是一个完全合法的 '2026-01-02'——调用方再怎么校验结果也看不出问题，
// 页面就默默只列这一年的课，更早的一节不剩。坏行必须在推算前就筛掉。
describe('用不了的学期行不参与推算', () => {
  const EXTENT2 = { first: '2024-03-01', last: '2026-08-30' };

  // V8 宽松解析不只 '2026' 一种：'2026-05' 解成 2026-05-01，'2026-02-31' 直接
  // 滑到 2026-03-03。三种都能算出一个完全合法的日期，所以三种都得被筛掉。
  it.each([
    ['只有年份', '2026'],
    ['只到月', '2026-05'],
    ['日历上不存在', '2026-02-31'],
  ])('endDate %s 时不拿它算区间，而不是算出一个看着正常的日期', (_label, endDate) => {
    const r = getDefaultScheduleRange(
      [{ type: 'fall', startDate: '2025-09-01', endDate }],
      '2026-09-18', EXTENT2,
    );
    expect(r).toEqual({ start: '2024-03-01', end: '2026-08-30' });
  });

  // startDate 那一半同样要筛，而且错得更难看出来：坏行会被选成「下一个学期」，
  // end 取 addDays(startDate, -1)，'2027' 算出 '2026-12-31'、'2027-02-31' 算出 '2027-03-02'——
  // 都是完全正常的日期，页面照着它少列或多列几个月的课，没有任何提示。
  it.each([
    ['只有年份', '2027'],
    ['只到月', '2027-01'],
    ['日历上不存在', '2027-02-31'],
  ])('startDate %s 时不拿它算区间，而不是算出一个看着正常的日期', (_label, startDate) => {
    const r = getDefaultScheduleRange(
      [{ type: 'spring', startDate, endDate: '2027-07-15' }],
      '2026-09-18', EXTENT2,
    );
    expect(r).toEqual({ start: '2024-03-01', end: '2026-08-30' });
  });

  it('坏行不能把好行挤掉', () => {
    const r = getDefaultScheduleRange(
      [{ startDate: '2026-03-01', endDate: '2026-07-15' }, { startDate: 'x', endDate: 'x' }],
      '2026-05-01', EXTENT2,
    );
    expect(r).toEqual({ start: '2026-03-01', end: '2026-07-15' });
  });
});
