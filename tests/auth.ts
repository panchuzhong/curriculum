import { test as base, expect } from '@playwright/test';

export const TEST_USER = {
  username: 'pcz',
  password: 'test1234',
};

export const test = base.extend<{ authenticatedPage: typeof base }>({
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '请输入用户名' }).fill(TEST_USER.username);
    await page.getByRole('textbox', { name: '请输入密码' }).fill(TEST_USER.password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL('/');
    await use(page);
  },
});

export { expect };
