import { test, expect } from './auth';
import type { Page } from '@playwright/test';

// 第三轮 review 的回归用例：跨账号缓存、跨断点导航、保存期间的退出路径。

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

const profile = { id: 1, username: 'r3', name: 'R3', apiKey: 'mask', subjects: ['数学'] };
const cls = { id: 821, name: '三轮班', grade: '初三', subject: '数学', studentCount: 1, unitPrice: 100, isCompetition: false };

async function mockBasics(page: Page, rows: object[] = []) {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  await page.route('**/api/schedules?**', route => {
    const p = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: rows.filter((s: any) => s.date >= p.get('start')! && s.date <= p.get('end')!) });
  });
}

// ── 跨断点对齐之后，下一次翻周必须仍从周一开始 ──────────────────────
// 上一版只在 resize 时改了屏上的周一，targetRef 还停在周三，
// 于是「下一周」又歪回周三~周二。这条断言的是再翻一步之后的样子。
test('双日视图放宽到桌面后，再点下一周仍是周一对齐', async ({ authenticatedPage: page }) => {
  await mockBasics(page);
  await page.setViewportSize({ width: 500, height: 800 });
  // 2026-05-13 是周三；对齐后本周是 05-11（周一），下一周应是 05-18（周一）
  await page.goto('/?date=2026-05-13');
  await expect(page.getByText('05-13 ~ 05-14')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText('2026-05-11 ~ 2026-05-17')).toBeVisible();
  await page.getByRole('button', { name: '下一周' }).click();
  await expect(page.getByText('2026-05-18 ~ 2026-05-24')).toBeVisible();
});

// ── 学生弹窗：保存中遮罩不能关闭 ────────────────────────────────────
test('学生保存期间点遮罩不会关闭弹窗', async ({ authenticatedPage: page }) => {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  await page.route('**/api/students', route => route.fulfill({ json: [] }));
  const saving = gate();
  await page.route('**/api/students', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await saving.promise;
    return route.fulfill({ json: { id: 1, name: '新学生' } });
  });
  try {
    await page.goto('/students');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建学生' });
    await dialog.locator('input').first().fill('新学生');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '保存中...' })).toBeDisabled();
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
    saving.release();
    await expect(dialog).toHaveCount(0);
  } finally { saving.release(); }
});

// ── 学期：保存期间「新建学期」置灰，旧保存不会关掉新表单 ──────────────
test('学期更新保存期间新建按钮置灰', async ({ authenticatedPage: page }) => {
  const sem = { id: 31, name: '2026春季', type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' };
  await page.route('**/api/semesters', route => route.fulfill({ json: [sem] }));
  const saving = gate();
  await page.route('**/api/semesters/31', async route => {
    await saving.promise;
    return route.fulfill({ json: sem });
  });
  try {
    await page.goto('/semesters');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存中...' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '新建学期' })).toBeDisabled();
    saving.release();
    await expect(page.getByRole('button', { name: '新建学期' })).toBeEnabled();
  } finally { saving.release(); }
});

// ── 跨标签页换账号后，节假日缓存也必须作废 ──────────────────────────
test('另一标签页换账号后重新拉取节假日，不再沿用旧账号的自定义名称', async ({ authenticatedPage: page }) => {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  await page.route('**/api/schedules?**', route => route.fulfill({ json: [] }));
  let holidayCalls = 0;
  await page.route('**/api/holidays', route => {
    holidayCalls++;
    return route.fulfill({ json: [{ id: 1, date: '2026-05-01', type: 'holiday', name: 'A的自定义假日' }] });
  });
  await page.goto('/monthly?year=2026&month=4');
  await expect(page.getByText('A的自定义假日').first()).toBeVisible();
  const before = holidayCalls;
  await page.evaluate(() => {
    const claims = btoa(JSON.stringify({ teacherId: 999999, pwdVersion: 0 }));
    const other = `x.${claims}.y`;
    localStorage.setItem('token', other);
    window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: other }));
  });
  await expect.poll(() => holidayCalls).toBeGreaterThan(before);
});

// ── 报表：Home 键和「本月」一样能触发重试 ───────────────────────────
test('报表失败后按 Home 键也会重新请求', async ({ authenticatedPage: page }) => {
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  let monthCalls = 0;
  await page.route('**/api/schedules/summary?**', route => {
    const start = new URL(route.request().url()).searchParams.get('start')!;
    // 只让「月报」那一发失败：首次进入页面是周报，切到月报才是第二次请求。
    if (start.endsWith('-01')) {
      monthCalls++;
      if (monthCalls === 1) return route.fulfill({ status: 500, json: { error: 'down' } });
    }
    return route.fulfill({ json: { byClass: [], byMonth: [] } });
  });
  await page.goto('/reports');
  await page.getByRole('button', { name: '月报' }).click();
  await expect(page.getByRole('alert')).toContainText('报表加载失败');
  await page.keyboard.press('Home');
  await expect(page.getByText('该时段无排课记录')).toBeVisible();
});
