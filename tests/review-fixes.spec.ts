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
    await expect(page.getByRole('status')).toHaveText('正在加载学科…');
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
  await page.goto('/settings');
  const done = page.getByText('学科设置已更新', { exact: true });
  await page.getByRole('button', { name: '保存学科设置' }).click();
  await expect(done).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '✓ 已保存' }).click();
  // 此时第一次保存的 3 秒已经到点，第二次的还剩一秒多。
  await page.waitForTimeout(1500);
  expect(await done.isVisible()).toBe(true);
});

test('学科加载失败时保持禁用，重试成功后才允许保存', async ({ authenticatedPage: page }) => {
  let failing = true;
  await page.route('**/api/auth/profile', route => route.fulfill(failing
    ? { status: 503, json: { error: '资料暂不可用' } } : { json: profile }));
  await page.goto('/settings');
  await expect(page.getByRole('alert')).toContainText('资料暂不可用');
  await expect(page.getByRole('button', { name: '保存学科设置' })).toBeDisabled();
  failing = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存学科设置' })).toBeEnabled();
  const section = page.getByRole('heading', { name: '学科管理' }).locator('..');
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
      old.release();
      await page.waitForTimeout(150);
      await expect(rendered).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
      // 错误会显示成「课表加载失败：旧请求失败」，精确匹配永远对不上；toast 又是转瞬即逝的，
      // toHaveCount(0) 会等它消失，所以直接数一次。
      expect(await page.getByText(/旧请求失败/).count()).toBe(0);
    } finally { old.release(); }
  });
}
