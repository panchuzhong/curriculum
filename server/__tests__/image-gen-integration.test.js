import { describe, it, expect, afterAll, vi } from 'vitest';
import { generateScheduleImage } from '../services/image-gen.js';
import { generateMonthlyImage } from '../services/image-gen-monthly.js';
import { generateYearlyImage } from '../services/image-gen-yearly.js';
import { closeBrowser, getBrowser } from '../services/browser.js';

afterAll(async () => {
  await closeBrowser();
});

function makeClass(overrides = {}) {
  return {
    id: 1,
    name: '数学班',
    grade: '高三',
    subject: '数学',
    studentCount: 3,
    unitPrice: 200,
    discountAmount: 0,
    isCompetition: 0,
    ...overrides,
  };
}

function makeSchedule(overrides = {}) {
  return {
    id: 1,
    classId: 1,
    date: '2026-05-13',
    startTime: '09:00',
    endTime: '11:00',
    durationBilling: 120,
    locationName: '教室A',
    ...overrides,
  };
}

describe('generateScheduleImage (Puppeteer integration)', () => {
  it.each(['weekly', 'monthly'])('escapes restored time values in %s images', async view => {
    const browser = await getBrowser();
    const newPage = browser.newPage.bind(browser);
    const messages = [];
    const spy = vi.spyOn(browser, 'newPage').mockImplementation(async () => {
      const page = await newPage();
      page.on('console', message => messages.push(message.text()));
      return page;
    });
    try {
      const schedules = [{ ...makeSchedule({
        endTime: '11:00"><script>console.log("audit-render-executed")</script>',
      }), class: makeClass() }];
      if (view === 'weekly') await generateScheduleImage(schedules, '2026-05-11', '2026-05-17');
      else await generateMonthlyImage(schedules, 2026, 4);
      expect(messages).not.toContain('audit-render-executed');
    } finally {
      spy.mockRestore();
    }
  });

  it('renders a half-scale PNG at half the full-scale dimensions', async () => {
    const full = await generateScheduleImage([], '2026-05-11', '2026-05-17', { scale: 1 });
    const half = await generateScheduleImage([], '2026-05-11', '2026-05-17', { scale: 0.5 });
    expect(half.readUInt32BE(16)).toBe(Math.round(full.readUInt32BE(16) / 2));
    expect(half.readUInt32BE(20)).toBe(Math.round(full.readUInt32BE(20) / 2));
  });

  // 周课表的尺寸算法（rowH 夹取、早课扩展网格、跨午夜、最小宽度）此前一条用例都没有：
  // 唯一的尺寸用例是半比例 vs 全比例，改动任何一处都会让两边同比例变化而照样通过。
  // 这些都从 PNG 头里读得出来（宽=16 偏移，高=20 偏移），不必为了测它去改生产代码。
  describe('尺寸算法', () => {
    const W = (b) => b.readUInt32BE(16);
    const H = (b) => b.readUInt32BE(20);
    const week = (scheds, opts) => generateScheduleImage(scheds, '2026-05-11', '2026-05-17', { scale: 1, ...opts });

    // rowH 直接来自 req.query.rowH，路由不校验，而 agent-help 把「16-60」写成了
    // 对外的接口约定——真正兜着的只有这一行夹取。
    it('rowH 被夹在 16~60：越界值与边界值出图一样高', async () => {
      const [tiny, low, huge, high, mid] = await Promise.all([
        week([], { rowH: 5 }), week([], { rowH: 16 }),
        week([], { rowH: 100000 }), week([], { rowH: 60 }),
        week([], { rowH: 40 }),
      ]);
      expect(H(tiny)).toBe(H(low));    // 夹到下限
      expect(H(huge)).toBe(H(high));   // 夹到上限
      // 对照：夹取本身不能把所有值都压成同一个高度
      expect(H(low)).not.toBe(H(high));
      expect(H(mid)).toBeGreaterThan(H(low));
      expect(H(mid)).toBeLessThan(H(high));
    });

    // 负数是「有值但越界」，夹到下限 16；非数字才是「没给值」，回落到默认 40。
    // （+(-20) || 40 得到 -20，不是 40——两者走的不是同一条路。）
    it('负数 rowH 夹到下限，非数字 rowH 才回落到默认值', async () => {
      const [neg, low, bad, def] = await Promise.all([
        week([], { rowH: -20 }), week([], { rowH: 16 }),
        week([], { rowH: 'abc' }), week([], { rowH: 40 }),
      ]);
      expect(H(neg)).toBe(H(low));
      expect(H(bad)).toBe(H(def));
      expect(H(low)).not.toBe(H(def));
    });

    // 默认网格从 08:00 起。有早于它的课时必须把网格往上扩，否则那节课的 top 算成负数、
    // 被 Math.max(0, top) 顶回去，画在 08:00 那一行——课表上的时间是错的。
    it('早于默认起点的课会把网格撑高', async () => {
      const cls = makeClass();
      const early = await week([{ ...makeSchedule({ startTime: '06:00', endTime: '07:00' }), class: cls }]);
      const normal = await week([{ ...makeSchedule({ startTime: '09:00', endTime: '10:00' }), class: cls }]);
      expect(H(early)).toBeGreaterThan(H(normal));
    });

    // 跨午夜：结束时间小于开始时间时要按次日算，否则网格不会为它留出空间。
    it('跨午夜的课会把网格撑高', async () => {
      const cls = makeClass();
      const overnight = await week([{ ...makeSchedule({ startTime: '23:00', endTime: '01:00' }), class: cls }]);
      const sameDay = await week([{ ...makeSchedule({ startTime: '23:00', endTime: '23:30' }), class: cls }]);
      expect(H(overnight)).toBeGreaterThan(H(sameDay));
    });

    // 单日导出也要有最小宽度，否则窄到没法看。
    it('单日导出不会窄于最小宽度', async () => {
      const oneDay = await generateScheduleImage([], '2026-05-11', '2026-05-11', { scale: 1 });
      expect(W(oneDay)).toBeGreaterThanOrEqual(600);
    });
  });

  it('returns a valid PNG buffer for a week with schedules', async () => {
    const cls = makeClass();
    const scheds = [
      makeSchedule({ date: '2026-05-11', startTime: '09:00', endTime: '11:00' }),
      makeSchedule({ date: '2026-05-13', startTime: '14:00', endTime: '16:00' }),
    ].map(s => ({ ...s, class: cls }));

    const buf = await generateScheduleImage(scheds, '2026-05-11', '2026-05-17');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x4e); // N
    expect(buf[3]).toBe(0x47); // G
  });

  it('works with no schedules (empty week)', async () => {
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
  });

  it('works with theme=dark', async () => {
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17', { theme: 'dark' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('works with fractional rowH producing integer viewport', async () => {
    const cls = makeClass();
    const scheds = [makeSchedule({ startTime: '07:30', endTime: '23:30' })].map(s => ({ ...s, class: cls }));
    // rowH=33 produces fractional totalH — the exact bug scenario
    const buf = await generateScheduleImage(scheds, '2026-05-11', '2026-05-17', { rowH: 33 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('works with conflicting schedules', async () => {
    const cls1 = makeClass({ id: 1, name: '数学班' });
    const cls2 = makeClass({ id: 2, name: '物理班', subject: '物理', grade: '高二' });
    const scheds = [
      { ...makeSchedule({ classId: 1, date: '2026-05-13', startTime: '09:00', endTime: '11:00' }), class: cls1 },
      { ...makeSchedule({ id: 2, classId: 2, date: '2026-05-13', startTime: '09:30', endTime: '11:30' }), class: cls2 },
    ];
    const buf = await generateScheduleImage(scheds, '2026-05-11', '2026-05-17');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('respects highlight parameter', async () => {
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17', { highlight: '2026-05-13' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('respects scale parameter', async () => {
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17', { scale: 1 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('falls back to the default scale for non-numeric scale instead of failing', async () => {
    // NaN used to leak into deviceScaleFactor and crash Puppeteer (HTTP 500)
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17', { scale: 'abc' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });
});

// 年度导出此前一行都没跑过：唯一的调用方是 schedule-image 路由，而那个路由的用例
// 把整个模块 vi.mock 掉了。整整 220 行（学科归类、按年级分组、折叠上限、条宽计算、
// withBrowserPage 的截取区域）在整套测试里从未执行——正是 6017e91 那次"空白 PNG"
// 出问题的同一类代码。这里让它真的跑起来。
describe('generateYearlyImage (Puppeteer integration)', () => {
  const W = (b) => b.readUInt32BE(16);
  const H = (b) => b.readUInt32BE(20);
  const isPng = (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  it('没有排课时也出一张有效的 PNG，而不是空白或报错', async () => {
    const buf = await generateYearlyImage([], 2026);
    expect(isPng(buf)).toBe(true);
    expect(W(buf)).toBeGreaterThan(0);
    expect(H(buf)).toBeGreaterThan(0);
  });

  it('有排课时出图，且比空年份更高（统计区真的渲染了）', async () => {
    const cls = makeClass();
    const scheds = [
      { ...makeSchedule({ date: '2026-03-10' }), class: cls },
      { ...makeSchedule({ id: 2, date: '2026-07-02' }), class: cls },
      { ...makeSchedule({ id: 3, date: '2026-11-20' }), class: makeClass({ id: 2, name: '英语班', subject: '英语', grade: '高一' }) },
    ];
    const withData = await generateYearlyImage(scheds, 2026);
    const empty = await generateYearlyImage([], 2026);

    expect(isPng(withData)).toBe(true);
    expect(H(withData)).toBeGreaterThan(H(empty));
  });

  // 多年份是纵向堆叠的：两年必须比一年高，否则 endYear 实际没生效（空白图的老毛病）。
  it('多年份纵向堆叠，两年比一年高', async () => {
    const [one, two] = await Promise.all([
      generateYearlyImage([], 2026),
      generateYearlyImage([], 2026, { endYear: 2027 }),
    ]);
    expect(H(two)).toBeGreaterThan(H(one));
    expect(W(two)).toBe(W(one));
  });

  it('深色主题同样出图', async () => {
    const buf = await generateYearlyImage([], 2026, { theme: 'dark' });
    expect(isPng(buf)).toBe(true);
    expect(H(buf)).toBeGreaterThan(0);
  });
});

// Chromium 超过约 1.3e8 设备像素就会画不出东西——4 倍缩放的月度导出排到第七个月
// 左右开始整张空白（6017e91 修的就是这个）。修法是把缩放按半档降到装得下为止。
// 此前只有 fitDeviceScaleFactor 那点纯算术有用例，"算出来的低缩放有没有真的被应用"
// 和"量的是不是真实高度"两件事都没人管：把 setViewport 那一行删掉、或者把
// cssHeight 写死成 800，整套测试照样全绿，而导出的图又变回空白。
describe('超长导出不会画成空白图', () => {
  const W = (b) => b.readUInt32BE(16);
  const H = (b) => b.readUInt32BE(20);
  const isPng = (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const MAX_DEVICE_PIXELS = 1.2e8;

  it('24 个月的月度导出仍是有效 PNG，且设备像素不超过上限', async () => {
    const buf = await generateMonthlyImage([], 2026, 0, { endYear: 2027, endMonth: 11 });
    expect(isPng(buf)).toBe(true);
    expect(W(buf)).toBeGreaterThan(0);
    expect(H(buf)).toBeGreaterThan(0);
    expect(W(buf) * H(buf)).toBeLessThanOrEqual(MAX_DEVICE_PIXELS);
  }, 60000);

  // 对照：短的导出不该被降缩放，否则上面那条也可能只是"所有图都被压小了"。
  it('单月导出仍按 4 倍缩放出图', async () => {
    const one = await generateMonthlyImage([], 2026, 0);
    const twelve = await generateMonthlyImage([], 2026, 0, { endYear: 2026, endMonth: 11 });

    expect(isPng(one)).toBe(true);
    expect(W(one) * H(one)).toBeLessThanOrEqual(MAX_DEVICE_PIXELS);
    // 单月没被降，12 个月被降了：两者的"每月高度"不该相等
    expect(H(twelve) / 12).toBeLessThan(H(one));
  }, 60000);
});
