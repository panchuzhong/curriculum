import { test, expect } from '@playwright/test';

test('a delayed startup 401 does not clear a newly replaced token', async ({ page }) => {
  const token = version => `header.${Buffer.from(JSON.stringify({ teacherId: 1, pwdVersion: version })).toString('base64url')}.signature`;
  const oldToken = token(0), newToken = token(1);
  await page.addInitScript(value => localStorage.setItem('token', value), oldToken);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let profileRequests = 0;
  let completed = 0;
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/auth/profile') {
      profileRequests++;
      await held;
      await route.fulfill({ status: 401, json: { error: 'Expired old token' } });
      completed++;
    } else await route.fulfill({ json: [] });
  });
  try {
    await page.goto('/settings');
    await expect.poll(() => profileRequests).toBeGreaterThan(0);
    await page.evaluate(async value => {
      const api = await import('/src/api.js');
      api.setToken(value);
    }, newToken);
    release();
    await expect.poll(() => completed).toBe(profileRequests);
    await expect(page.getByRole('alert').filter({ hasText: '学科加载失败' })).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBe(newToken);
  } finally { release(); }
});

test('login and registration fields have associated visible labels', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill('example');
  await page.getByLabel('密码', { exact: true }).fill('example-password');
  await page.getByRole('link', { name: '立即注册' }).click();
  for (const label of ['姓名', '用户名', '密码', '确认密码']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
});
