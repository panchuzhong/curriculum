import { describe, it, expect } from 'vitest';
import { toMin, calcDurationBilling, resolveRange, toCSV, detectConflictGroups } from '../services/schedule-helpers.js';

// ── toMin ──

describe('toMin', () => {
  it('converts HH:MM to minutes', () => {
    expect(toMin('00:00')).toBe(0);
    expect(toMin('01:30')).toBe(90);
    expect(toMin('12:00')).toBe(720);
    expect(toMin('23:59')).toBe(1439);
  });
});

// ── calcDurationBilling ──

describe('calcDurationBilling', () => {
  it('returns manual value when provided', () => {
    expect(calcDurationBilling('09:00', '10:00', 90)).toBe(90);
  });

  it('calculates normal difference', () => {
    expect(calcDurationBilling('09:00', '10:00', null)).toBe(60);
    expect(calcDurationBilling('09:00', '10:30', null)).toBe(90);
  });

  it('handles zero duration', () => {
    expect(calcDurationBilling('09:00', '09:00', null)).toBe(24 * 60);
  });

  it('handles end < start (cross-midnight)', () => {
    expect(calcDurationBilling('22:00', '01:00', null)).toBe(3 * 60);
    expect(calcDurationBilling('23:00', '00:30', null)).toBe(90);
  });

  it('handles full day span', () => {
    expect(calcDurationBilling('00:00', '00:00', null)).toBe(24 * 60);
  });
});

// ── resolveRange ──

describe('resolveRange', () => {
  it('passes through when no range param', () => {
    const q = { start: '2026-05-01', end: '2026-05-31' };
    expect(resolveRange(q)).toBe(q);
  });

  it('resolves range=today', () => {
    const q = { range: 'today' };
    const result = resolveRange(q);
    expect(result.start).toBe(result.end);
    expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('resolves range=tomorrow', () => {
    const q = { range: 'tomorrow' };
    const today = resolveRange({ range: 'today' });
    const tomorrow = resolveRange(q);
    expect(tomorrow.start).toBe(tomorrow.end);
    // Tomorrow should be one day after today
    const todayDate = new Date(today.start + 'T00:00:00');
    const tomorrowDate = new Date(tomorrow.start + 'T00:00:00');
    expect(tomorrowDate - todayDate).toBe(86400000);
  });

  it('resolves range=week', () => {
    const q = { range: 'week' };
    const result = resolveRange(q);
    const start = new Date(result.start + 'T00:00:00');
    const end = new Date(result.end + 'T00:00:00');
    expect(end - start).toBe(6 * 86400000); // 6 days diff = 7 day span
    // Start should be Monday
    expect(start.getDay()).toBe(1);
    // End should be Sunday
    expect(end.getDay()).toBe(0);
  });

  it('resolves range=month', () => {
    const q = { range: 'month' };
    const result = resolveRange(q);
    const d = new Date();
    expect(result.start).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  });
});

// ── toCSV ──

describe('toCSV', () => {
  it('generates CSV with BOM', () => {
    const csv = toCSV([['a', 'b'], ['c', 'd']]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toContain('"a","b"');
    expect(csv).toContain('"c","d"');
  });

  it('escapes double quotes', () => {
    const csv = toCSV([['he said "hello"']]);
    expect(csv).toContain('"he said ""hello"""');
  });

  it('prefixes formula-injection characters', () => {
    const csv = toCSV([['=SUM(A1:A10)']]);
    expect(csv).toContain("'=SUM(A1:A10)");

    const csv2 = toCSV([['+cmd']]);
    expect(csv2).toContain("'+cmd");

    const csv3 = toCSV([['-value']]);
    expect(csv3).toContain("'-value");

    const csv4 = toCSV([['@SUM']]);
    expect(csv4).toContain("'@SUM");
  });

  it('handles null and undefined', () => {
    const csv = toCSV([[null, undefined, '']]);
    expect(csv).toContain('"","",""');
  });

  it('handles numeric values', () => {
    const csv = toCSV([[42, 3.14, 0]]);
    expect(csv).toContain('"42","3.14","0"');
  });
});

// ── detectConflictGroups ──

describe('detectConflictGroups', () => {
  it('returns single group for single schedule', () => {
    const groups = detectConflictGroups([
      { startTime: '09:00', endTime: '10:00' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });

  it('returns separate groups for non-overlapping schedules', () => {
    const groups = detectConflictGroups([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '10:00', endTime: '11:00' },
      { startTime: '11:00', endTime: '12:00' },
    ]);
    expect(groups).toHaveLength(3);
    groups.forEach(g => expect(g).toHaveLength(1));
  });

  it('detects simple overlap', () => {
    const groups = detectConflictGroups([
      { startTime: '09:00', endTime: '11:00' },
      { startTime: '10:00', endTime: '12:00' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('detects triple overlap', () => {
    const groups = detectConflictGroups([
      { startTime: '09:00', endTime: '11:00' },
      { startTime: '10:00', endTime: '12:00' },
      { startTime: '10:30', endTime: '13:00' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('separates independent conflicts', () => {
    const groups = detectConflictGroups([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '09:30', endTime: '10:30' },
      { startTime: '14:00', endTime: '15:00' },
      { startTime: '14:30', endTime: '15:30' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(2);
  });

  it('handles cross-midnight schedule (end < start)', () => {
    const groups = detectConflictGroups([
      { startTime: '22:00', endTime: '01:00' }, // crosses midnight
      { startTime: '23:00', endTime: '23:30' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('returns empty for empty array', () => {
    expect(detectConflictGroups([])).toEqual([]);
  });
});
