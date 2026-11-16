import { test, expect } from './auth';
import type { Page } from '@playwright/test';

// 针对 2026-11 那轮 review 的 15 条发现补的回归用例。命名与修复项一一对应，
// 只覆盖用户能直接观察到的行为（弹窗关不关、列表刷不刷、按钮点不点得动）。

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

const profile = { id: 1, username: 'r2', name: 'R2', apiKey: 'mask', subjects: ['数学'] };
const cls = { id: 811, name: '回归班', grade: '初三', subject: '数学', studentCount: 1, unitPrice: 100, isCompetition: false };
const lesson = (id: number, date: string, startTime = '09:00', endTime = '10:00') =>
  ({ id, classId: cls.id, date, startTime, endTime, durationBilling: 60, class: cls });

async function mockBasics(page: Page, rows: object[] = []) {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  await page.route('**/api/schedules?**', route => {
    const p = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: rows.filter((s: any) => s.date >= p.get('start')! && s.date <= p.get('end')!) });
  });
}

// ── A2：保存中不能通过 ✕ / 遮罩关闭排课弹窗 ────────────────────────
test('排课保存期间 ✕ 与遮罩都不能关闭弹窗，完成后才由 onSaved 关闭', async ({ authenticatedPage: page }) => {
  await mockBasics(page);
  const saving = gate();
  await page.route('**/api/schedules', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await saving.promise;
    return route.fulfill({ json: lesson(9901, '2026-05-13') });
  });
  await page.goto('/?week=2026-05-11');
  await page.getByRole('button', { name: '批量操作' }).waitFor();
  // 点空白格新建
  await page.locator('[data-date="2026-05-13"]').first().click();
  const dialog = page.getByRole('dialog', { name: '排课编辑' });
  await expect(dialog).toBeVisible();
  await dialog.locator('select').first().selectOption(String(cls.id));
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '保存中...' })).toBeDisabled();
  await dialog.getByRole('button', { name: '关闭' }).click({ force: true });
  await expect(dialog).toBeVisible();
  // 遮罩：点在面板外的左上角
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  saving.release();
  await expect(dialog).toHaveCount(0);
});

// ── A3：批量结果页的 ✕ 也会刷新课表 ────────────────────────────────
test('批量排课成功后点 ✕ 关闭，课表同样刷新出新课程', async ({ authenticatedPage: page }) => {
  await mockBasics(page);
  await page.route('**/api/semesters', route => route.fulfill({ json: [
    { id: 1, name: '2026春季', type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' },
  ] }));
  await page.route('**/api/schedules/batch', route => route.fulfill({ json: { count: 1 } }));
  let refetched = false;
  await page.route('**/api/schedules?**', route => {
    const p = new URL(route.request().url()).searchParams;
    if (p.get('start')! <= '2026-05-13' && p.get('end')! >= '2026-05-13') refetched = true;
    return route.fulfill({ json: [] });
  });
  await page.goto('/?week=2026-05-11');
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.locator('select').first().selectOption(String(cls.id));
  // 走「指定日期」而不是学期模式：学期模式的提交按钮会被 semesterPending /
  // 「学期已结束」置灰，而这里要测的是结果页的关闭路径，不是学期校验。
  await dialog.getByRole('button', { name: '指定日期' }).click();
  await dialog.locator('textarea').fill('2026-05-13');
  await dialog.getByRole('button', { name: '批量排课', exact: true }).last().click();
  await expect(dialog.getByText('成功排课 1 次')).toBeVisible();
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toHaveCount(0);
  expect(refetched).toBe(true);
});

// ── A4：写入后空白格同样受 isStale 保护 ────────────────────────────
test('保存后课表尚未刷新时，空白格也不能再打开新建弹窗', async ({ authenticatedPage: page }) => {
  await mockBasics(page);
  const refreshed = gate();
  let hold = false;
  await page.route('**/api/schedules?**', async route => {
    if (hold) await refreshed.promise;
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/schedules', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    hold = true;
    return route.fulfill({ json: lesson(9902, '2026-05-13') });
  });
  await page.goto('/?week=2026-05-11');
  await page.getByRole('button', { name: '批量操作' }).waitFor();
  await page.locator('[data-date="2026-05-13"]').first().click();
  const dialog = page.getByRole('dialog', { name: '排课编辑' });
  await dialog.locator('select').first().selectOption(String(cls.id));
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('[data-date="2026-05-14"]').first().click();
  await expect(page.getByRole('dialog', { name: '排课编辑' })).toHaveCount(0);
  await expect(page.getByText('课表正在刷新，请稍后再点')).toBeVisible();
  refreshed.release();
});

// ── A5：修改密码防重复提交 ────────────────────────────────────────
test('修改密码提交期间按钮置灰，重复点击只发一次请求', async ({ authenticatedPage: page }) => {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  const saving = gate();
  let calls = 0;
  await page.route('**/api/auth/password', async route => {
    calls++;
    await saving.promise;
    // 必须回一个服务端真能接受的令牌：setToken 会清缓存并通知整棵私有树重挂，
    // 后续请求若带着 'new-token' 这种假值，401 会把页面踢回 /login。
    const realToken = await page.evaluate(() => localStorage.getItem('token'));
    return route.fulfill({ json: { token: realToken } });
  });
  try {
    await page.goto('/settings');
    // 用密码输入框定位表单，而不是按提交按钮文字过滤——
    // 提交后按钮文案变成「修改中…」，按文字过滤的表单会整个失配。
    const form = page.locator('form').filter({ has: page.locator('input[type="password"]') });
    await form.locator('input').nth(0).fill('old-password-1');
    await form.locator('input').nth(1).fill('new-password-1');
    await form.locator('input').nth(2).fill('new-password-1');
    const submit = form.getByRole('button', { name: '修改密码' });
    await submit.click();
    await expect(form.getByRole('button', { name: '修改中…' })).toBeDisabled();
    await form.getByRole('button', { name: '修改中…' }).click({ force: true });
    saving.release();
    await expect(page.getByText('密码修改成功')).toBeVisible();
    expect(calls).toBe(1);
  } finally { saving.release(); }
});

// ── B7：遮罩按下、面板内松开不应关闭弹窗 ───────────────────────────
test('从遮罩按下、拖入面板后松开不会关闭弹窗', async ({ authenticatedPage: page }) => {
  await mockBasics(page);
  await page.goto('/?week=2026-05-11');
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await expect(dialog).toBeVisible();
  await page.mouse.move(6, 6);
  await page.mouse.down();
  const box = await dialog.locator('> div').first().boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
});

// ── B8：学期编辑器不会从编辑悄悄切回新建 ───────────────────────────
test('先新建再编辑某学期，保存调用的是更新而不是创建', async ({ authenticatedPage: page }) => {
  const sem = { id: 21, name: '2026春季', type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' };
  await page.route('**/api/semesters', route => route.fulfill({ json: [sem] }));
  let put = 0, post = 0;
  await page.route('**/api/semesters/21', route => { put++; return route.fulfill({ json: sem }); });
  await page.route('**/api/semesters', route => {
    if (route.request().method() === 'POST') { post++; return route.fulfill({ json: sem }); }
    return route.fallback();
  });
  await page.goto('/semesters');
  await page.getByRole('button', { name: '新建学期' }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => put).toBe(1);
  expect(post).toBe(0);
  // 保存后表单收起，不会留着一张「其实是新建」的表单
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
});

// ── B11：周视图导出失败保留弹窗 ────────────────────────────────────
test('周视图 PNG 导出失败时弹窗保留并显示错误，可重试', async ({ authenticatedPage: page }) => {
  await mockBasics(page);
  let fail = true;
  await page.route('**/api/schedule-image?**', route => {
    if (fail) return route.fulfill({ status: 500, json: { error: 'Image generation failed' } });
    return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a', 'hex') });
  });
  await page.goto('/?week=2026-05-11');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出课表' });
  await dialog.getByRole('button', { name: '导出 PNG' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Image generation failed');
  fail = false;
  await dialog.getByRole('button', { name: '导出 PNG' }).click();
  await expect(dialog).toHaveCount(0);
});

// ── C12：班级列表加载失败显示持久错误态与重试 ──────────────────────
test('班级列表加载失败时显示错误与重试，而不是「暂无班级」', async ({ authenticatedPage: page }) => {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  let fail = true;
  await page.route('**/api/classes', route => {
    if (fail) return route.fulfill({ status: 500, json: { error: 'db down' } });
    return route.fulfill({ json: [cls] });
  });
  await page.goto('/classes');
  await expect(page.getByRole('alert')).toContainText('班级加载失败');
  await expect(page.getByText('暂无班级，点击右上角新建')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('回归班', { exact: false })).toBeVisible();
});

// ── C12：报表失败后可以靠「重试」恢复 ──────────────────────────────
test('报表加载失败显示重试，点击后恢复', async ({ authenticatedPage: page }) => {
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  let fail = true;
  await page.route('**/api/schedules/summary?**', route => {
    if (fail) return route.fulfill({ status: 500, json: { error: 'summary down' } });
    return route.fulfill({ json: { byClass: [], byMonth: [] } });
  });
  await page.goto('/reports');
  await expect(page.getByRole('alert')).toContainText('报表加载失败');
  fail = false;
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('该时段无排课记录')).toBeVisible();
});

// ── C13：窄屏下节假日添加行与定价阶梯不横向溢出 ────────────────────
test('320px 视口下节假日添加行的按钮在屏内', async ({ authenticatedPage: page }) => {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/holidays**', route => route.fulfill({ json: [] }));
  await page.route('**/api/pricing-tiers', route => route.fulfill({ json: [] }));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/settings');
  await page.getByRole('button', { name: '手动添加' }).click();
  const add = page.getByRole('button', { name: '添加', exact: true }).first();
  const box = await add.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

// ── A1：跨标签页换账号后，旧账号的界面与缓存必须一起丢掉 ─────────────
test('另一标签页换账号登录后，本页私有树重挂并重新拉取数据', async ({ authenticatedPage: page }) => {
  let classCalls = 0;
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/classes', route => { classCalls++; return route.fulfill({ json: [cls] }); });
  await page.route('**/api/schedules?**', route => route.fulfill({ json: [] }));
  await page.goto('/classes');
  await expect(page.getByText('回归班')).toBeVisible();
  const before = classCalls;
  // 另一标签页登录 B：storage 事件只在「别的文档」里触发，这里手工派发，
  // 模拟的正是浏览器收到 storage 通知的那一瞬间。令牌带上不同的 teacherId——
  // 页面按账号身份而不是令牌字符串判断要不要重挂（改密码换令牌不该重挂）。
  await page.evaluate(() => {
    const claims = btoa(JSON.stringify({ teacherId: 999999, pwdVersion: 0 }));
    const otherAccount = `x.${claims}.y`;
    localStorage.setItem('token', otherAccount);
    window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: otherAccount }));
  });
  await expect.poll(() => classCalls).toBeGreaterThan(before);
  await expect(page.getByText('回归班')).toBeVisible();
});

// ── A1 对照：同账号换发新令牌（改密码）不应重挂页面 ──────────────────
test('同一账号换发新令牌时页面不被重挂，表单状态保留', async ({ authenticatedPage: page }) => {
  await page.route('**/api/auth/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/classes', route => route.fulfill({ json: [cls] }));
  await page.route('**/api/pricing-tiers', route => route.fulfill({ json: [] }));
  await page.route('**/api/holidays**', route => route.fulfill({ json: [] }));
  await page.goto('/settings');
  const input = page.getByPlaceholder('自定义学科名称');
  await input.fill('待保存的学科');
  await page.evaluate(() => {
    // 同一个 teacherId、不同的 pwdVersion：正是改密码后换发的那张令牌。
    const claims = btoa(JSON.stringify({ teacherId: 1, pwdVersion: 99 }));
    const refreshed = `x.${claims}.y`;
    localStorage.setItem('token', refreshed);
    window.dispatchEvent(new Event('token-changed'));
  });
  await expect(input).toHaveValue('待保存的学科');
});

// ── B6：快速连点下一周不会丢步 ────────────────────────────────────
test('快速连点两次下一周前进两周', async ({ authenticatedPage: page }) => {
  await mockBasics(page);
  await page.goto('/?week=2026-05-11');
  const next = page.getByRole('button', { name: '下一周' });
  await next.waitFor();
  await next.click();
  await next.click();
  await expect(page.getByText('2026-05-25 ~ 2026-05-31')).toBeVisible();
});

// ── B10：窄屏双日视图放宽到桌面后重新周一对齐 ──────────────────────
test('双日视图放宽到桌面后从周一开始显示', async ({ authenticatedPage: page }) => {
  await mockBasics(page);
  await page.setViewportSize({ width: 500, height: 800 });
  // 2026-05-13 是周三
  await page.goto('/?date=2026-05-13');
  await expect(page.getByText('05-13 ~ 05-14')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText('2026-05-11 ~ 2026-05-17')).toBeVisible();
});
