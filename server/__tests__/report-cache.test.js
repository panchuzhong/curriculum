import { describe, it, expect, beforeEach, vi } from 'vitest';

// The module reads its env vars once at import time, so each case needs a fresh
// module registry.
async function loadCache(env) {
  vi.resetModules();
  for (const key of ['REPORT_CACHE_TTL_MS', 'REPORT_CACHE_MAX_SIZE']) delete process.env[key];
  Object.assign(process.env, env);
  return import('../services/report-cache.js');
}

const params = (n = 1) => ({ teacherId: n, start: '2026-01-01', end: '2026-01-31' });

describe('report cache env parsing', () => {
  beforeEach(() => {
    delete process.env.REPORT_CACHE_TTL_MS;
    delete process.env.REPORT_CACHE_MAX_SIZE;
  });

  it('honors valid overrides', async () => {
    const c = await loadCache({ REPORT_CACHE_MAX_SIZE: '2' });
    c.setReportCache({ teacherId: 1, start: 'a', end: 'x' }, 1);
    c.setReportCache({ teacherId: 1, start: 'b', end: 'x' }, 2);
    c.setReportCache({ teacherId: 1, start: 'c', end: 'x' }, 3);
    expect(c.getReportCache({ teacherId: 1, start: 'a', end: 'x' })).toBeNull();
    expect(c.getReportCache({ teacherId: 1, start: 'c', end: 'x' })).toBe(3);
  });

  it('accepts an explicit TTL of 0 instead of falling back to the default', async () => {
    vi.useFakeTimers();
    const c = await loadCache({ REPORT_CACHE_TTL_MS: '0' });
    c.setReportCache(params(), { revenue: 1 });
    vi.advanceTimersByTime(1);
    expect(c.getReportCache(params())).toBeNull();
    vi.useRealTimers();
  });

  // A non-numeric value used to yield NaN, and every comparison against NaN is
  // false: entries never expired and the size cap never fired. Both failures
  // are silent, and .env.example documents these vars so a typo is realistic.
  it('falls back to the default TTL when the value is not a number', async () => {
    vi.useFakeTimers();
    const c = await loadCache({ REPORT_CACHE_TTL_MS: 'abc' });
    c.setReportCache(params(), { revenue: 1 });
    expect(c.getReportCache(params())).toEqual({ revenue: 1 });
    vi.advanceTimersByTime(61_000);
    expect(c.getReportCache(params())).toBeNull();
    vi.useRealTimers();
  });

  it('falls back to the default size cap when the value is not a number', async () => {
    const c = await loadCache({ REPORT_CACHE_MAX_SIZE: 'abc' });
    for (let i = 0; i < 150; i++) c.setReportCache({ teacherId: 9, start: `d${i}`, end: 'x' }, i);
    // With the cap disabled the very first entry would still be resident.
    expect(c.getReportCache({ teacherId: 9, start: 'd0', end: 'x' })).toBeNull();
  });

  it('falls back when the value is negative', async () => {
    const c = await loadCache({ REPORT_CACHE_TTL_MS: '-5' });
    c.setReportCache(params(), { revenue: 1 });
    expect(c.getReportCache(params())).toEqual({ revenue: 1 });
  });
});

describe('report cache eviction order', () => {
  it('evicts the least recently written entry, not the most refreshed one', async () => {
    vi.resetModules();
    process.env.REPORT_CACHE_MAX_SIZE = '2';
    const c = await import('../services/report-cache.js');
    const k = (n) => ({ teacherId: 1, start: n, end: 'x' });
    c.setReportCache(k('hot'), 1);
    c.setReportCache(k('cold'), 2);
    c.setReportCache(k('hot'), 3);      // refresh the hot entry
    c.setReportCache(k('new'), 4);      // pushes the cache over the cap
    expect(c.getReportCache(k('hot'))).toBe(3);   // must survive
    expect(c.getReportCache(k('cold'))).toBeNull();
    delete process.env.REPORT_CACHE_MAX_SIZE;
  });
});

// makeKey 的两个区分维度：classId 和 teacherId。少了哪一个都不会报错，
// 只会把别人的报表原样端出来，响应头还写着 X-Report-Cache: hit。
describe('report cache key separates the things it must', () => {
  const base = { teacherId: 1, start: '2026-01-01', end: '2026-01-31' };

  it('全部班级与单个班级的汇总不共用一条缓存', async () => {
    const c = await loadCache({});
    c.clearReportCache();
    c.setReportCache({ ...base }, { revenue: '全部班级' });

    // 带 classId 的是另一个请求，不能命中上面那条
    expect(c.getReportCache({ ...base, classId: 7 })).toBeNull();

    c.setReportCache({ ...base, classId: 7 }, { revenue: '七班' });
    expect(c.getReportCache({ ...base })).toEqual({ revenue: '全部班级' });
    expect(c.getReportCache({ ...base, classId: 7 })).toEqual({ revenue: '七班' });
  });

  it('不同教师不共用一条缓存', async () => {
    const c = await loadCache({});
    c.clearReportCache();
    c.setReportCache({ ...base, teacherId: 1 }, { revenue: 'A' });
    expect(c.getReportCache({ ...base, teacherId: 2 })).toBeNull();
  });

  // 按教师清理只能清掉他自己的：连别人的一起清不会出错，只是白白把别人的缓存丢掉，
  // 而这个函数在每次写操作后都会跑。
  it('按教师清理不碰别的教师', async () => {
    const c = await loadCache({});
    c.clearReportCache();
    c.setReportCache({ ...base, teacherId: 1 }, { revenue: 'A' });
    c.setReportCache({ ...base, teacherId: 2 }, { revenue: 'B' });

    c.clearReportCache(1);
    expect(c.getReportCache({ ...base, teacherId: 1 })).toBeNull();
    expect(c.getReportCache({ ...base, teacherId: 2 })).toEqual({ revenue: 'B' });
  });
});
