import { test, expect } from './auth';

test.describe('班级管理', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示班级列表', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    await expect(page.getByRole('heading', { name: '班级管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建班级' })).toBeVisible();
    const cards = page.locator('[class*="cursor-pointer"]');
    await expect(cards.first()).toBeVisible();
  });

  test('班级卡片显示关键信息', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    const firstCard = page.locator('[class*="cursor-pointer"]').first();
    await expect(firstCard).toContainText(/\d+人/);
    await expect(firstCard).toContainText(/¥/);
  });

  test('展开班级显示详情', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    const firstCard = page.locator('[class*="cursor-pointer"]').first();
    await firstCard.click();
    // Verify expanded section shows details (grade, subject, etc.)
    await expect(page.getByText('年级')).toBeVisible();
  });

  test('导航栏显示所有页面链接', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    await expect(page.getByRole('link', { name: '周课表' })).toBeVisible();
    await expect(page.getByRole('link', { name: '月课表' })).toBeVisible();
    await expect(page.getByRole('link', { name: '年课表' })).toBeVisible();
    await expect(page.getByRole('link', { name: '班级管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: '学生管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: '学期管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: '统计报表' })).toBeVisible();
    await expect(page.getByRole('link', { name: '设置' })).toBeVisible();
  });
});

test.describe('班级CRUD', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('新建班级并验证显示', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    const uniqueName = `E2E测试班_${Date.now()}`;
    await page.getByRole('button', { name: '新建班级' }).click();
    // Labels are not linked via htmlFor — locate inputs by context within the form
    const form = page.locator('form').filter({ hasText: '班级名称' });
    await form.locator('input').first().fill(uniqueName);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(uniqueName)).toBeVisible();
  });
});
