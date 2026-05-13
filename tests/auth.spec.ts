import { test, expect } from '@playwright/test';

test.describe('登录页', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('显示登录表单', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '请输入用户名' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '请输入密码' })).toBeVisible();
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  });

  test('显示系统介绍', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '课表管理系统' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '智能排课' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '统计报表' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI Agent' })).toBeVisible();
  });

  test('显示注册链接', async ({ page }) => {
    await expect(page.getByRole('link', { name: '立即注册' })).toBeVisible();
  });

  test('用户名为空时不跳转', async ({ page }) => {
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('错误密码时提示错误', async ({ page }) => {
    await page.getByRole('textbox', { name: '请输入用户名' }).fill('pcz');
    await page.getByRole('textbox', { name: '请输入密码' }).fill('wrongpassword');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByText('用户名或密码错误')).toBeVisible();
  });

  test('正确凭据登录后跳转到首页', async ({ page }) => {
    await page.getByRole('textbox', { name: '请输入用户名' }).fill('pcz');
    await page.getByRole('textbox', { name: '请输入密码' }).fill('test1234');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL('/');
    await expect(page.getByRole('link', { name: '周课表' })).toBeVisible();
  });
});

test.describe('注册页', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('显示注册表单', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
  });
});

test.describe('未登录访问受保护页面', () => {
  test('重定向到登录页', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  });
});
