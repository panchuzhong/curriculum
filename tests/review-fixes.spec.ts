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
    await expect(page.getByText('学科设置已更新', { exact: true })).toHaveCount(0);
  } finally { loading.release(); saving.release(); }
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

test('地点变更后旧坐标清空，迟到的旧地点结果不能覆盖新坐标', async ({ authenticatedPage: page }) => {
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
    await expect(lat).toHaveValue(''); await expect(lng).toHaveValue('');
    await page.getByRole('button', { name: '获取经纬度' }).click();
    await expect(lat).toHaveValue('39.9');
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

for (const view of ['week', 'month'] as const) {
  test(`${view} 视图：加载失败保留错误，重试恢复当前日期范围`, async ({ authenticatedPage: page }) => {
    const held = gate();
    let failing = true;
    await page.route('**/api/schedules?**', async route => {
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
    } finally { held.release(); }
  });
}

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
    expect(await page.locator('[style*="NaN"], [style*="Infinity"]').count()).toBe(0);
  });
}

test('单次保存排课会展示服务端的冲突警告', async ({ authenticatedPage: page }) => {
  await mockSchedules(page, [morning]);
  await page.route('**/api/schedules/902', route => route.fulfill({ json: { ...morning, warnings: [{ id: night.id, classId: cls.id, className: '另一节晚课', startTime: '23:00', endTime: '01:00' }] } }));
  await page.goto('/?week=2026-09-28');
  await page.locator('div.absolute.rounded-md.cursor-pointer').click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/排课已保存，与 1 节课时间冲突：另一节晚课/)).toBeVisible();
});

for (const view of ['week', 'month'] as const) {
  test(`${view} 翻页后旧请求的错误不能覆盖新课表`, async ({ authenticatedPage: page }) => {
    const old = gate();
    let received = 0;
    const initialStart = view === 'week' ? '2026-09-28' : '2026-09-30';
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
      await expect(page.getByText('旧请求失败', { exact: true })).toHaveCount(0);
    } finally { old.release(); }
  });
}
