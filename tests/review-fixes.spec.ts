import { test, expect } from './auth';
import type { Page } from '@playwright/test';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const profile = { id: 1, username: 'review', name: 'Review', apiKey: 'mask', subjects: ['英语', '物理'] };
const cls = { id: 801, name: '跨夜回归班', grade: '初三', subject: '英语', studentCount: 1, unitPrice: 100, isCompetition: false };
const lesson = (id: number, date: string, startTime: string, endTime: string, durationBilling = 60) =>
  ({ id, classId: cls.id, date, startTime, endTime, durationBilling, class: cls });
const night = lesson(901, '2026-09-30', '23:00', '01:00', 120);
const morning = lesson(902, '2026-10-01', '00:30', '02:00', 90);

async function mockSchedules(page: Page, rows: object[]) {
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  await page.route('**/api/schedules?**', route => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: rows.filter((s: any) => s.date >= params.get('start')! && s.date <= params.get('end')!) });
  });
}

const classField = (page: Page, label: string) => page.locator('label').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('input');

test('学科加载前不能保存；加载后保存保留已有学科，保存期间不能继续改动', async ({ authenticatedPage: page }) => {
  const loading = gate(), saving = gate();
  let payload: any;
  await page.route('**/api/auth/profile', async route => {
    await loading.promise;
    await route.fulfill({ json: profile });
  });
  await page.route('**/api/auth/subjects', async route => {
    payload = route.request().postDataJSON();
    await saving.promise;
    await route.fulfill({ json: payload });
  });
  try {
    await page.goto('/settings');
    const subjectSection = page.getByRole('heading', { name: '学科管理' }).locator('..');
    await expect(subjectSection.getByRole('status')).toHaveText('正在加载学科…');
    await expect(page.getByRole('button', { name: '保存学科设置' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '+ 数学', exact: true })).toBeDisabled();
    loading.release();
    await page.getByRole('button', { name: '+ 数学', exact: true }).click();
    await page.getByRole('button', { name: '保存学科设置' }).click();
    await expect(page.getByRole('button', { name: '保存中…' })).toBeDisabled();
    await expect(page.getByPlaceholder('自定义学科名称')).toBeDisabled();
    await expect.poll(() => payload).toEqual({ subjects: ['英语', '物理', '数学'] });
    saving.release();
    await expect(page.getByRole('button', { name: '✓ 已保存' })).toBeEnabled();
    await page.getByRole('button', { name: '+ 化学', exact: true }).click();
    // 超时必须短于 save() 自己的 3 秒计时器：默认的 5 秒重试会一直等到计时器把提示收掉，
    // 删掉「改动后清掉已保存」那个 effect 也照样通过。
    await expect(page.getByText('学科设置已更新', { exact: true })).toHaveCount(0, { timeout: 1000 });
  } finally { loading.release(); saving.release(); }
});

test('连续两次保存，后一次的「已保存」不会被前一次的计时器提前收走', async ({ authenticatedPage: page }) => {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/auth/subjects', route => route.fulfill({ json: route.request().postDataJSON() }));
  // 页面时钟由测试来推，不真睡：真睡的话两次点击之间、断言之前任何一次一秒多的卡顿，
  // 都会让 3 秒计时器先到点，用例和修复无关地挂掉。
  await page.clock.install();
  await page.goto('/settings');
  const done = page.getByText('学科设置已更新', { exact: true });
  await page.getByRole('button', { name: '保存学科设置' }).click();
  await expect(done).toBeVisible();
  // 停在「此刻稍后」：从读到页面时间到 pauseAt 生效，页面时钟还在走，停在读到的那一刻就成了往回拨。
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 200);
  await page.clock.runFor(1500);
  await page.getByRole('button', { name: '✓ 已保存' }).click();
  // 点下去先变回「保存学科设置」，第二次保存落地才又是「✓ 已保存」。
  await expect(page.getByRole('button', { name: '✓ 已保存' })).toBeVisible();
  // 第一次保存的 3 秒已经到点（没清计时器的话提示已被收走），第二次的还剩一秒多。
  await page.clock.runFor(1800);
  await expect(done).toBeVisible();
  // 第二次的 3 秒到点后照常收起。
  await page.clock.runFor(1300);
  await expect(done).toHaveCount(0);
});

test('学科加载失败时保持禁用，重试成功后才允许保存', async ({ authenticatedPage: page }) => {
  let failing = true;
  await page.route('**/api/auth/profile', route => route.fulfill(failing
    ? { status: 503, json: { error: '资料暂不可用' } } : { json: profile }));
  await page.goto('/settings');
  const section = page.getByRole('heading', { name: '学科管理' }).locator('..');
  await expect(section.getByRole('alert')).toContainText('资料暂不可用');
  await expect(page.getByRole('button', { name: '保存学科设置' })).toBeDisabled();
  failing = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存学科设置' })).toBeEnabled();
  await expect(section.getByText('英语', { exact: true })).toBeVisible();
  await expect(section.getByText('物理', { exact: true })).toBeVisible();
});

test('地点变更后提示旧坐标，迟到的旧地点结果不能覆盖新坐标', async ({ authenticatedPage: page }) => {
  const old = gate();
  let oldRequested = false;
  let saved: any;
  await page.route('**/api/geocode/status', route => route.fulfill({ json: { available: true } }));
  await page.route('**/api/geocode?**', async route => {
    if (new URL(route.request().url()).searchParams.get('address') === '上海') {
      oldRequested = true;
      await old.promise;
      await route.fulfill({ json: { lat: 31.2, lng: 121.4 } });
    } else await route.fulfill({ json: { lat: 39.9, lng: 116.4 } });
  });
  await page.route('**/api/classes', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { ...saved, id: 9901 } });
  });
  try {
    await page.goto('/classes');
    await page.getByRole('button', { name: /新建班级/ }).click();
    await classField(page, '班级名称').fill('地理编码回归班');
    const name = classField(page, '默认上课地点');
    const lat = classField(page, '纬度（可选）');
    const lng = classField(page, '经度（可选）');
    await name.fill('上海');
    await lat.fill('30'); await lng.fill('120');
    await page.getByRole('button', { name: '获取经纬度' }).click();
    await expect.poll(() => oldRequested).toBe(true);
    await name.fill('北京');
    // 改地点不清坐标（同一地点补个楼层很常见），而是说清楚坐标是按哪个地点填的。
    await expect(lat).toHaveValue('30'); await expect(lng).toHaveValue('120');
    const stale = page.getByText('经纬度是按「上海」填的，地点换了的话请重新获取或手动修改');
    await expect(stale).toBeVisible();
    await page.getByRole('button', { name: '获取经纬度' }).click();
    await expect(lat).toHaveValue('39.9');
    await expect(stale).toHaveCount(0);
    const delivered = page.waitForResponse(r => r.url().includes('/api/geocode?') && new URL(r.url()).searchParams.get('address') === '上海');
    old.release();
    await (await delivered).finished();
    await page.waitForTimeout(100); // 让旧 fetch 的状态更新有机会提交，防止负断言抢跑。
    await expect(lat).toHaveValue('39.9'); await expect(lng).toHaveValue('116.4');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => saved?.defaultLocationName).toBe('北京');
    expect(Number(saved.defaultLocationLat)).toBe(39.9);
    expect(Number(saved.defaultLocationLng)).toBe(116.4);
  } finally { old.release(); }
});

test('没有地理编码时改地点保留坐标并提示手动修改', async ({ authenticatedPage: page }) => {
  let saved: any;
  await page.route('**/api/geocode/status', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/classes', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { ...saved, id: 9902 } });
  });
  await page.goto('/classes');
  await page.getByRole('button', { name: /新建班级/ }).click();
  await classField(page, '班级名称').fill('坐标保留回归班');
  const name = classField(page, '默认上课地点');
  await name.fill('徐汇校区');
  await classField(page, '纬度（可选）').fill('31.18');
  await classField(page, '经度（可选）').fill('121.43');
  await name.fill('徐汇校区3楼');
  // 没有「获取经纬度」按钮，提示里就不能叫人去「重新获取」。
  await expect(page.getByText('经纬度是按「徐汇校区」填的，地点换了的话请手动修改')).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => saved?.defaultLocationName).toBe('徐汇校区3楼');
  expect(Number(saved.defaultLocationLat)).toBe(31.18);
  expect(Number(saved.defaultLocationLng)).toBe(121.43);
});

for (const view of ['week', 'month'] as const) {
  test(`${view} 视图：加载失败保留错误，重试恢复当前日期范围`, async ({ authenticatedPage: page }) => {
    const held = gate();
    let failing = true;
    const requested: string[] = [];
    await page.route('**/api/schedules?**', async route => {
      const q = new URL(route.request().url()).searchParams;
      requested.push(`${q.get('start')}~${q.get('end')}`);
      if (failing) {
        await held.promise;
        await route.fulfill({ status: 503, json: { error: '课表暂不可用' } });
      } else await route.fulfill({ json: [lesson(910, '2026-10-09', '09:00', '10:00')] });
    });
    try {
      await page.goto(view === 'week' ? '/?week=2026-10-05' : '/monthly?year=2026&month=9');
      await expect(page.getByRole('status')).toHaveText('正在加载课表…');
      held.release();
      await expect(page.getByRole('alert')).toContainText('课表暂不可用');
      // 超过 toast 的三秒，错误仍然可见。
      await page.waitForTimeout(3100);
      await expect(page.getByRole('alert')).toBeVisible();
      failing = false;
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.locator('main').getByText(cls.name, { exact: true }).first()).toBeVisible();
      // mock 不看范围、成功时总给这一节课，所以上面那句证明不了重试查的是哪一段，得看请求本身。
      // 周：10-05 那一周的 21 列是 09-28 ~ 10-18，两头再各多一天看跨午夜冲突；月：同理是月首前一天到月末后一天。
      const range = view === 'week' ? '2026-09-27~2026-10-19' : '2026-09-30~2026-11-01';
      expect(requested).toEqual([range, range]);
    } finally { held.release(); }
  });
}

// 加载时课表照常显示，提示不接触摸。之前网格整个藏起来、提示盖在上面：每次翻页都空白一个
// 往返；手势从提示上开始、请求又在中途回来的话，提示被卸载，Chromium 之后的 touchmove/touchend
// 只发给那个脱离文档的节点，周视图的滑动监听收不到结尾，网格停在半路、取回的数据一直不落地。
for (const view of ['week', 'month'] as const) {
  test(`${view} 视图：加载时课表照常显示，提示不挡触摸`, async ({ authenticatedPage: page }) => {
    const held = gate();
    let hold = false;
    await mockSchedules(page, [lesson(913, '2026-10-08', '09:00', '10:00')]);
    await page.route('**/api/schedules?**', async route => {
      if (hold) await held.promise;
      await route.fallback();
    });
    try {
      await page.goto(view === 'week' ? '/?week=2026-10-05' : '/monthly?year=2026&month=9');
      const shown = view === 'week'
        ? page.locator('[data-date="2026-10-08"]').getByText(cls.name, { exact: true })
        : page.locator('main').getByText('周一', { exact: true });
      await expect(shown).toBeVisible();
      hold = true;
      await page.getByRole('button', { name: view === 'week' ? '后一天' : '下月', exact: true }).click();
      const status = page.getByRole('status');
      await expect(status).toHaveText('正在加载课表…');
      // 周：10-08 那节课在缓冲里，往后翻一天它还在屏上；月：新月份的网格不被换成一行字。
      await expect(shown).toBeVisible();
      const box = (await status.boundingBox())!;
      const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role="status"]'),
        [box.x + box.width / 2, box.y + box.height / 2]);
      expect(hit).toBe(false);
      held.release();
      await expect(status).toHaveCount(0);
    } finally { held.release(); }
  });
}

// 保存后新数据回来之前，屏上那节课还是改动之前的样子。加载时网格照常能点（翻页时缓冲里的课
// 是新的），但写入之后的这一段不行：拿旧行回填弹窗、再保存一次，会把刚做的修改写回去。
test('周视图：保存后新数据回来之前，点旧课块不会拿改动前的数据打开弹窗', async ({ authenticatedPage: page }) => {
  const held = gate();
  let hold = false;
  let current: any = lesson(940, '2026-10-06', '09:00', '10:00');
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  await page.route('**/api/schedules?**', async route => {
    if (hold) await held.promise;
    await route.fulfill({ json: [current] });
  });
  await page.route('**/api/schedules/940', async route => {
    if (route.request().method() !== 'PUT') { await route.fallback(); return; }
    current = { ...current, ...route.request().postDataJSON(), class: cls };
    hold = true;
    await route.fulfill({ json: current });
  });
  try {
    await page.goto('/?week=2026-10-05');
    const block = page.locator('[data-date="2026-10-06"] div.absolute.rounded-md.cursor-pointer');
    const heading = page.getByRole('heading', { name: '编辑排课' });
    await block.click();
    await page.getByPlaceholder(/地点/).fill('新地点');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(heading).toHaveCount(0);
    await block.click();
    await expect(page.getByText('课表正在刷新，请稍后再点')).toBeVisible();
    expect(await heading.count()).toBe(0);
    held.release();
    await expect(page.getByRole('status')).toHaveCount(0);
    await block.click();
    await expect(page.getByPlaceholder(/地点/)).toHaveValue('新地点');
  } finally { held.release(); }
});

test('移动端：加载提示画在侧栏遮罩之下，不浮在变暗的内容上', async ({ authenticatedPage: page }) => {
  // 提示和遮罩都是根堆叠上下文里的定位元素：z-index 打平时按 DOM 顺序画，提示是后写的
  // 兄弟节点，会浮在 bg-black/40 的遮罩上面。提示必须严格低于遮罩。
  await page.setViewportSize({ width: 390, height: 844 });
  const held = gate();
  await mockSchedules(page, [lesson(916, '2026-10-08', '09:00', '10:00')]);
  await page.route('**/api/schedules?**', async route => { await held.promise; await route.fallback(); });
  try {
    await page.goto('/?week=2026-10-05');
    await expect(page.getByRole('status')).toHaveText('正在加载课表…');
    await page.getByRole('button', { name: '打开导航' }).click();
    await expect(page.locator('div[aria-hidden="true"].fixed.inset-0')).toBeVisible();
    const z = await page.evaluate(() => {
      const hint = document.querySelector('[role="status"]') as HTMLElement;
      const mask = document.querySelector('div[aria-hidden="true"].fixed.inset-0') as HTMLElement;
      return { hint: Number(getComputedStyle(hint).zIndex), mask: Number(getComputedStyle(mask).zIndex) };
    });
    expect(z.hint).toBeLessThan(z.mask);
    held.release();
  } finally { held.release(); }
});

test('月视图：零时长的旧课也看得见，和导出 PNG 一样有最小条高', async ({ authenticatedPage: page }) => {
  // '9:00'~'9:00' 时长为 0：网页此前 height:0% 完全看不见，PNG 却有 6px 下限。
  // 两边共用 MONTH_BAR_MIN_HEIGHT，网页条形也得有这条最小高度。
  await mockSchedules(page, [lesson(920, '2026-10-05', '9:00', '9:00', 0)]);
  await page.goto('/monthly?year=2026&month=9');
  const bar = page.locator('[aria-label="查看2026-10-05课表"] div.absolute');
  await expect(bar).toHaveCount(1);
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(6);
});

test('月视图：窗口末尾的零时长课底边不越出格子（窄屏）', async ({ authenticatedPage: page }) => {
  // 最小条高从条顶往下长：22:30~22:30 顶在条形区底边上，往下 6px 全落在格子外，窄屏格子
  // 只剩 2px 内边距，几乎整条被 overflow-hidden 裁掉。底边要收在条形区以内（PNG 同规则）。
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSchedules(page, [lesson(921, '2026-10-05', '22:30', '22:30', 0)]);
  await page.goto('/monthly?year=2026&month=9');
  const bar = page.locator('[aria-label="查看2026-10-05课表"] div.absolute');
  await expect(bar).toHaveCount(1);
  const box = (await bar.boundingBox())!;
  const area = (await bar.locator('..').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(6);
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height + 0.5);
});

test('周视图缓冲最外侧那一列也和屏外的相邻日比冲突', async ({ authenticatedPage: page }) => {
  // 10-05 那一周的 21 列是 09-28 ~ 10-18：09-28 是缓冲最左一列，09-27 那节晚课不在任何一列上，
  // 但它和 09-28 的早课重叠。上一周/滑动时这一列会滑进屏幕，得已经标好红。
  // 时间轴只按屏上那一周算，默认从 08:00 起，屏外列上 00:30 的块会被裁掉不画；
  // 所以屏上放一节 00:00 的课把时间轴撑到零点。
  await mockSchedules(page, [
    lesson(914, '2026-09-27', '23:00', '01:00'), lesson(915, '2026-09-28', '00:30', '02:00'),
    lesson(916, '2026-10-06', '00:00', '00:30'),
  ]);
  await page.goto('/?week=2026-10-05');
  const edge = page.locator('[data-date="2026-09-28"] div.absolute.rounded-md.cursor-pointer');
  await expect(edge).toHaveCount(1);
  await expect(edge).toHaveClass(/ring-red-500/);
});

for (const bad of ['', '1030']) {
test(`周视图：结束时间为「${bad}」的旧行不会把真正重叠的课挤成叠画`, async ({ authenticatedPage: page }) => {
  // 旧行 startTime 有限、endTime 解析不了（空，或非空但没有冒号）：它会挤进真课的小组把
  // groupEnd 写成 NaN，后面的真课被踢成单独一组——两节真重叠的课以 50% 和 100% 宽度叠画。
  // ScheduleBlock 只藏旧行本身，救不了被带坏的分列；只判非空也拦不住 '1030'。
  await mockSchedules(page, [
    lesson(920, '2026-10-06', '09:00', '11:00', 120),
    lesson(921, '2026-10-06', '09:30', bad, 0),
    lesson(922, '2026-10-06', '10:00', '12:00', 120),
  ]);
  await page.goto('/?week=2026-10-05');
  const blocks = page.locator('[data-date="2026-10-06"] div.absolute.rounded-md.cursor-pointer');
  await expect(blocks).toHaveCount(2); // 旧行本身不画
  const boxes = await blocks.evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, width: r.width };
  }));
  // 两节真课并排分列：等宽、互不叠压。
  expect(boxes[0].width).toBeCloseTo(boxes[1].width, 0);
  expect(Math.min(boxes[0].left, boxes[1].left) + boxes[0].width)
    .toBeLessThanOrEqual(Math.max(boxes[0].left, boxes[1].left) + 1);
});
}

test('周视图：画不出来的旧行不撑开时间轴', async ({ authenticatedPage: page }) => {
  // 开始时间有效、结束时间为空的旧行不画，也不该把时间轴从 08:00 撑到 06:00：
  // 导出的 PNG 只按画得出来的课定时间轴（image-gen-block-geometry 钉着），网页得一致。
  await mockSchedules(page, [lesson(925, '2026-10-06', '06:00', '', 0), lesson(926, '2026-10-06', '09:00', '10:00')]);
  await page.goto('/?week=2026-10-05');
  await expect(page.locator('[data-date="2026-10-06"]').getByText(cls.name, { exact: true })).toBeVisible();
  // 课已经画出来了，时间轴和它同一次渲染算出：直接数一次，不让 toHaveCount 在数据到之前就通过。
  expect(await page.locator('main').getByText('08:00', { exact: true }).count()).toBe(1);
  expect(await page.locator('main').getByText('06:00', { exact: true }).count()).toBe(0);
});

test('月视图：分列只看当天的分组，解析不了的旧行不画', async ({ authenticatedPage: page }) => {
  // 和月图 PNG 同一条规则（image-gen-block-geometry 钉着出图那份）：'9:00'~'9:00' 和
  // 09:00~10:00 按天分成两列、按日期判断却不冲突，按冲突标记给宽度的话两条都满宽叠在一起；
  // 结束时间解析不了的旧行（'1030'）不画，也不进分组。
  await mockSchedules(page, [
    lesson(930, '2026-10-05', '09:00', '10:00'),
    lesson(931, '2026-10-05', '9:00', '9:00', 0),
    lesson(932, '2026-10-05', '09:30', '1030', 0),
  ]);
  await page.goto('/monthly?year=2026&month=9');
  const bars = page.locator('[aria-label="查看2026-10-05课表"] div.absolute');
  await expect(bars).toHaveCount(2);
  const boxes = await bars.evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, width: r.width };
  }));
  expect(boxes[0].width).toBeCloseTo(boxes[1].width, 0);
  expect(Math.min(boxes[0].left, boxes[1].left) + boxes[0].width)
    .toBeLessThanOrEqual(Math.max(boxes[0].left, boxes[1].left) + 1);
});

test('周视图跨午夜冲突标红，月首也能看见与上月晚课的冲突', async ({ authenticatedPage: page }) => {
  await mockSchedules(page, [night, morning]);
  await page.goto('/?week=2026-09-28');
  const blocks = page.locator('div.absolute.rounded-md.cursor-pointer');
  await expect(blocks).toHaveCount(2);
  for (const block of await blocks.all()) await expect(block).toHaveClass(/ring-red-500/);
  await page.goto('/monthly?year=2026&month=9');
  await expect(page.locator('[title*="00:30-02:00"][title*="冲突"]')).toBeVisible();
  await expect(page.locator('[title*="23:00-01:00"]')).toHaveCount(0);
});

for (const width of [1280, 390]) {
  test(`零计费年视图仍显示一次排课和年度统计（宽 ${width}）`, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSchedules(page, [lesson(911, '2026-10-09', '09:00', '10:00', 0)]);
    await page.goto('/yearly?year=2026');
    const october = page.locator('main').getByText('10月', { exact: true }).locator('..');
    await expect(october).toContainText('1天 · 1次');
    await expect(page.getByText('0.0h · 1天 · 1次')).toBeVisible();
    // 不能找 style 里的 NaN：Chromium 直接丢掉无效的 width: NaN%，属性里永远没有它，
    // 而丢掉之后年度统计那根条会撑满整行。得看每根条的宽度确实是 0。
    const bars = page.locator('main [title][style*="background-color"]');
    expect(await bars.count()).toBe(2); // 10 月卡片上一根，年度统计里一根
    for (const bar of await bars.all()) await expect(bar).toHaveAttribute('style', /width: 0%/);
  });
}

test('单次保存排课会展示服务端的冲突警告', async ({ authenticatedPage: page }) => {
  await mockSchedules(page, [morning]);
  await page.route('**/api/schedules/902', route => route.fulfill({ json: { ...morning, warnings: [
    { id: night.id, classId: cls.id, className: '另一节晚课', date: night.date, startTime: '23:00', endTime: '01:00' },
    { id: 903, classId: cls.id, className: '同日课', date: morning.date, startTime: '01:00', endTime: '03:00' },
  ] } }));
  await page.goto('/?week=2026-09-28');
  await page.locator('div.absolute.rounded-md.cursor-pointer').click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  // 前一天的课要带上日期，否则「23:00–01:00」读着像当天一节并不重叠的课；同一天的不用写。
  await expect(page.getByText('排课已保存，与 2 节课时间冲突：另一节晚课 2026-09-30 23:00–01:00；同日课 01:00–03:00')).toBeVisible();
});

for (const view of ['week', 'month'] as const) {
  test(`${view} 翻页后旧请求的错误不能覆盖新课表`, async ({ authenticatedPage: page }) => {
    const old = gate();
    let received = 0;
    const initialStart = view === 'week' ? '2026-09-27' : '2026-09-30';
    const marker = lesson(912, view === 'week' ? '2026-10-13' : '2026-11-09', '09:00', '10:00');
    await page.route('**/api/schedules?**', async route => {
      if (new URL(route.request().url()).searchParams.get('start') === initialStart) {
        received++;
        await old.promise;
        await route.fulfill({ status: 503, json: { error: '旧请求失败' } });
      } else await route.fulfill({ json: [marker] });
    });
    try {
      await page.goto(view === 'week' ? '/?week=2026-10-05' : '/monthly?year=2026&month=9');
      await expect.poll(() => received).toBeGreaterThan(0);
      await page.getByRole('button', { name: view === 'week' ? '下一周' : '下月', exact: true }).click();
      const rendered = page.locator('main').getByText(cls.name, { exact: true }).first();
      await expect(rendered).toBeVisible();
      // 下面全是负断言，等不到什么出现，所以先确认那条 503 真的送进了页面，再留一小段让它的
      // 回调和渲染跑完——光从 release 起算一个固定时长，机器一忙 503 还没到断言就已经过了。
      const delivered = page.waitForResponse(r => r.url().includes('/api/schedules?')
        && new URL(r.url()).searchParams.get('start') === initialStart);
      old.release();
      await (await delivered).finished();
      await page.waitForTimeout(100);
      await expect(rendered).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
      // 错误会显示成「课表加载失败：旧请求失败」，精确匹配永远对不上；toast 又是转瞬即逝的，
      // toHaveCount(0) 会等它消失，所以直接数一次。
      expect(await page.getByText(/旧请求失败/).count()).toBe(0);
    } finally { old.release(); }
  });
}

test('迟到的定价阶梯列表不能覆盖添加后的结果', async ({ authenticatedPage: page }) => {
  const initial = gate();
  let added = false;
  let pending = 0;
  const rows = [{ id: 1, minStudents: 8, maxStudents: 8, pricePerStudentPerHour: 123 }];
  await page.route('**/api/pricing-tiers', async route => {
    if (route.request().method() === 'POST') {
      added = true;
      return route.fulfill({ json: rows[0] });
    }
    if (added) return route.fulfill({ json: rows });
    pending++;
    await initial.promise;
    await route.fulfill({ json: [] });
    pending--;
  });
  try {
    await page.goto('/settings');
    const section = page.getByRole('heading', { name: '定价阶梯' }).locator('..');
    await expect.poll(() => pending).toBeGreaterThan(0);
    await section.getByRole('button', { name: '添加', exact: true }).click();
    await expect(section.getByText('8人: ¥123/人/时')).toBeVisible();
    initial.release();
    await expect.poll(() => pending).toBe(0);
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await expect(section.getByText('8人: ¥123/人/时')).toBeVisible();
  } finally { initial.release(); }
});

test('节假日加载失败后显示重试，成功后显示实际天数', async ({ authenticatedPage: page }) => {
  let fail = true;
  const year = new Date().getFullYear();
  await page.route('**/api/holidays', route => route.fulfill(fail
    ? { status: 503, json: { error: '测试中断' } }
    : { json: [{ id: 1, date: `${year}-01-01`, name: '测试元旦', type: 'holiday' }] }));
  await page.goto('/settings');
  const section = page.getByRole('heading', { name: '法定节假日管理' }).locator('..');
  await expect(section.getByRole('alert')).toContainText('测试中断');
  await expect(section.getByText('节假日 (0天)')).toHaveCount(0);
  fail = false;
  await section.getByRole('button', { name: '重试' }).click();
  await expect(section.getByText('节假日 (1天)')).toBeVisible();
  await expect(section.getByText('测试元旦')).toBeVisible();
});

test('班级基本信息保存只提交本页负责的字段', async ({ authenticatedPage: page }) => {
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  let saved: Record<string, unknown> | undefined;
  await page.route(`**/api/classes/${cls.id}`, async route => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { ...cls, ...saved } });
  });
  await page.goto('/classes');
  await page.getByText(cls.name, { exact: true }).click();
  await classField(page, '班级名称').fill('改名班级');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => saved?.name).toBe('改名班级');
  for (const field of ['studentCount', 'unitPrice', 'discountAmount', 'discountReason']) {
    expect(saved).not.toHaveProperty(field);
  }
});

test('系统取消触摸后，空白格和已有课程都不会打开长按编辑器', async ({ authenticatedPage: page }) => {
  const day = '2026-05-13';
  await mockSchedules(page, [lesson(903, day, '09:00', '10:00')]);
  await page.goto('/?week=2026-05-11');
  const column = page.locator(`[data-date="${day}"]`);
  const cell = column.locator('.border-t.cursor-pointer').first();
  const block = column.getByText(cls.name, { exact: true });
  await expect(block).toBeVisible();
  await page.clock.install();
  for (const target of [cell, block]) {
    await target.evaluate(el => {
      const { left, top } = el.getBoundingClientRect();
      const t = new Touch({ identifier: 1, target: el, clientX: left + 1, clientY: top + 1 });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t] }));
      el.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true, changedTouches: [t] }));
    });
    await page.clock.runFor(510);
    await expect(page.getByRole('dialog', { name: '排课编辑' })).toHaveCount(0);
  }
  await block.evaluate(el => {
    const t = new Touch({ identifier: 2, target: el, clientX: 10, clientY: 10 });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t] }));
  });
  await page.clock.runFor(350);
  await expect(page.getByRole('dialog', { name: '排课编辑' })).toBeVisible();
});
