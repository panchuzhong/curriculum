import { test, expect } from './auth';

test.describe('统计报表', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示报表页面', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: '统计报表' })).toBeVisible();
  });

  test('显示时间维度切换按钮', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('button', { name: '周报' })).toBeVisible();
    await expect(page.getByRole('button', { name: '月报' })).toBeVisible();
    await expect(page.getByRole('button', { name: '年报' })).toBeVisible();
    await expect(page.getByRole('button', { name: '自定义' })).toBeVisible();
  });

  test('显示班级筛选', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test('显示汇总统计卡片', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: '统计报表' })).toBeVisible();
    const cards = page.locator('main .text-gray-500');
    await expect(cards.filter({ hasText: '排课次数' })).toBeVisible();
    await expect(cards.filter({ hasText: '教学时长' })).toBeVisible();
    await expect(cards.filter({ hasText: '预估收入' })).toBeVisible();
  });

  test('显示按学科统计', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: '按学科统计' })).toBeVisible();
  });

  test('显示按年级统计', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: '按年级统计' })).toBeVisible();
  });

  test('显示按班级统计表格', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: '按班级统计' })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '班级' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '排课次数' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '教学时长' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '预估收入' })).toBeVisible();
  });

  test('切换到月报', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: '统计报表' })).toBeVisible();
    await page.getByRole('button', { name: '月报' }).click();
    await expect(page.getByRole('heading', { name: '统计报表' })).toBeVisible();
  });
});
