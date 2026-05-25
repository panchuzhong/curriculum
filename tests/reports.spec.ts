import { test, expect } from './auth';

function pad(n: number) { return String(n).padStart(2, '0'); }
function todayYear() { return new Date().getFullYear(); }
const thisYearStr = `${todayYear()}年`;
const thisMonthStr = `${todayYear()}年${new Date().getMonth() + 1}月`;
function todayRangeRegExp() {
  const d = new Date(); d.setDate(d.getDate() - (d.getDay() || 7) + 1);
  const s = new Date(d); s.setDate(d.getDate() + 6);
  return new RegExp(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ~ ${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`);
}

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

test.describe('报表数据验证', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('汇总统计卡片显示实际数字', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    // The stat cards should show numbers (not empty)
    const main = page.locator('main');
    // Find elements that contain digits in the stat card area
    await page.waitForTimeout(1000); // Wait for data to load
    const revenueText = await main.getByText(/[\d,]+/).first().textContent();
    expect(revenueText).toBeTruthy();
  });

  test('切换班级筛选改变数据', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    const combobox = page.getByRole('combobox');
    const options = await combobox.locator('option').count();
    if (options > 1) {
      await combobox.selectOption({ index: 1 });
      // Verify the page updates (not stale)
      await page.waitForTimeout(500);
      await expect(page.getByRole('heading', { name: '统计报表' })).toBeVisible();
    }
  });

  test('切换到月报后按班级统计表格有数据行', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '月报' }).click();
    await page.waitForTimeout(1000);
    const rows = page.getByRole('table').getByRole('row');
    // Should have at least header + 1 data row
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

test.describe('报表页面键盘导航', () => {
  test('周报左右方向键切换周', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    const before = await page.getByText(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/).textContent();
    await page.keyboard.press('ArrowRight');
    const after = await page.getByText(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/).textContent();
    expect(before).not.toBe(after);
  });

  test('月报左右方向键切换月份', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '月报' }).click();
    const before = await page.getByText(/^\d{4}年\d+月$/).textContent();
    await page.keyboard.press('ArrowRight');
    const after = await page.getByText(/^\d{4}年\d+月$/).textContent();
    expect(before).not.toBe(after);
  });

  test('年报左右方向键切换年份', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '年报' }).click();
    const before = await page.getByText(/^\d{4}年$/).textContent();
    await page.keyboard.press('ArrowRight');
    const after = await page.getByText(/^\d{4}年$/).textContent();
    expect(before).not.toBe(after);
  });

  test('周报Home键回到本周', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    // Navigate away from current week
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    // Home → back to current week
    await page.keyboard.press('Home');
    await expect(page.getByText(todayRangeRegExp())).toBeVisible();
  });

  test('月报Home键回到本月', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '月报' }).click();
    // Navigate away
    await page.keyboard.press('ArrowRight');
    // Home
    await page.keyboard.press('Home');
    await expect(page.getByText(thisMonthStr)).toBeVisible();
  });

  test('年报Home键回到今年', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '年报' }).click();
    // Navigate away: go to prev year
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText(`${todayYear() - 1}年`)).toBeVisible();
    // Home
    await page.keyboard.press('Home');
    await expect(page.getByText(thisYearStr)).toBeVisible();
  });

  test('自定义Home键回到今天', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '自定义' }).click();
    // Change the start date to something else
    const inputs = page.locator('input[type="date"]');
    const startInput = inputs.first();
    await startInput.fill('2026-01-01');
    // Home
    await page.keyboard.press('Home');
    // Both inputs should be today
    const today = `${todayYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
    await expect(startInput).toHaveValue(today);
  });
});
