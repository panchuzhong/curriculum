import { describe, it, expect } from 'vitest';
import { toMin, duration, findConflictGroups, assignColumns } from '../schedule';

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

  it('merges a cross-midnight schedule with an overlapping early-morning one', () => {
    const schedules = [
      { startTime: '00:30', endTime: '02:00' },
      { startTime: '22:00', endTime: '01:00' }, // wraps to 25:00, overlaps 00:30
    ];
    const groups = findConflictGroups(schedules);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
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
