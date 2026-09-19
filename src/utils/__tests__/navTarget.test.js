import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNavTarget } from '../navTarget';

function dates(overrides = {}) {
  const store = { ...overrides };
  return (view) => store[view] || null;
}

afterEach(() => vi.useRealTimers());

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

    it('week → week: returns current week via week= param', () => {
      const result = getNavTarget('/', cp, dates({ week: '2026-07-20' }));
      expect(result).toBe('/?week=2026-07-20');
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
      vi.setSystemTime(new Date(2026, 4, 26));
      const result = getNavTarget('/', cp, dates({ year: '2026', week: '2025-12-01' }));
      expect(result).toBe('/?date=2026-05-26'); // falls back to today-in-year
    });

    it('year → week: uses today-in-year when no stored data', () => {
      vi.setSystemTime(new Date(2026, 4, 26));
      const result = getNavTarget('/', cp, dates({ year: '2026' }));
      expect(result).toBe('/?date=2026-05-26');
    });

    // weekAnchor 里的 clampDate 在别处一条用例都没盖到：把它整句删掉，
    // 整套用例全绿。而它拦的是一个真实的跨视图跳转：周视图停在最后一天时，
    // 锚点再往后推就出界，算出 year=3000；intParam 只能把它丢掉、退回今年。
    it('week → year: 锚点超出上限时夹回 2999，而不是算出 3000', () => {
      expect(getNavTarget('/yearly', '/', dates({ week: '2999-12-31' }))).toBe('/yearly?year=2999');
    });

    it('week → month: 锚点超出上限时夹回 2999-11', () => {
      expect(getNavTarget('/monthly', '/', dates({ week: '2999-12-31' }))).toBe('/monthly?year=2999&month=11');
    });

    it('year → week: 闰日贴到平年时收回到 2 月 28 日，而不是造出 2027-02-29', () => {
      vi.setSystemTime(new Date(2028, 1, 29));
      // 修复前拼出 '2027-02-29'——日历上不存在，dateParam 拒掉之后周视图
      // 静默停在本周，用户点的却是 2027 年。
      const result = getNavTarget('/', cp, dates({ year: '2027' }));
      expect(result).toBe('/?date=2027-02-28');
    });

    it('year → week: 闰年到闰年不收', () => {
      vi.setSystemTime(new Date(2028, 1, 29));
      const result = getNavTarget('/', cp, dates({ year: '2032' }));
      expect(result).toBe('/?date=2032-02-29');
    });

    it('year → month: prefers stored month in same year', () => {
      const result = getNavTarget('/monthly', cp, dates({ year: '2026', month: '2026-7' }));
      expect(result).toBe('/monthly?year=2026&month=7'); // August preserved
    });

    it('year → month: ignores stored month from different year', () => {
      vi.setSystemTime(new Date(2026, 4, 26));
      const result = getNavTarget('/monthly', cp, dates({ year: '2026', month: '2025-3' }));
      expect(result).toBe('/monthly?year=2026&month=4'); // May
    });

    it('year → month: uses current month in year when no stored month', () => {
      vi.setSystemTime(new Date(2026, 4, 26));
      const result = getNavTarget('/monthly', cp, dates({ year: '2026' }));
      expect(result).toBe('/monthly?year=2026&month=4'); // May
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

    it('classes → month: derives from stored week when stored month is missing', () => {
      const result = getNavTarget('/monthly', '/classes', dates({ week: '2026-08-03' }));
      expect(result).toBe('/monthly?year=2026&month=7');
    });

    it('classes → week: uses stored week as fallback via week= param', () => {
      const result = getNavTarget('/', '/classes', dates({ week: '2026-07-20' }));
      expect(result).toBe('/?week=2026-07-20');
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
  describe('Week spanning a month or year boundary', () => {
    // The week beginning Mon 2026-08-31 runs through Sun 2026-09-06, so it is
    // both "the last week of August" and "the week containing 2026-09-01".
    // Matching only its first day made Home-then-navigate land a month early.

    it('month → week: keeps a week that starts in the previous month', () => {
      const result = getNavTarget('/', '/monthly', dates({ month: '2026-8', week: '2026-08-31' }));
      expect(result).toBe('/?week=2026-08-31');
    });

    it('month → week: still keeps that week for the month it starts in', () => {
      const result = getNavTarget('/', '/monthly', dates({ month: '2026-7', week: '2026-08-31' }));
      expect(result).toBe('/?week=2026-08-31');
    });

    it('month → week: a week touching neither end is still rejected', () => {
      const result = getNavTarget('/', '/monthly', dates({ month: '2026-8', week: '2026-04-06' }));
      expect(result).toBe('/?date=2026-09-10');
    });

    it('week → month: prefers the stored month the span reaches into', () => {
      const result = getNavTarget('/monthly', '/', dates({ week: '2026-08-31', month: '2026-8' }));
      expect(result).toBe('/monthly?year=2026&month=8');
    });

    it('week → month: ignores a stored month the span cannot reach', () => {
      // Falls back to the month holding most of the week (Thu 09-03), not March.
      const result = getNavTarget('/monthly', '/', dates({ week: '2026-08-31', month: '2026-2' }));
      expect(result).toBe('/monthly?year=2026&month=8');
    });

    it('year → week: keeps a week that starts in the previous year', () => {
      const result = getNavTarget('/', '/yearly', dates({ year: '2027', week: '2026-12-28' }));
      expect(result).toBe('/?week=2026-12-28');
    });

    it('week → year: prefers the stored year the span reaches into', () => {
      const result = getNavTarget('/yearly', '/', dates({ week: '2026-12-28', year: '2027' }));
      expect(result).toBe('/yearly?year=2027');
    });

    it('week → year: ignores a stored year the span cannot reach', () => {
      const result = getNavTarget('/yearly', '/', dates({ week: '2026-12-28', year: '2030' }));
      expect(result).toBe('/yearly?year=2026');
    });

    // With no stored month/year to agree with, a straddling week belongs to the
    // period holding most of its days (its middle day), not its first day: a
    // fresh load on 2026-09-03 shows 08-31 ~ 09-06, and "this month" is September.
    it('week → month (no stored month): uses the month holding most of the week', () => {
      const result = getNavTarget('/monthly', '/', dates({ week: '2026-08-31' }));
      expect(result).toBe('/monthly?year=2026&month=8');
    });

    it('week → year (no stored year): uses the year holding most of the week', () => {
      // Mon 2025-12-29 .. Sun 2026-01-04: four days in 2026, Thursday is Jan 1.
      expect(getNavTarget('/yearly', '/', dates({ week: '2025-12-29' }))).toBe('/yearly?year=2026');
      // Mon 2026-12-28 .. Sun 2027-01-03: four days in 2026, Thursday is Dec 31.
      expect(getNavTarget('/yearly', '/', dates({ week: '2026-12-28' }))).toBe('/yearly?year=2026');
    });

    it('classes → month falls back through the week the same way', () => {
      const result = getNavTarget('/monthly', '/classes', dates({ week: '2026-08-31' }));
      expect(result).toBe('/monthly?year=2026&month=8');
    });
  });

  describe('Mobile: the week store is a bare day showing only two days', () => {
    const span = 2;

    it('month → week: rejects a stored week whose two days never reach the month', () => {
      // Aug 26–27 shows no September day, although a 7-day span would.
      const result = getNavTarget('/', '/monthly', dates({ month: '2026-8', week: '2026-08-26' }), span);
      expect(result).toBe('/?date=2026-09-10');
    });

    it('month → week: keeps a stored week whose second day reaches the month', () => {
      const result = getNavTarget('/', '/monthly', dates({ month: '2026-8', week: '2026-08-31' }), span);
      expect(result).toBe('/?week=2026-08-31');
    });

    it('year → week: rejects a stored week whose two days stay in the old year', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-12-31T12:00:00'));
      const result = getNavTarget('/', '/yearly', dates({ year: '2027', week: '2026-12-27' }), span);
      // No usable week or month: today's month/day in the target year.
      expect(result).toBe('/?date=2027-12-31');
    });

    it('week → month (no stored month): a two-day span belongs to its first day', () => {
      const result = getNavTarget('/monthly', '/', dates({ week: '2026-08-31' }), span);
      expect(result).toBe('/monthly?year=2026&month=7');
    });
  });
});
