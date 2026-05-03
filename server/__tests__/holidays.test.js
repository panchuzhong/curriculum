import { describe, it, expect } from 'vitest';
import { isHoliday, getHolidaysForYear } from '../services/holidays.js';

describe('isHoliday', () => {
  it('returns true for a known holiday', () => {
    expect(isHoliday('2025-01-01')).toBe(true);
    expect(isHoliday('2025-10-01')).toBe(true);
  });

  it('returns false for a regular day', () => {
    expect(isHoliday('2025-03-15')).toBe(false);
  });

  it('returns false for unknown year', () => {
    expect(isHoliday('2030-01-01')).toBe(false);
  });

  it('handles date format correctly', () => {
    // 2026 Spring Festival: Feb 16-22
    expect(isHoliday('2026-02-16')).toBe(true);
    expect(isHoliday('2026-02-15')).toBe(false);
    expect(isHoliday('2026-02-23')).toBe(false);
  });
});

describe('getHolidaysForYear', () => {
  it('returns holidays for known year', () => {
    const h = getHolidaysForYear(2025);
    expect(h.length).toBeGreaterThan(0);
    expect(h).toContain('01-01');
  });

  it('returns empty array for unknown year', () => {
    expect(getHolidaysForYear(2030)).toEqual([]);
  });
});
