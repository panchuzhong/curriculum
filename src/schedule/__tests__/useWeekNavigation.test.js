import { describe, it, expect } from 'vitest';
import { dateParam, fetchRange, getAllDates } from '../useWeekNavigation';
import { DATE_MIN, DATE_MAX } from '../../utils/constants';

// 周视图的两处边界钳制在 CLAUDE.md 里是明写的载重件，但一直没人钉：
// 去掉任意一处，整套测试都还是全绿，而用户看到的是一整屏空白课表。
describe('useWeekNavigation 的日期边界', () => {
  describe('dateParam：URL 参数越界就当没给', () => {
    it.each([DATE_MIN, DATE_MAX, '2026-05-11'])('范围内的 %s 原样通过', v => {
      expect(dateParam(v)).toBe(v);
    });

    // 服务端的 isValidDate 带着同一对上下限，放过去的话区间查询直接 400，
    // 整屏课表都没了——而地址栏里只是一个看着无害的 ?week=。
    it.each([
      ['下界外', '1899-12-31'],
      ['上界外', '3000-01-01'],
      ['四位以下', '1000-01-01'],
      ['五位年份', '10000-01-01'],
      ['不存在的日期', '2026-02-30'],
      ['不是日期', '2026'],
      ['空字符串', ''],
      ['null', null],
    ])('%s 的 %s 被挡下', (_label, v) => {
      expect(dateParam(v)).toBeNull();
    });
  });

  // getAllDates 的居中必须单独钉住：下面 fetchRange 的用例都拿 getAllDates 的输出
  // 自证，偏移一天照样全绿，而后果是表头（由 weekStart 算）和网格列（由 allDates 算）
  // 差一天——标题写着 05-25~05-31，格子里却是 05-26~06-01，之后每翻一页还继续漂。
  describe('getAllDates：中心日必须落在正中间', () => {
    const BUFFER = 7, TOTAL_COLS = 21;

    it.each(['2026-05-11', DATE_MIN, DATE_MAX, '2026-01-01'])('%s 居中且共 21 列', center => {
      const dates = getAllDates(center);
      expect(dates).toHaveLength(TOTAL_COLS);
      expect(dates[BUFFER]).toBe(center);
    });

    it('前后各多取 7 天，且逐日连续', () => {
      const dates = getAllDates('2026-05-11');
      expect(dates[0]).toBe('2026-05-04');
      expect(dates[TOTAL_COLS - 1]).toBe('2026-05-24');
      for (let i = 1; i < dates.length; i++) {
        const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000;
        expect(gap).toBe(1);
      }
    });
  });

  describe('fetchRange：±7 天的预取缓冲必须夹回合法区间', () => {
    it('中间的一周原样请求', () => {
      const dates = getAllDates('2026-05-11');
      expect(fetchRange(dates)).toEqual([dates[0], dates[dates.length - 1]]);
    });

    // 不夹的话边界那一周会把 1899-12-25 发出去，服务端 400，
    // 整个网格连范围内的那几天一起消失。
    it('贴着下界的一周，起点被夹到 DATE_MIN', () => {
      const dates = getAllDates(DATE_MIN);
      expect(dates[0] < DATE_MIN).toBe(true);
      expect(fetchRange(dates)[0]).toBe(DATE_MIN);
    });

    it('贴着上界的一周，终点被夹到 DATE_MAX', () => {
      const dates = getAllDates(DATE_MAX);
      expect(dates[dates.length - 1] > DATE_MAX).toBe(true);
      expect(fetchRange(dates)[1]).toBe(DATE_MAX);
    });

    it('夹完之后两端都在区间内，且起点不晚于终点', () => {
      for (const center of [DATE_MIN, DATE_MAX, '1900-01-05', '2999-12-28', '2026-05-11']) {
        const [start, end] = fetchRange(getAllDates(center));
        expect(start >= DATE_MIN).toBe(true);
        expect(end <= DATE_MAX).toBe(true);
        expect(start <= end).toBe(true);
      }
    });
  });
});
