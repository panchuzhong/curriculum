import { it, expect, vi, afterEach } from 'vitest';

const { getHolidays } = vi.hoisted(() => ({ getHolidays: vi.fn() }));
vi.mock('../../api.js', () => ({ api: { getHolidays }, getToken: () => 'same-token' }));
afterEach(() => vi.unstubAllGlobals());

it('an old holiday load cannot undo the refresh following an edit', async () => {
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', {});
  let oldResponse;
  getHolidays.mockReturnValueOnce(new Promise(resolve => { oldResponse = resolve; }));
  const holidays = await import('../holidays.js');
  getHolidays.mockResolvedValueOnce([{ date: '2026-11-02', name: '新的假日', type: 'holiday' }]);
  holidays.refreshHolidays();
  await vi.waitFor(() => expect(holidays.getHolidayName('2026-11-02')).toBe('新的假日'));
  oldResponse([{ date: '2026-11-02', name: '旧的假日', type: 'holiday' }]);
  await new Promise(resolve => setImmediate(resolve));
  expect(holidays.getHolidayName('2026-11-02')).toBe('新的假日');
});
