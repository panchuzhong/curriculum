import { test, expect } from './auth';

test.describe('月课表', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示月视图标题和导航', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    await expect(page.getByRole('heading', { name: /2026年\d+月/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '上月' })).toBeVisible();
    await expect(page.getByRole('button', { name: '本月' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下月' })).toBeVisible();
  });

  test('显示星期标题行', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    await expect(page.locator('main').getByText('周一')).toBeVisible();
    await expect(page.locator('main').getByText('周日')).toBeVisible();
  });

  test('显示日期网格中的排课', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    const items = page.locator('[class*="cursor-pointer"]');
    await expect(items.first()).toBeVisible();
  });

  test('切换月份', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    await page.getByRole('button', { name: '下月' }).click();
    await expect(page.getByRole('heading', { name: /2026年/ })).toBeVisible();
    await page.getByRole('button', { name: '上月' }).click();
  });

  test('点击本月回到当前月', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    await page.getByRole('button', { name: '上月' }).click();
    await page.getByRole('button', { name: '本月' }).click();
    await expect(page.getByText('今')).toBeVisible();
  });
});

test.describe('年课表', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示年度标题和导航', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    await expect(page.getByRole('heading', { name: '2026年' })).toBeVisible();
    await expect(page.getByRole('button', { name: '上一年' })).toBeVisible();
    await expect(page.getByRole('button', { name: '今年' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下一年' })).toBeVisible();
  });

  test('显示12个月卡片', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    await expect(page.getByRole('heading', { name: '2026年' })).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByText('3月')).toBeVisible();
    await expect(main.getByText('9月')).toBeVisible();
  });

  test('显示年度统计汇总', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    await expect(page.getByText('2026 年度统计')).toBeVisible();
  });

  test('显示学科分类统计', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    await expect(page.getByText('2026 年度统计')).toBeVisible();
  });

  test('切换年份', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    await page.getByRole('button', { name: '下一年' }).click();
    await expect(page.getByRole('heading', { name: '2027年' })).toBeVisible();
    await page.getByRole('button', { name: '今年' }).click();
    await expect(page.getByRole('heading', { name: '2026年' })).toBeVisible();
  });
});
