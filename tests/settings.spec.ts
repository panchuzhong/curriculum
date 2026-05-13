import { test, expect } from './auth';

test.describe('设置页面', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示设置页面标题', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  });

  test('显示学科管理区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '学科管理' })).toBeVisible();
    await expect(page.getByText('数学')).toBeVisible();
    await expect(page.getByText('物理')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存学科设置' })).toBeVisible();
  });

  test('显示快速添加学科按钮', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: '+ 化学' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 英语' })).toBeVisible();
  });

  test('显示节假日管理区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '法定节假日管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '手动添加' })).toBeVisible();
  });

  test('显示节假日列表', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByText('节假日', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('调休上班', { exact: false }).first()).toBeVisible();
  });

  test('显示修改密码区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();
    await expect(page.getByText('当前密码')).toBeVisible();
    await expect(page.getByText('新密码', { exact: true })).toBeVisible();
    await expect(page.getByText('确认新密码')).toBeVisible();
    await expect(page.getByRole('button', { name: '修改密码' })).toBeVisible();
  });

  test('显示API Key区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'API Key' })).toBeVisible();
    await expect(page.getByRole('button', { name: '复制' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新生成 API Key' })).toBeVisible();
  });

  test('显示定价阶梯区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '定价阶梯' })).toBeVisible();
  });
});

test.describe('导航和布局', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('导航栏显示系统名称', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('heading', { name: '课表管理' })).toBeVisible();
  });

  test('导航栏显示退出登录按钮', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  });

  test('点击退出登录跳转到登录页', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  });

  test('导航链接正确跳转', async ({ authenticatedPage: page }) => {
    await page.getByRole('link', { name: '月课表' }).click();
    await expect(page).toHaveURL(/\/monthly/);

    await page.getByRole('link', { name: '班级管理' }).click();
    await expect(page).toHaveURL(/\/classes/);

    await page.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/settings/);
  });
});
