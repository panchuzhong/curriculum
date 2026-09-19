import { describe, it, expect, vi } from 'vitest';
import { toMin, duration, calcDurationBilling, resolveRange, toCSV, detectConflictGroups, detectDatedConflictGroups, schedulesOverlap, toLocalDateStr, buildPricingLookup, escapeHtml, scheduleBounds } from '../services/schedule-helpers.js';

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
    expect(calcDurationBilling('22:00', '25:00', null)).toBe(3 * 60);
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

  // durationBilling: 0 是合法输入——四个校验器写的都是 isInt({ min: 0 })，
  // 表示这节课不计费（试听、补课等）。守卫写成 `if (manual)` 的话 0 会被当成"没给"，
  // 悄悄换成按时长算出来的分钟数，报表里的课时和金额就都变了，而且没有任何提示。
  it.each([
    ['显式 0 表示不计费，要原样保留', 0],
    ['显式 30 覆盖算出来的 120', 30],
  ])('%s', (_label, manual) => {
    expect(calcDurationBilling('09:00', '11:00', manual)).toBe(manual);
  });

  it('没给 manual 时才按起止时间算', () => {
    expect(calcDurationBilling('09:00', '11:00', null)).toBe(120);
    expect(calcDurationBilling('09:00', '11:00', undefined)).toBe(120);
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

  // 上面那条只断言「周一开头、周日结尾、跨 6 天」——把 day===0 那一支去掉
  // （星期天算成下一周）这三条依然全部成立，用例照样绿。真正缺的那条是
  // 「今天必须落在这个区间里」：少了它，星期天打开课表或导出 range=week 的图，
  // 拿到的是下一周的课，页面上看不出任何异常。
  it('任意一天的 range=week 都包含当天，并且从周一开始', () => {
    // 连扫 14 天，七种星期几都覆盖到，不用手算哪天是星期天
    for (let i = 0; i < 14; i++) {
      const iso = new Date(Date.UTC(2026, 8, 14 + i)).toISOString().slice(0, 10);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(`${iso}T12:00:00`));
      try {
        const r = resolveRange({ range: 'week' });
        expect({ iso, contains: r.start <= iso && iso <= r.end }).toEqual({ iso, contains: true });
        expect(new Date(`${r.start}T00:00:00`).getDay()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    }
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

  it('does not merge a same-date morning class with that night', () => {
    const groups = detectConflictGroups([
      { startTime: '00:30', endTime: '02:00' },
      { startTime: '22:00', endTime: '01:00' },
    ]);
    expect(groups).toHaveLength(2);
  });

  it('returns empty for empty array', () => {
    expect(detectConflictGroups([])).toEqual([]);
  });
});

describe('dated schedule conflicts', () => {
  const overnight = { date: '2026-05-04', startTime: '23:00', endTime: '01:00' };

  it('detects overlap on the following calendar day', () => {
    const morning = { date: '2026-05-05', startTime: '00:30', endTime: '02:00' };
    expect(schedulesOverlap(overnight, morning)).toBe(true);
    expect(detectDatedConflictGroups([overnight, morning])).toHaveLength(1);
  });

  it('does not treat the morning of the start date as an overlap', () => {
    const morning = { date: '2026-05-04', startTime: '00:30', endTime: '02:00' };
    expect(schedulesOverlap(overnight, morning)).toBe(false);
    expect(detectDatedConflictGroups([overnight, morning])).toHaveLength(2);
  });
});

describe('toMin — invalid inputs', () => {
  it('throws on undefined', () => {
    expect(() => toMin(undefined)).toThrow();
  });

  it('throws on null', () => {
    expect(() => toMin(null)).toThrow();
  });

  it('returns NaN for non-time string', () => {
    expect(toMin('not-a-time')).toBeNaN();
  });
});

describe('resolveRange — unknown range', () => {
  it('passes through for unknown range value', () => {
    const q = { range: 'unknown', start: '2026-05-01' };
    expect(resolveRange(q)).toBe(q);
  });
});

describe('toCSV — edge cases', () => {
  it('returns only BOM for empty array', () => {
    const csv = toCSV([]);
    expect(csv).toBe('﻿');
  });
});

// ── getTeacherSemesters cache ──

describe('getTeacherSemesters cache', () => {
  it('expires after 60s so edits from another process are eventually visible', async () => {
    vi.useFakeTimers();
    const { createTestDb } = await import('./setup.js');
    const t = createTestDb();
    const { teachers, semesters } = await import('../db/schema.js');
    const { getTeacherSemesters, clearSemesterCache } = await import('../services/schedule-helpers.js');
    try {
      t.drizzleDb.insert(teachers).values({ username: 'cache-t', passwordHash: 'h', name: 'T' }).run();
      t.drizzleDb.insert(semesters)
        .values({ teacherId: 1, name: '春', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' }).run();

      expect(getTeacherSemesters(t.drizzleDb, 1)).toHaveLength(1);

      // Another process sharing the file deletes the semester; this process's
      // explicit invalidation never fires. Before the TTL the entry lived
      // forever, so batch scheduling kept using the deleted boundaries.
      t.drizzleDb.delete(semesters).run();
      expect(getTeacherSemesters(t.drizzleDb, 1)).toHaveLength(1); // still cached

      vi.advanceTimersByTime(60_001);
      expect(getTeacherSemesters(t.drizzleDb, 1)).toHaveLength(0); // refreshed
    } finally {
      clearSemesterCache();
      t.db.close();
      vi.useRealTimers();
    }
  });
});

// 年份不补到 4 位的话，年份小于 1000 会算出 '261-04-30'，而库里存的是 '0261-05-01'：
// 按字符串比大小 '0261-...' 反而小于 '261-...'，拿它当区间端点就什么都匹配不到。
// getConflictsForSchedule 正是这么用的，而它的输入是直接从库里读的、不经校验。
describe('toLocalDateStr', () => {
  it('年份补齐到 4 位', () => {
    const d = new Date(2000, 0, 1);
    d.setFullYear(261, 4, 1);
    expect(toLocalDateStr(d)).toBe('0261-05-01');
  });

  it('普通年份不受影响', () => {
    expect(toLocalDateStr(new Date(2026, 8, 17))).toBe('2026-09-17');
  });

  // 按字符串比大小才是真正要守的性质：区间查询全靠它。
  it('补齐后的端点能把同年的日期圈进来', () => {
    const d = new Date(2000, 0, 1);
    d.setFullYear(261, 3, 30);
    const lo = toLocalDateStr(d);
    expect('0261-05-01' >= lo).toBe(true);
  });
});

// ── buildPricingLookup ──
//
// 这个函数此前没有任何直接用例，而它决定每节课按多少钱结算（/api/schedules/summary
// 的报表和 CSV 导出都走它）。算错不会报错，只会给出一个看着正常的金额。
describe('buildPricingLookup', () => {
  const p = (classId, effectiveFrom, unitPrice) => ({ classId, effectiveFrom, unitPrice, studentCount: 1, discountAmount: 0 });

  // 生效当天就该按新价：老师改价时填的是「从今天起」，而 <= 写成 < 的话，
  // 当天那节课仍按旧价结算，差额悄无声息。已有的路由用例排的课都严格晚于生效日。
  it('生效当天用新价，不是旧价', () => {
    const match = buildPricingLookup([p(1, '2026-01-01', 200), p(1, '2026-06-15', 300)]);
    expect(match(1, '2026-06-14').unitPrice).toBe(200);
    expect(match(1, '2026-06-15').unitPrice).toBe(300);  // 边界当天
    expect(match(1, '2026-06-16').unitPrice).toBe(300);
  });

  // matchPricing 顺序扫描并提前 break，所以依赖排序。查询没有 ORDER BY，行按 rowid 回来，
  // 老师一旦「补录」一条更早生效的价格，数组就是乱序的。
  it('补录的早期定价（输入乱序）也能算对', () => {
    const match = buildPricingLookup([p(1, '2026-09-18', 900), p(1, '2026-01-01', 1000)]);
    expect(match(1, '2026-06-01').unitPrice).toBe(1000);  // 不排序的话这里会是 null
    expect(match(1, '2026-10-01').unitPrice).toBe(900);   // 不排序的话这里会是 1000
  });

  it('早于最早一条生效日时没有匹配，交给调用方回落到班级默认价', () => {
    const match = buildPricingLookup([p(1, '2026-06-15', 300)]);
    expect(match(1, '2026-01-01')).toBeNull();
    expect(match(99, '2026-07-01')).toBeNull();
  });

  it('不同班级互不串档', () => {
    const match = buildPricingLookup([p(1, '2026-01-01', 200), p(2, '2026-01-01', 500)]);
    expect(match(1, '2026-07-01').unitPrice).toBe(200);
    expect(match(2, '2026-07-01').unitPrice).toBe(500);
  });
});

// ── escapeHtml ──
//
// 导出的 PNG 是拿字符串拼 HTML 再截图的。少一个转义项不会报错：正则照样匹配，
// 查表得到 undefined，替换出来就是字面量 'undefined'——班级名「李's 冲刺班」
// 会在每张导出图上印成「李undefineds 冲刺班」。已有的那条 XSS 用例只试了双引号。
describe('escapeHtml', () => {
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
  ])('转义 %s', (raw, encoded) => {
    expect(escapeHtml(raw)).toBe(encoded);
  });

  it('真实班级名里的单引号不会变成 undefined', () => {
    expect(escapeHtml("李's 冲刺班")).toBe('李&#39;s 冲刺班');
  });
});

// scheduleBounds 把 YYYY-MM-DD 折成一个分钟数，用来跨天比较。月份要减一（JS 的月是 0 起）。
// 减错了在同一个月内看不出来——所有日期一起平移，先后次序不变；可一旦跨月，
// 次序会颠倒（2026-01-31 会算成 3 月 3 日，而 2026-02-01 算成 3 月 1 日），
// 于是"月末那节跨午夜的课"和"次月 1 号一早的课"之间的冲突就检测不出来。
// 已有用例全都落在同一个月里，所以这条路一直没走到过。
describe('跨月 / 跨年的冲突检测', () => {
  const s = (date, startTime, endTime, id) => ({ id, date, startTime, endTime });

  it.each([
    ['跨月', s('2026-01-31', '23:00', '01:00', 1), s('2026-02-01', '00:30', '01:30', 2)],
    ['跨年', s('2026-12-31', '23:00', '01:00', 1), s('2027-01-01', '00:30', '01:30', 2)],
  ])('%s的跨午夜课与次日凌晨课算重叠', (_label, a, b) => {
    expect(schedulesOverlap(a, b)).toBe(true);
    expect(schedulesOverlap(b, a)).toBe(true);
    // 顺序颠倒也要归成同一组
    expect(detectDatedConflictGroups([b, a])).toHaveLength(1);
    expect(detectDatedConflictGroups([a, b])[0]).toHaveLength(2);
  });

  it.each([
    ['跨月', s('2026-01-31', '20:00', '21:00', 1), s('2026-02-01', '09:00', '10:00', 2)],
    ['跨年', s('2026-12-31', '20:00', '21:00', 1), s('2027-01-01', '09:00', '10:00', 2)],
  ])('%s但不挨着的两节课不算重叠', (_label, a, b) => {
    expect(schedulesOverlap(a, b)).toBe(false);
    // 这个函数返回所有分组（含只有一条的），所以"不冲突"表现为两个各含一条的组，
    // 而不是空数组。
    const groups = detectDatedConflictGroups([a, b]);
    expect(groups.map(g => g.length)).toEqual([1, 1]);
  });

  // 排序本身也得对：月末在前、次月在后。
  it('跨月排序不颠倒', () => {
    const jan = s('2026-01-31', '09:00', '10:00', 1);
    const feb = s('2026-02-01', '09:00', '10:00', 2);
    expect(scheduleBounds(jan)[0]).toBeLessThan(scheduleBounds(feb)[0]);
  });
});

// image-gen.js 曾经把这段算式抄在自己文件里，而且漏了 s === e 那一支：
// 08:00~08:00 在网页上是 0（一行高的块），在导出的 PNG 里却算成 1440，
// 画出一条覆盖整天的条。现在它直接用这个函数，所以这里直接把行为钉住。
describe('duration', () => {
  it.each([
    ['08:00', '10:00', 120],
    ['08:00', '09:30', 90],
    ['22:00', '08:00', 600],   // 跨午夜
    ['22:00', '25:00', 180],   // 24:00~47:59 的写法
    ['08:00', '08:00', 0],     // 零长度：不是整整一天
  ])('%s ~ %s = %i 分钟', (a, b, expected) => {
    expect(duration(a, b)).toBe(expected);
  });
});
