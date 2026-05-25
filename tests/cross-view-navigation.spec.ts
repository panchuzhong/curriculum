import { test, expect } from './auth';

test.describe('跨视图键盘导航', () => {
  test('方向键上下切换周/月视图并保持月份上下文', async ({ authenticatedPage: page }) => {
    // Navigate to a specific week
    await page.goto('/?date=2026-07-20');
    await expect(page.getByText(/2026-07-20 ~ 2026-07-26/)).toBeVisible();

    // ArrowDown to month view → July
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/monthly\?year=2026&month=6/);
    await expect(page.getByRole('heading', { name: '2026年7月' })).toBeVisible();

    // ArrowUp back to week view — should preserve the same July week
    await page.keyboard.press('ArrowUp');
    await page.getByText(/2026-07-20 ~ 2026-07-26/).waitFor({ state: 'visible' });
  });

  test('方向键上下切换不会导致日期漂移', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-05-31');
    await expect(page.getByText(/2026-05-25 ~ 2026-05-31/)).toBeVisible();

    // Cycle ArrowDown → ArrowUp three times — week should stay in May
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowDown');
      await expect(page).toHaveURL(/\/monthly\?year=2026&month=4/);
      await expect(page.getByRole('heading', { name: '2026年5月' })).toBeVisible();

      await page.keyboard.press('ArrowUp');
      await page.getByText(/2026-05-\d{2} ~ 2026-05-\d{2}/).waitFor({ state: 'visible' });
    }
  });

  test('周视图Ctrl+左右键导航后方向键下切换到对应月份', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-07-20');

    // Ctrl+ArrowRight to next week
    await page.keyboard.press('Control+ArrowRight');
    await expect(page).toHaveURL(/\/\?date=2026-07-27/);
    await expect(page.getByText(/2026-07-27 ~ 2026-08-02/)).toBeVisible();

    // ArrowDown should go to July (the week still starts in July)
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/monthly\?year=2026&month=6/);
    await expect(page.getByRole('heading', { name: '2026年7月' })).toBeVisible();

    // ArrowUp back
    await page.keyboard.press('ArrowUp');
    await page.goto('/?date=2026-07-27');

    // Ctrl+ArrowRight again to cross into August
    await page.keyboard.press('Control+ArrowRight');
    await expect(page.getByText(/2026-08-03 ~ 2026-08-09/)).toBeVisible();

    // ArrowDown should now go to August
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/monthly\?year=2026&month=7/);
    await expect(page.getByRole('heading', { name: '2026年8月' })).toBeVisible();
  });

  test('切换视图后旧视图的过期日期不会覆盖当前视图', async ({ authenticatedPage: page }) => {
    // Start on month view at April
    await page.goto('/monthly?year=2026&month=3');
    await expect(page.getByRole('heading', { name: '2026年4月' })).toBeVisible();

    // ArrowUp to week → April week
    await page.keyboard.press('ArrowUp');

    // Navigate week far away from April to July
    await page.goto('/?date=2026-07-20');

    // ArrowDown → should be July (from current week), NOT April (stale month)
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/monthly\?year=2026&month=6/);
    await expect(page.getByRole('heading', { name: '2026年7月' })).toBeVisible();
  });

  test('年视图切换到周视图再回到年视图保持年份', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly?year=2026');
    await expect(page.getByRole('heading', { name: '2026年' })).toBeVisible();

    // ArrowDown to week (should use today-in-year)
    await page.keyboard.press('ArrowDown');

    // ArrowUp back to year
    await page.keyboard.press('ArrowUp');
    await expect(page).toHaveURL(/\/yearly\?year=2026/);
    await expect(page.getByRole('heading', { name: '2026年' })).toBeVisible();
  });
});

test.describe('Home键快捷方式', () => {
  test('周视图按Home键回到本周', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-12-25');
    await page.keyboard.press('Home');
    // Should be at today's week
    await expect(page.getByText('今天')).toBeVisible();
  });

  test('月视图按Home键回到本月', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly?year=2026&month=11');
    await page.keyboard.press('Home');
    const now = new Date();
    const expectedMonth = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    await expect(page.getByRole('heading', { name: expectedMonth })).toBeVisible();
  });

  test('年视图按Home键回到今年', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly?year=2027');
    await page.keyboard.press('Home');
    await expect(page.getByRole('heading', { name: '2026年' })).toBeVisible();
  });
});

test.describe('URL栏实时更新', () => {
  test('周视图Ctrl+左右键导航后URL同步更新', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-07-20');
    await page.keyboard.press('Control+ArrowRight');
    await expect(page).toHaveURL(/\/\?date=2026-07-27/);
  });

  test('月视图左右键导航后URL同步更新', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly?year=2026&month=6');
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/monthly\?year=2026&month=7/);
  });

  test('年视图左右键导航后URL同步更新', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly?year=2026');
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/yearly\?year=2027/);
  });
});

test.describe('动画功能', () => {
  test('周视图下一周按钮触发滑动动画', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    const before = await page.locator('main').getByText(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/).textContent();
    await page.getByRole('button', { name: '下一周' }).click();
    await page.waitForTimeout(300); // animation completes in ~260ms
    const after = await page.locator('main').getByText(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/).textContent();
    expect(before).not.toBe(after);
  });
});
