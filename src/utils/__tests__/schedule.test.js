import { describe, it, expect } from 'vitest';
import { toMin, duration, findConflictGroups, assignColumns, clipBlock, isAutoBilling, blockGeometry } from '../schedule';

describe('toMin', () => {
  it('converts HH:mm to minutes', () => {
    expect(toMin('08:30')).toBe(510);
  });
  it('handles midnight', () => {
    expect(toMin('00:00')).toBe(0);
  });
  it('handles end of day', () => {
    expect(toMin('23:59')).toBe(1439);
  });
});

describe('duration', () => {
  it('calculates normal duration', () => {
    expect(duration('08:00', '10:00')).toBe(120);
  });
  it('handles fractional hours', () => {
    expect(duration('08:00', '09:30')).toBe(90);
  });
  it('handles overnight (cross-midnight)', () => {
    expect(duration('22:00', '08:00')).toBe(600);
    expect(duration('22:00', '25:00')).toBe(180);
  });
  it('returns 0 for same start and end', () => {
    expect(duration('08:00', '08:00')).toBe(0);
  });
});

describe('findConflictGroups', () => {
  it('returns empty for empty input', () => {
    expect(findConflictGroups([])).toEqual([]);
  });

  it('returns single group for single schedule', () => {
    const schedules = [{ startTime: '08:00', endTime: '10:00' }];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });

  it('groups overlapping schedules', () => {
    const schedules = [
      { startTime: '08:00', endTime: '10:00' },
      { startTime: '09:00', endTime: '11:00' },
    ];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('separates non-overlapping schedules', () => {
    const schedules = [
      { startTime: '08:00', endTime: '09:00' },
      { startTime: '10:00', endTime: '11:00' },
    ];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(2);
  });

  it('handles three-way overlap', () => {
    const schedules = [
      { startTime: '08:00', endTime: '11:00' },
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '10:00', endTime: '12:00' },
    ];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('handles unsorted input', () => {
    const schedules = [
      { startTime: '10:00', endTime: '12:00' },
      { startTime: '08:00', endTime: '09:00' },
    ];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(2);
    // First group should have the earlier schedule
    expect(groups[0][0].startTime).toBe('08:00');
  });

  it('separates touching but not overlapping (end == start)', () => {
    const schedules = [
      { startTime: '08:00', endTime: '10:00' },
      { startTime: '10:00', endTime: '12:00' },
    ];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(2);
  });

  it('does not merge a same-date morning class with that night\'s overnight class', () => {
    const schedules = [
      { startTime: '00:30', endTime: '02:00' },
      { startTime: '22:00', endTime: '01:00' }, // ends on the following date
    ];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(2);
  });

  it('does not merge a cross-midnight schedule that ends before the morning one', () => {
    const schedules = [
      { startTime: '02:00', endTime: '03:00' },
      { startTime: '22:00', endTime: '01:00' }, // ends 01:00, before 02:00
    ];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(2);
  });
});

describe('assignColumns', () => {
  it('assigns column 0 to single schedule', () => {
    const result = assignColumns([{ startTime: '08:00', endTime: '10:00' }]);
    expect(result[0]._col).toBe(0);
  });

  it('assigns same column to non-overlapping', () => {
    const group = [
      { startTime: '08:00', endTime: '09:00' },
      { startTime: '09:00', endTime: '10:00' },
    ];
    const result = assignColumns(group);
    expect(result[0]._col).toBe(0);
    expect(result[1]._col).toBe(0);
  });

  it('assigns different columns to overlapping', () => {
    const group = [
      { startTime: '08:00', endTime: '10:00' },
      { startTime: '09:00', endTime: '11:00' },
    ];
    const result = assignColumns(group);
    expect(result[0]._col).toBe(0);
    expect(result[1]._col).toBe(1);
  });

  it('packs three overlapping into minimal columns', () => {
    const group = [
      { startTime: '08:00', endTime: '11:00' },
      { startTime: '08:00', endTime: '11:00' },
      { startTime: '08:00', endTime: '11:00' },
    ];
    const result = assignColumns(group);
    expect(result.map(r => r._col).sort()).toEqual([0, 1, 2]);
  });

  it('reuses columns greedily', () => {
    // A: 08-10, B: 08-09, C: 09-11
    // A and B overlap → col 0 and 1
    // C overlaps with A but not B → can reuse B's column
    const group = [
      { startTime: '08:00', endTime: '10:00' },
      { startTime: '08:00', endTime: '09:00' },
      { startTime: '09:00', endTime: '11:00' },
    ];
    const result = assignColumns(group);
    expect(result[0]._col).toBe(0);
    expect(result[1]._col).toBe(1);
    expect(result[2]._col).toBe(1);
  });
});

describe('clipBlock', () => {
  it('keeps a block inside the grid as is', () => {
    expect(clipBlock(100, 60, 1000)).toEqual({ top: 100, height: 60 });
  });

  it('shortens a block that starts above the grid by the hidden part', () => {
    // 07:00-09:00 on a grid starting at 08:00 must show one hour, not two.
    expect(clipBlock(-60, 120, 1000)).toEqual({ top: 0, height: 60 });
  });

  it('drops a block that ends above the grid instead of drawing a phantom', () => {
    expect(clipBlock(-180, 60, 1000)).toBeNull();
  });

  it('cuts a block at the grid bottom', () => {
    expect(clipBlock(980, 60, 1000)).toEqual({ top: 980, height: 20 });
  });
});

describe('isAutoBilling', () => {
  it('is true when the stored minutes equal the span', () => {
    expect(isAutoBilling({ startTime: '08:00', endTime: '10:00', durationBilling: 120 })).toBe(true);
    expect(isAutoBilling({ startTime: '23:00', endTime: '01:00', durationBilling: 120 })).toBe(true);
  });

  it('is false for a manual override', () => {
    expect(isAutoBilling({ startTime: '08:00', endTime: '10:00', durationBilling: 90 })).toBe(false);
  });
});

// data-consistency 只把两份 blockGeometry 互相比对，所以同一处改动在两边同时做
// 就全绿了（第 28 轮验证：+1 改成 +9，两边一起改，1226 全过）。这里写死绝对值，
// 让公式本身也动不了。
describe('blockGeometry', () => {
  const OPTS = { rowHeight: 40, topGapHeight: 40 * 5 / 60, firstLabelMin: 8 * 60 };

  it('首行那节课的绝对位置和高度', () => {
    // topGapHeight(10/3) + 0 + 1 ；一小时 = 一行 40，减 1 条边线
    expect(blockGeometry('08:00', '09:00', OPTS)).toEqual({ top: 40 * 5 / 60 + 1, height: 39 });
  });

  it('两小时的块正好两行高', () => {
    expect(blockGeometry('09:00', '11:00', OPTS).height).toBe(79);
  });

  it('一个半小时的块是一行半高', () => {
    expect(blockGeometry('09:00', '10:30', OPTS).height).toBe(59);
  });

  // 不足一行的一律抬到一行：半小时算出来是 19，但那样放不下文字。
  it('半小时的块被抬到一行高', () => {
    expect(blockGeometry('09:00', '09:30', OPTS).height).toBe(39);
  });

  it('晚一小时开始的块正好下移一行', () => {
    const a = blockGeometry('09:00', '10:00', OPTS).top;
    const b = blockGeometry('10:00', '11:00', OPTS).top;
    expect(b - a).toBeCloseTo(40, 9);
  });

  it('起止相同的块退到一行高，而不是整天', () => {
    expect(blockGeometry('08:00', '08:00', OPTS).height).toBe(39);
  });

  it('跨零点按补满 24 小时算', () => {
    expect(blockGeometry('23:00', '01:00', OPTS).height).toBe(79);
  });

  it('比一行还短的课仍占满一行', () => {
    expect(blockGeometry('09:00', '09:05', OPTS).height).toBe(39);
  });

  it('rowHeight 变了，位置和高度按比例变', () => {
    const big = blockGeometry('09:00', '10:00', { ...OPTS, rowHeight: 80, topGapHeight: 80 * 5 / 60 });
    expect(big.height).toBe(79);
    expect(big.top).toBeCloseTo(80 * 5 / 60 + 80 + 1, 9);
  });
});
