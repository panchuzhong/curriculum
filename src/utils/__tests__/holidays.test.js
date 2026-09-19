import { describe, it, expect, vi, afterEach } from 'vitest';

// 库里有这一年的节假日时，内置那份就整年作废——老师自己管了这一年，就该以他管的为准。
// 这条规则此前一条用例都没有：把 isHoliday/isWorkday 里的 hasDbData 两段整个删掉，
// 整套单测和 E2E 全绿。而它坏掉的后果是老师明明删掉了某个法定假（那天他要上课），
// 课表上照旧标着红色的「劳动节」。
const rows = { current: [] };
vi.mock('../../api.js', () => ({
  api: { getHolidays: async () => rows.current },
  getToken: () => 'test-token',
}));

// 模块在浏览器环境下才会去拉库里的数据（node 里 typeof window === 'undefined' 直接返回），
// 所以导入前先把这两个全局垫上。
async function loadWith(dbRows) {
  rows.current = dbRows;
  vi.resetModules();
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = {};
  const mod = await import('../holidays.js');
  // 导入时那次加载是异步的，等它落地——拿库里确实有的那天当探针。
  if (dbRows.length) {
    await vi.waitFor(() => expect(mod.isHoliday(dbRows[0].date)).toBe(true));
  }
  return mod;
}

describe('库里的节假日覆盖内置数据', () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.localStorage;
  });

  it('库里有 2026 的数据时，2026 的内置节假日整年作废', async () => {
    const { isHoliday, isWorkday } = await loadWith([
      { date: '2026-03-10', type: 'holiday', name: '自定义假' },
    ]);

    expect(isHoliday('2026-03-10')).toBe(true);   // 库里这条
    expect(isHoliday('2026-05-01')).toBe(false);  // 内置的劳动节，被整年盖掉
    expect(isWorkday('2026-01-04')).toBe(false);  // 内置的调休，同样盖掉
  });

  it('库里没有那一年的数据时，仍然用内置的', async () => {
    const { isHoliday, isWorkday } = await loadWith([
      { date: '2026-03-10', type: 'holiday', name: '自定义假' },
    ]);

    // 2025 一条库数据都没有，内置那份照常生效
    expect(isHoliday('2025-05-01')).toBe(true);
    expect(isWorkday('2025-01-26')).toBe(true);
  });

  it('一条库数据都没有时，两年都走内置', async () => {
    const { isHoliday } = await loadWith([]);
    expect(isHoliday('2026-05-01')).toBe(true);
    expect(isHoliday('2025-05-01')).toBe(true);
  });
});

// HOLIDAY_NAMES 是按「月-日」存的、混了各年份的一张表，所以没有内置数据的年份
// 不能去借别年的节名：2027 一条内置数据都没有，05-01 若直接查表就会说成「劳动节」，
// 可那一年的法定安排根本没录进来。服务端 services/holidays.js 有同样一段。
describe('没有内置数据的年份不借用别年的节名', () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.localStorage;
  });

  it('2026 有内置数据，05-01 叫得出名字', async () => {
    const { getHolidayName } = await loadWith([]);
    expect(getHolidayName('2026-05-01')).toBe('劳动节');
  });

  it('2027 没有内置数据，同一个月日只说「节假日」', async () => {
    const { getHolidayName } = await loadWith([]);
    expect(getHolidayName('2027-05-01')).toBe('节假日');
  });

  it('库里写了名字时以库里的为准', async () => {
    const { getHolidayName } = await loadWith([
      { date: '2027-05-01', type: 'holiday', name: '自定义劳动节' },
    ]);
    expect(getHolidayName('2027-05-01')).toBe('自定义劳动节');
  });
});
