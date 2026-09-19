import { describe, it, expect, vi, beforeEach } from 'vitest';

// 拦住 withBrowserPage，把 image-gen 生成的 HTML 截下来。
// 这一层是必需的：对着 blockGeometry() 本身写断言只钉住了那个函数，
// image-gen.js 把公式重新抄回去一遍照样全绿（第 27 轮评审正是这么发现
// duration() 的调用点没人钉的）。要钉的是「出图这条路真的走了共享函数」。
const captured = { html: null, viewport: null };
vi.mock('../services/image-helpers.js', async () => {
  const actual = await vi.importActual('../services/image-helpers.js');
  return {
    ...actual,
    withBrowserPage: vi.fn(async (html, viewport) => {
      captured.html = html;
      captured.viewport = viewport;
      return Buffer.from('89504e470d0a1a0a', 'hex');
    }),
  };
});

const { generateScheduleImage } = await import('../services/image-gen.js');
const { blockGeometry } = await import('../services/schedule-helpers.js');

const makeClass = (o = {}) => ({
  id: 1, name: '数学班', grade: '高三', subject: '数学',
  studentCount: 3, unitPrice: 200, discountAmount: 0, isCompetition: 0, ...o,
});
const makeSchedule = (o = {}) => ({
  id: 1, classId: 1, date: '2026-05-13', startTime: '09:00', endTime: '11:00',
  durationBilling: 120, locationName: '教室A', class: makeClass(), ...o,
});

// 只取课程块的高度：网格线用的是 top/height 之外的写法，按 background 区分太脆，
// 这里直接找带 background 的绝对定位块。
function blockHeights(html) {
  return [...html.matchAll(/position:absolute;top:([\d.]+)px;left:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)px;background:([^;]+);color:([^;]+);/g)]
    .map(m => ({ top: +m[1], left: +m[2], width: +m[3], height: +m[4], bg: m[5], fg: m[6] }));
}

const ROW_H = 40;
const render = (sched) => generateScheduleImage([sched], '2026-05-11', '2026-05-17', { theme: 'light', rowH: ROW_H });

beforeEach(() => { captured.html = null; });

describe('weekly PNG 的课程块几何与网页一致', () => {
  it('起止相同的课画成一行高，而不是覆盖整天', async () => {
    await render(makeSchedule({ startTime: '08:00', endTime: '08:00' }));
    const blocks = blockHeights(captured.html);
    expect(blocks).toHaveLength(1);
    // 抄回旧公式的话这里是 1440/60*40-1 = 959
    expect(blocks[0].height).toBe(ROW_H - 1);
  });

  it.each([
    ['普通两小时', '09:00', '11:00'],
    ['半小时', '09:00', '09:30'],
    ['起止相同', '08:00', '08:00'],
    ['跨零点', '23:00', '01:00'],
    ['比一行还短', '09:00', '09:05'],
  ])('%s（%s~%s）出图用的就是 blockGeometry 的高度', async (_label, startTime, endTime) => {
    await render(makeSchedule({ startTime, endTime }));
    const blocks = blockHeights(captured.html);
    expect(blocks).toHaveLength(1);
    // firstLabelMin 由最早的一节课决定（上限 8 点），TOP_GAP = 5/60 * rowH
    const firstLabelMin = Math.min(parseInt(startTime.split(':')[0], 10), 8) * 60;
    const expected = blockGeometry(startTime, endTime, {
      rowHeight: ROW_H, topGapHeight: 5 / 60 * ROW_H, firstLabelMin,
    });
    expect(blocks[0].top).toBeCloseTo(expected.top, 6);
    expect(blocks[0].height).toBeCloseTo(expected.height, 6);
  });
});

// 块底不能越过网格底边。这条和上面的几何断言是两回事：blockGeometry 有
// 「至少一行高」的下限，所以最后那一格里的短课算出来的高度会比剩下的空间还大，
// 必须靠 clippedH 收回去。第 28 轮把 `Math.min(h, totalH - clippedTop)` 改成
// `Math.min(h, totalH)`，整套 1226 全绿——导出的图里那一条会压出网格底线 20px，
// 而网页那边由 clipBlock 正确裁掉了。
describe('weekly PNG 的块不会画出网格底边', () => {
  // 容器写的是 totalH + 1，而裁剪用的是 totalH。直接拿容器高度当上界会留 1px 空子
  // ——第 29 轮把 `totalH - clippedTop` 改成 `totalH - clippedTop + 1` 就是从这里溜过去的。
  const gridHeight = (html) => {
    const m = html.match(/position:relative;width:[\d.]+px;height:([\d.]+)px/);
    return m ? +m[1] - 1 : null;
  };

  it.each([
    // 22:00~22:30：默认网格画到 22 点，最后一格只剩半行，而块至少一行高。
    ['末格里的半小时课', '22:00', '22:30'],
    ['末格里的 5 分钟课', '22:20', '22:25'],
    ['正常课', '09:00', '11:00'],
    ['起止相同', '22:00', '22:00'],
  ])('%s（%s~%s）的块底不越过网格底边', async (_label, startTime, endTime) => {
    await render(makeSchedule({ startTime, endTime }));
    const totalH = gridHeight(captured.html);
    expect(totalH).toBeGreaterThan(0);
    const blocks = blockHeights(captured.html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].top + blocks[0].height).toBeLessThanOrEqual(totalH);
  });

  // 确认上面那条不是空跑：末格里的短课确实需要被裁，否则断言无论怎么改都成立。
  it('末格里的短课确实触发了裁剪（否则上一条是空的）', async () => {
    await render(makeSchedule({ startTime: '22:00', endTime: '22:30' }));
    const uncut = blockGeometry('22:00', '22:30', {
      rowHeight: ROW_H, topGapHeight: 5 / 60 * ROW_H, firstLabelMin: 8 * 60,
    });
    const totalH = gridHeight(captured.html);
    expect(uncut.top + uncut.height).toBeGreaterThan(totalH);
    expect(blockHeights(captured.html)[0].height).toBeLessThan(uncut.height);
  });
});

const { generateYearlyImage } = await import('../services/image-gen-yearly.js');
const { getCategory, groupByGrade, resolveColor, COLLAPSE_LIMIT } =
  await import('../services/image-gen-yearly.js');

// 年度 PNG 同理：data-consistency 把四个函数和两个常量钉在两份实现之间，
// 但没有任何测试看过出图这条路真的用了它们。第 28 轮把
// `condensed = categoryEntries.length > COLLAPSE_LIMIT` 改成 `false`，整套 1226 全绿
// ——导出的年度图不再折叠，而网页还在折叠，两边对同一年给出不同的分组。
describe('yearly PNG 的分类折叠与配色走的就是共享实现', () => {
  // 造 n 个互不相同的类别，都在同一个月。
  const schedulesWithCategories = (n) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, classId: i + 1, date: '2026-03-02', startTime: '09:00', endTime: '10:00',
    durationBilling: 60 * (i + 1),
    class: { id: i + 1, name: `班${i}`, grade: '高三', subject: `科目${i}`, isCompetition: false },
  }));

  const chipLabels = (html) =>
    [...html.matchAll(/margin-bottom:3px">([^<]+?) [\d.]+h<\/span>/g)].map(m => m[1]);

  // 年度统计那一块的标签在一个嵌套的 <span> 里，上面的 chipLabels 里 [^<]+? 永远
  // 跨不过去——第 29 轮据此发现整个 yearCondensed 分支（image-gen-yearly.js:100、
  // 月卡那份的上一行）一个断言都没有：导出的年度统计可以不折叠、可以丢掉
  // 初中/高中/竞赛前缀，而网页那边照旧，1250 全绿。
  // width:80px 只出现在年度统计的标签上（月卡的 chip 是 inline-flex，没有固定宽），
  // 直接拿它当锚点，比按 "年度统计" 切块稳。
  const summaryLabels = (html) =>
    [...html.matchAll(/width:80px;text-align:right[^>]*>([^<]+)<\/span>/g)].map(m => m[1]);

  it('类别数不超过上限时，按类别原样列出', async () => {
    await generateYearlyImage(schedulesWithCategories(COLLAPSE_LIMIT), 2026, { theme: 'light' });
    const labels = chipLabels(captured.html);
    expect(labels).toHaveLength(COLLAPSE_LIMIT);
    expect(labels).toContain('高中科目0');
  });

  // 超过上限就折叠成年级。改成不折叠的话这里会看到 10 个学科标签而不是 1 个「高中」。
  it('类别数超过上限时，折叠成年级', async () => {
    await generateYearlyImage(schedulesWithCategories(COLLAPSE_LIMIT + 1), 2026, { theme: 'light' });
    expect(chipLabels(captured.html)).toEqual(['高中']);
  });

  it('折叠的标签和颜色都和共享实现算出来的一致', async () => {
    const scheds = schedulesWithCategories(COLLAPSE_LIMIT + 1);
    await generateYearlyImage(scheds, 2026, { theme: 'light' });

    const byCat = {};
    for (const s of scheds) {
      const cat = getCategory(s.class);
      byCat[cat] = (byCat[cat] || 0) + Math.abs(s.durationBilling) / 60;
    }
    const grouped = groupByGrade(Object.entries(byCat).sort((a, b) => b[1] - a[1]));

    expect(chipLabels(captured.html)).toEqual(grouped.map(g => g[0]));
    for (const [label, , dominantCat] of grouped) {
      expect(captured.html).toContain(`background:${resolveColor(label, dominantCat, false)}`);
    }
  });

  it('年度统计的类别数不超过上限时，按类别原样列出', async () => {
    await generateYearlyImage(schedulesWithCategories(COLLAPSE_LIMIT), 2026, { theme: 'light' });
    const labels = summaryLabels(captured.html);
    expect(labels).toHaveLength(COLLAPSE_LIMIT);
    expect(labels).toContain('高中科目0');
  });

  it('年度统计的类别数超过上限时，同样折叠成年级', async () => {
    await generateYearlyImage(schedulesWithCategories(COLLAPSE_LIMIT + 1), 2026, { theme: 'light' });
    expect(summaryLabels(captured.html)).toEqual(['高中']);
  });

  it('年度统计里竞赛班也单独成类', async () => {
    const base = schedulesWithCategories(1)[0];
    await generateYearlyImage([
      base,
      { ...base, id: 2, classId: 2, class: { ...base.class, id: 2, isCompetition: true } },
    ], 2026, { theme: 'light' });
    expect(new Set(summaryLabels(captured.html))).toEqual(new Set(['高中竞赛科目0', '高中科目0']));
  });

  // 条形长度是这张图唯一承载数量信息的东西。写死 100% 的话每条都一样长，
  // 图看着完全正常，只是不再表示任何东西（第 30 轮：两处都是绿的）。
  const summaryBarWidths = (html) =>
    [...html.matchAll(/height:100%;width:([\d.]+)%;background:[^;]+;border-radius:4px/g)].map(m => +m[1]);
  const cardSegmentWidths = (html) =>
    [...html.matchAll(/height:100%;width:([\d.]+)%;background:[^;]+;border-radius:3px/g)].map(m => +m[1]);

  it('年度统计的条长与课时成正比，不是每条都满格', async () => {
    // 课时 60/120/180 分钟 → 1/2/3 小时，最长那条才是 100%。
    await generateYearlyImage(schedulesWithCategories(3), 2026, { theme: 'light' });
    const widths = summaryBarWidths(captured.html);
    expect(widths).toHaveLength(3);
    expect(Math.max(...widths)).toBe(100);
    expect(new Set(widths).size, '每条都一样长，条形图没有携带任何信息').toBe(3);
    const sorted = [...widths].sort((a, b) => b - a);
    expect(sorted[1]).toBeCloseTo(100 * 2 / 3, 6);
    expect(sorted[2]).toBeCloseTo(100 * 1 / 3, 6);
  });

  it('月卡里的分段宽度按占比分，加起来是 100%', async () => {
    await generateYearlyImage(schedulesWithCategories(3), 2026, { theme: 'light' });
    const segs = cardSegmentWidths(captured.html);
    expect(segs).toHaveLength(3);
    expect(segs.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(new Set(segs).size, '每段都一样宽，占比条没有携带任何信息').toBe(3);
  });

  it('没有排课的月份显示「无排课」而不是一张空条形', async () => {
    // 只在 3 月排课，其余 11 个月都该是「无排课」。
    await generateYearlyImage(schedulesWithCategories(1), 2026, { theme: 'light' });
    const noClass = [...captured.html.matchAll(/无排课/g)];
    expect(noClass).toHaveLength(11);
  });

  // 折叠上限本身也要钉死一个数字：测试和 data-consistency 都是读常量算期望，
  // 两边一起改成 3 照样全绿（第 29 轮验证）。
  it('折叠上限就是 9，两边都是', async () => {
    expect(COLLAPSE_LIMIT).toBe(9);
    const { COLLAPSE_THRESHOLD_DESKTOP } = await import('../../src/schedule/YearlySchedule.jsx');
    expect(COLLAPSE_THRESHOLD_DESKTOP).toBe(9);
  });

  // 竞赛班必须和同年级的普通班分开计。getCategory 的前缀被摘掉的话两者合成一类，
  // 标签数就少一个。
  it('竞赛班单独成类，不和同年级普通班合并', async () => {
    const base = schedulesWithCategories(1)[0];
    await generateYearlyImage([
      base,
      { ...base, id: 2, classId: 2, class: { ...base.class, id: 2, isCompetition: true } },
    ], 2026, { theme: 'light' });
    expect(new Set(chipLabels(captured.html))).toEqual(new Set(['高中竞赛科目0', '高中科目0']));
  });
});

const { generateMonthlyImage } = await import('../services/image-gen-monthly.js');
const { duration } = await import('../services/schedule-helpers.js');

// 月历的条形几何两边也是手抄的两份，谁都没钉过（第 29 轮：把补的 24 小时改成
// 12 小时，1250 全绿）。而且两份都自己算时长、少了 duration() 的 s === e 分支，
// 于是 08:00~08:00 在月历里是一条覆盖整天的长条——周视图里同一节课只有一行高。
describe('monthly PNG 的条形几何', () => {
  const monthBars = (html) =>
    [...html.matchAll(/position:absolute;left:([\d.]+)px;top:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)px;background:/g)]
      .map(m => ({ left: +m[1], top: +m[2], width: +m[3], height: +m[4] }));

  const renderMonth = (...scheds) =>
    generateMonthlyImage(scheds, 2026, 4, { theme: 'light' });

  const sched = (o = {}) => ({
    id: 1, classId: 1, date: '2026-05-13', startTime: '09:00', endTime: '11:00',
    durationBilling: 120, class: makeClass(), ...o,
  });

  it('起止相同的课不画成整天，而是最小高度的一条', async () => {
    await renderMonth(sched({ startTime: '08:00', endTime: '08:00' }));
    const same = monthBars(captured.html);
    await renderMonth(sched({ startTime: '08:00', endTime: '07:59' }));
    const allDay = monthBars(captured.html);

    expect(same).toHaveLength(1);
    expect(allDay).toHaveLength(1);
    // 抄回旧公式的话这两个一样高（都按 1440 分钟算）。
    expect(same[0].height).toBeLessThan(allDay[0].height);
    expect(same[0].height).toBe(6); // Math.max(6, 0)
  });

  // 纵向比例尺（dayStart/dayTotal）是**逐日**算的，所以只有同一天的条高才可比。
  it('同一天内，条高与时长成正比', async () => {
    await renderMonth(
      sched({ id: 1, date: '2026-05-11', startTime: '09:00', endTime: '10:00' }),
      sched({ id: 2, date: '2026-05-11', startTime: '13:00', endTime: '15:00' }),
    );
    const [h1, h2] = monthBars(captured.html).map(b => b.height);
    expect(duration('09:00', '10:00')).toBe(60);
    expect(h2).toBeCloseTo(h1 * 2, 6);
  });

  it('跨零点的课按补满 24 小时算，和同长度的普通课一样高', async () => {
    // 同一天放一节 23:00~01:00 和一节 2 小时的普通课，日窗口是共用的。
    await renderMonth(
      sched({ id: 1, date: '2026-05-11', startTime: '09:00', endTime: '11:00' }),
      sched({ id: 2, date: '2026-05-11', startTime: '23:00', endTime: '01:00' }),
    );
    const [normal, midnight] = monthBars(captured.html).map(b => b.height);
    expect(duration('23:00', '01:00')).toBe(120);
    expect(midnight).toBeCloseTo(normal, 6);
  });

  // 日窗口那段自己也抄了一份时长公式。0 时长的课在那里被算成"上到次日同一时刻"，
  // 把当天的时间窗从 8:00~22:30 拉到 8:00~32:00，同一天其它课的条形全被压扁。
  it('起止相同的课不会把当天的时间窗撑开、压扁同一天的其它课', async () => {
    await renderMonth(sched({ id: 1, date: '2026-05-11', startTime: '09:00', endTime: '11:00' }));
    const alone = monthBars(captured.html)[0].height;

    await renderMonth(
      sched({ id: 1, date: '2026-05-11', startTime: '09:00', endTime: '11:00' }),
      sched({ id: 2, date: '2026-05-11', startTime: '08:00', endTime: '08:00' }),
    );
    const withZero = monthBars(captured.html).map(b => b.height);
    expect(Math.max(...withZero)).toBeCloseTo(alone, 6);
  });

  it('开始越晚，条形越靠下', async () => {
    await renderMonth(sched({ startTime: '09:00', endTime: '10:00' }));
    const early = monthBars(captured.html)[0].top;
    await renderMonth(sched({ startTime: '14:00', endTime: '15:00' }));
    expect(monthBars(captured.html)[0].top).toBeGreaterThan(early);
  });

  // 同一天两节冲突的课必须并排，而不是叠在一起。只比较两条宽度是否相等不够：
  // 两条都取整格宽时宽度照样相等，而它们会完全重叠（第 30 轮据此发现这条是空的）。
  it('冲突的课并排放，互不重叠', async () => {
    await renderMonth(
      sched({ startTime: '09:00', endTime: '11:00' }),
      sched({ id: 2, classId: 2, startTime: '10:00', endTime: '12:00', class: makeClass({ id: 2, name: '语文班' }) }),
    );
    const bars = monthBars(captured.html).sort((a, b) => a.left - b.left);
    expect(bars).toHaveLength(2);
    expect(bars[0].width).toBeCloseTo(bars[1].width, 6);
    expect(bars[0].left + bars[0].width, '两条冲突的条重叠了').toBeLessThanOrEqual(bars[1].left + 0.001);

    // 对照：不冲突时单独一条占的宽度约是上面两条之和。
    await renderMonth(sched({ startTime: '09:00', endTime: '11:00' }));
    const alone = monthBars(captured.html)[0];
    expect(alone.width).toBeGreaterThan(bars[0].width * 1.5);
  });

  // 条形不能压到写日期数字的那一行上去。
  it('条形从日期栏下方开始，不盖住日期数字', async () => {
    const HEADER_H_CELL = 22;
    await renderMonth(sched({ startTime: '08:00', endTime: '09:00' }));
    const [bar] = monthBars(captured.html);
    expect(bar.top).toBeGreaterThanOrEqual(HEADER_H_CELL);
  });

  it('今天那一格带「今」标记，别的月份没有', async () => {
    const { toLocalDateStr } = await import('../services/schedule-helpers.js');
    const today = toLocalDateStr(new Date());
    const [y, m] = today.split('-').map(Number);
    const { generateMonthlyImage: gen } = await import('../services/image-gen-monthly.js');

    await gen([sched({ date: today })], y, m - 1, { theme: 'light' });
    expect(captured.html).toContain('今');

    // 1900 年 1 月肯定不含今天。
    await gen([], 1900, 0, { theme: 'light' });
    expect(captured.html).not.toContain('今');
  });

});

// 上面的几何用例只渲染一节课，而且只看 top/height，所以横向定位、冲突标红和
// 暗色文字颜色整层都没人钉（第 29 轮：把 left 的 di 偏移改成 di+1、把 hasConflict
// 写死 false、把 getTextColor 的 isDark 取反，1250 全绿）。
describe('weekly PNG 的横向定位与配色', () => {
  const week = (...scheds) => generateScheduleImage(scheds, '2026-05-11', '2026-05-17', { theme: 'light', rowH: ROW_H });

  it('课落在自己那一天的列上，不整体偏移一天', async () => {
    // 周一和周二各一节，列间距应当等于一天的列宽，且周一那节不从时间轴列里出来。
    await week(
      makeSchedule({ id: 1, date: '2026-05-11' }),
      makeSchedule({ id: 2, date: '2026-05-12' }),
    );
    const [mon, tue] = blockHeights(captured.html);
    const colW = tue.left - mon.left;
    expect(colW).toBeGreaterThan(0);

    // 周一是本周第一天（di = 0），它的 left 就是时间轴列宽 + 1，不含任何天偏移。
    // di + 1 那种改动会让每节课都右移一整列。
    const timeColW = 64;
    expect(mon.left).toBeCloseTo(timeColW + 1, 6);
    expect(tue.left).toBeCloseTo(timeColW + colW + 1, 6);
  });

  it('周日那节课仍在网格内，不越过右边界', async () => {
    await week(makeSchedule({ id: 1, date: '2026-05-17' }));
    const [sun] = blockHeights(captured.html);
    const totalW = +captured.html.match(/position:relative;width:([\d.]+)px/)[1];
    expect(sun.left + sun.width).toBeLessThanOrEqual(totalW);
  });

  it('冲突的课标红并排，不冲突的用班级颜色', async () => {
    await week(
      makeSchedule({ id: 1, date: '2026-05-11', startTime: '09:00', endTime: '11:00' }),
      makeSchedule({ id: 2, date: '2026-05-11', startTime: '10:00', endTime: '12:00',
        class: makeClass({ id: 2, name: '语文班', subject: '语文' }) }),
    );
    const bars = blockHeights(captured.html);
    expect(bars).toHaveLength(2);
    for (const b of bars) expect(b.bg).toBe('#ef4444');
    expect(new Set(bars.map(b => b.left)).size).toBe(2);

    await week(makeSchedule({ id: 1, date: '2026-05-11' }));
    expect(blockHeights(captured.html)[0].bg).not.toBe('#ef4444');
  });

  // 冲突时每条占 1/totalCols 宽。改成整列宽的话两条会重叠，而且第二条会画到
  // 第二天的列里去——上面那条只比较两条的宽度是否相等，一样宽但都错照样通过。
  it('冲突的两条各占半列，且都不越进第二天的列', async () => {
    await week(
      makeSchedule({ id: 1, date: '2026-05-11', startTime: '09:00', endTime: '11:00' }),
      makeSchedule({ id: 2, date: '2026-05-11', startTime: '10:00', endTime: '12:00',
        class: makeClass({ id: 2, name: '语文班', subject: '语文' }) }),
      makeSchedule({ id: 3, date: '2026-05-12', startTime: '09:00', endTime: '10:00' }),
    );
    const bars = blockHeights(captured.html);
    expect(bars).toHaveLength(3);
    const tue = bars.find(b => b.bg !== '#ef4444');
    const conflicting = bars.filter(b => b.bg === '#ef4444').sort((a, b) => a.left - b.left);
    expect(conflicting).toHaveLength(2);

    // 两条都必须停在周二那一列的左边界之前。
    for (const c of conflicting) {
      expect(c.left + c.width, '冲突的条画进了第二天的列').toBeLessThanOrEqual(tue.left);
    }
    // 各占半列：两条宽度之和约等于一整列。
    const colW = tue.left - conflicting[0].left;
    expect(conflicting[0].width + conflicting[1].width).toBeLessThanOrEqual(colW);
    expect(conflicting[1].left).toBeGreaterThan(conflicting[0].left);
  });

  // 短块用单行紧凑排版，长块用多行。isShort 写死 false 的话短块也走多行分支。
  it('不足一行半的块用紧凑排版，长块不用', async () => {
    await week(makeSchedule({ id: 1, startTime: '09:00', endTime: '09:30' }));
    const short = captured.html;
    await week(makeSchedule({ id: 1, startTime: '09:00', endTime: '13:00' }));
    const tall = captured.html;
    // 紧凑排版用 white-space:nowrap，多行排版用 -webkit-line-clamp。
    expect(short).toContain('white-space:nowrap');
    expect(short).not.toContain('-webkit-line-clamp');
    expect(tall).toContain('-webkit-line-clamp');
  });

  // 今日高亮是一整列的底色条（pointer-events:none 那一条）。只比较两张 HTML
  // 是否不同没用——日期本来就不一样，怎么都不同。要认那一条本身，并核对它的位置。
  const todayStripes = (html) =>
    [...html.matchAll(/position:absolute;top:0;left:([\d.]+)px;width:([\d.]+)px;height:[\d.]+px;background:[^;]+;pointer-events:none/g)]
      .map(m => ({ left: +m[1], width: +m[2] }));

  it('今天那一列被高亮，且高亮的就是今天所在的那一列', async () => {
    const { toLocalDateStr } = await import('../services/schedule-helpers.js');
    const today = toLocalDateStr(new Date());
    const d = new Date(`${today}T00:00:00`);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const start = toLocalDateStr(monday);
    const end = toLocalDateStr(new Date(monday.getTime() + 6 * 86400000));
    const dayIdx = Math.round((d - monday) / 86400000);

    await generateScheduleImage([makeSchedule({ date: today })], start, end, { theme: 'light', rowH: ROW_H });
    const stripes = todayStripes(captured.html);
    expect(stripes, '本周里没有今日高亮').toHaveLength(1);

    const timeColW = 64;
    const colW = (stripes[0].width);
    expect(stripes[0].left).toBeCloseTo(timeColW + dayIdx * colW, 6);
  });

  it('不含今天的一周里没有今日高亮', async () => {
    // 1900 年那一周肯定不是本周。
    await generateScheduleImage([], '1900-01-01', '1900-01-07', { theme: 'light', rowH: ROW_H });
    expect(todayStripes(captured.html)).toHaveLength(0);
  });

  it('暗色主题用的是暗色下的文字颜色，不是亮色那套', async () => {
    const { getTextColor } = await import('../services/colors.js');
    const cls = makeClass();
    await generateScheduleImage([makeSchedule()], '2026-05-11', '2026-05-17', { theme: 'dark', rowH: ROW_H });
    expect(blockHeights(captured.html)[0].fg).toBe(getTextColor(cls, true));
    await generateScheduleImage([makeSchedule()], '2026-05-11', '2026-05-17', { theme: 'light', rowH: ROW_H });
    expect(blockHeights(captured.html)[0].fg).toBe(getTextColor(cls, false));
    expect(getTextColor(cls, true)).not.toBe(getTextColor(cls, false));
  });
});
