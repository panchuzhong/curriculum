import { describe, it, expect, vi } from 'vitest';
import { getNavTarget } from '../navTarget';

function dates(overrides = {}) {
  const store = { ...overrides };
  return (view) => store[view] || null;
}

describe('getNavTarget', () => {
  describe('FROM week view', () => {
    const cp = '/';

    it('week → month: derives month from current week', () => {
      const result = getNavTarget('/monthly', cp, dates({ week: '2026-07-20' }));
      expect(result).toBe('/monthly?year=2026&month=6');
    });

    it('week → year: derives year from current week', () => {
      const result = getNavTarget('/yearly', cp, dates({ week: '2026-07-20' }));
      expect(result).toBe('/yearly?year=2026');
    });

    it('week → week: returns current week date', () => {
      const result = getNavTarget('/', cp, dates({ week: '2026-07-20' }));
      expect(result).toBe('/?date=2026-07-20');
    });

    it('week → classes: returns path unchanged (non-schedule target)', () => {
      const result = getNavTarget('/classes', cp, dates({ week: '2026-07-20' }));
      expect(result).toBe('/classes');
    });

    it('week → settings: returns path unchanged', () => {
      const result = getNavTarget('/settings', cp, dates({ week: '2026-07-20' }));
      expect(result).toBe('/settings');
    });

    it('week → month with no stored week: falls back to path', () => {
      const result = getNavTarget('/monthly', cp, dates({}));
      expect(result).toBe('/monthly');
    });
  });

  describe('FROM month view', () => {
    const cp = '/monthly';

    it('month → week (stored week matches month): preserves exact week via week= param', () => {
      // Week of July 13 2026, month = July (6)
      const result = getNavTarget('/', cp, dates({ month: '2026-6', week: '2026-07-13' }));
      expect(result).toBe('/?week=2026-07-13');
    });

    it('month → week (stored week in different month): derives from current month day 10', () => {
      // Stored week is April (month 3), but current month is July (6) — stale
      const result = getNavTarget('/', cp, dates({ month: '2026-6', week: '2026-04-06' }));
      expect(result).toBe('/?date=2026-07-10');
    });

    it('month → week (no stored week): uses day 10 of current month', () => {
      const result = getNavTarget('/', cp, dates({ month: '2026-6' }));
      expect(result).toBe('/?date=2026-07-10');
    });

    it('month → week (stored week matches Jan): uses week= for January', () => {
      const result = getNavTarget('/', cp, dates({ month: '2026-0', week: '2026-01-05' }));
      expect(result).toBe('/?week=2026-01-05');
    });

    it('month → week (stored week matches Dec): uses week= for December', () => {
      const result = getNavTarget('/', cp, dates({ month: '2026-11', week: '2026-12-07' }));
      expect(result).toBe('/?week=2026-12-07');
    });

    it('month → year: derives year from current month', () => {
      const result = getNavTarget('/yearly', cp, dates({ month: '2026-6' }));
      expect(result).toBe('/yearly?year=2026');
    });

    it('month → classes: returns path unchanged', () => {
      const result = getNavTarget('/classes', cp, dates({ month: '2026-6' }));
      expect(result).toBe('/classes');
    });

    it('month → month: returns month URL with stored value', () => {
      const result = getNavTarget('/monthly', cp, dates({ month: '2026-6' }));
      expect(result).toBe('/monthly?year=2026&month=6');
    });
  });

  describe('FROM year view', () => {
    const cp = '/yearly';

    it('year → week: prefers stored week in same year', () => {
      const result = getNavTarget('/', cp, dates({ year: '2026', week: '2026-08-03' }));
      expect(result).toBe('/?week=2026-08-03');
    });

    it('year → week: prefers stored month in same year when no week', () => {
      const result = getNavTarget('/', cp, dates({ year: '2026', month: '2026-7' }));
      expect(result).toBe('/?date=2026-08-10'); // July→August, day 10
    });

    it('year → week: ignores stored week from different year', () => {
      vi.setSystemTime(new Date('2026-05-26'));
      const result = getNavTarget('/', cp, dates({ year: '2026', week: '2025-12-01' }));
      expect(result).toBe('/?date=2026-05-26'); // falls back to today-in-year
      vi.useRealTimers();
    });

    it('year → week: uses today-in-year when no stored data', () => {
      vi.setSystemTime(new Date('2026-05-26'));
      const result = getNavTarget('/', cp, dates({ year: '2026' }));
      expect(result).toBe('/?date=2026-05-26');
      vi.useRealTimers();
    });

    it('year → month: prefers stored month in same year', () => {
      const result = getNavTarget('/monthly', cp, dates({ year: '2026', month: '2026-7' }));
      expect(result).toBe('/monthly?year=2026&month=7'); // August preserved
    });

    it('year → month: ignores stored month from different year', () => {
      vi.setSystemTime(new Date('2026-05-26'));
      const result = getNavTarget('/monthly', cp, dates({ year: '2026', month: '2025-3' }));
      expect(result).toBe('/monthly?year=2026&month=4'); // May
      vi.useRealTimers();
    });

    it('year → month: uses current month in year when no stored month', () => {
      vi.setSystemTime(new Date('2026-05-26'));
      const result = getNavTarget('/monthly', cp, dates({ year: '2026' }));
      expect(result).toBe('/monthly?year=2026&month=4'); // May
      vi.useRealTimers();
    });

    it('year → classes: returns path unchanged', () => {
      const result = getNavTarget('/classes', cp, dates({ year: '2026' }));
      expect(result).toBe('/classes');
    });

    it('year → year: returns year URL', () => {
      const result = getNavTarget('/yearly', cp, dates({ year: '2026' }));
      expect(result).toBe('/yearly?year=2026');
    });

    it('year → settings: returns path unchanged', () => {
      const result = getNavTarget('/settings', cp, dates({ year: '2026' }));
      expect(result).toBe('/settings');
    });
  });

  describe('FROM non-schedule views', () => {
    it('classes → month: uses stored month as fallback', () => {
      const result = getNavTarget('/monthly', '/classes', dates({ month: '2026-6' }));
      expect(result).toBe('/monthly?year=2026&month=6');
    });

    it('classes → week: uses stored week as fallback', () => {
      const result = getNavTarget('/', '/classes', dates({ week: '2026-07-20' }));
      expect(result).toBe('/?date=2026-07-20');
    });

    it('classes → year: uses stored year as fallback', () => {
      const result = getNavTarget('/yearly', '/classes', dates({ year: '2026' }));
      expect(result).toBe('/yearly?year=2026');
    });

    it('classes → students: returns path unchanged (both non-schedule)', () => {
      const result = getNavTarget('/students', '/classes', dates({}));
      expect(result).toBe('/students');
    });

    it('classes → students: returns path unchanged even with stored dates', () => {
      const result = getNavTarget('/students', '/classes', dates({ week: '2026-07-20', month: '2026-6' }));
      expect(result).toBe('/students');
    });
  });

  describe('Non-Monday weekStart preservation', () => {
    // Bug: stored weekStart could be a Tuesday (from 1-day ArrowRight navigation).
    // Using /?date= would re-process through getMonday() and shift backwards.
    // Using /?week= preserves the exact weekStart.

    it('returns /?week= for a Tuesday weekStart', () => {
      // Week start is Tuesday May 26 (from ArrowRight navigation)
      const result = getNavTarget('/', '/monthly', dates({ month: '2026-4', week: '2026-05-26' }));
      expect(result).toBe('/?week=2026-05-26');
    });

    it('returns /?week= for a Wednesday weekStart', () => {
      const result = getNavTarget('/', '/monthly', dates({ month: '2026-4', week: '2026-05-27' }));
      expect(result).toBe('/?week=2026-05-27');
    });
  });

  describe('No stored dates at all', () => {
    it('week target returns /', () => {
      expect(getNavTarget('/', '/', dates({}))).toBe('/');
    });

    it('month target returns /monthly', () => {
      expect(getNavTarget('/monthly', '/', dates({}))).toBe('/monthly');
    });

    it('year target returns /yearly', () => {
      expect(getNavTarget('/yearly', '/', dates({}))).toBe('/yearly');
    });
  });
});
