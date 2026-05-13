import { test, expect } from './auth';

const scheduleCard = 'main .absolute.rounded-md.cursor-pointer';

async function clickFirstScheduleCard(page) {
  await page.waitForSelector(scheduleCard, { timeout: 10000 });
  await page.evaluate((selector) => {
    const card = document.querySelector(selector);
    if (card) card.click();
  }, scheduleCard);
}

test.describe('周课表', () => {
  test('显示周视图和导航控件', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('button', { name: '上一周' })).toBeVisible();
    await expect(page.getByRole('button', { name: '后一天' })).toBeVisible();
    await expect(page.getByRole('button', { name: '本周' })).toBeVisible();
    await expect(page.getByRole('button', { name: '批量操作' })).toBeVisible();
    await expect(page.getByRole('button', { name: '导出' })).toBeVisible();
  });

  test('显示时间轴', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main').getByText('08:00').first()).toBeVisible();
    await expect(page.locator('main').getByText('22:00').first()).toBeVisible();
  });

  test('显示排课条目', async ({ authenticatedPage: page }) => {
    await page.waitForSelector(scheduleCard, { timeout: 10000 });
    const count = await page.locator(scheduleCard).count();
    expect(count).toBeGreaterThan(0);
  });

  test('点击排课弹出编辑弹窗', async ({ authenticatedPage: page }) => {
    await clickFirstScheduleCard(page);
    await expect(page.getByRole('heading', { name: '编辑排课' })).toBeVisible();
    await expect(page.getByRole('combobox').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '保存' })).toBeVisible();
    await expect(page.getByRole('button', { name: '删除' })).toBeVisible();
    await expect(page.getByRole('button', { name: '取消' })).toBeVisible();
  });

  test('点击关闭按钮关闭弹窗', async ({ authenticatedPage: page }) => {
    await clickFirstScheduleCard(page);
    await expect(page.getByRole('heading', { name: '编辑排课' })).toBeVisible();
    await page.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByRole('heading', { name: '编辑排课' })).not.toBeVisible();
  });

  test('切换到上一周并验证日期变化', async ({ authenticatedPage: page }) => {
    const main = page.locator('main');
    await expect(main.getByText(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/)).toBeVisible();
    const before = await main.getByText(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/).textContent();
    await page.getByRole('button', { name: '上一周' }).click();
    await expect(main.getByText(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/)).not.toHaveText(before!);
  });

  test('切换到下一周', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '下一周' }).click();
    await page.waitForSelector(scheduleCard, { timeout: 10000 });
    const count = await page.locator(scheduleCard).count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('点击本周回到当前周', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '上一周' }).click();
    await page.getByRole('button', { name: '本周' }).click();
    await expect(page.getByText('今天')).toBeVisible();
  });

  test('排课弹窗显示班级选择、日期、时间、地点', async ({ authenticatedPage: page }) => {
    await clickFirstScheduleCard(page);
    await expect(page.getByText('选择班级')).toBeVisible();
    await expect(page.getByText('开始时间')).toBeVisible();
    await expect(page.getByText('结束时间')).toBeVisible();
    await expect(page.getByText('计费时长')).toBeVisible();
    await expect(page.getByText('上课地点')).toBeVisible();
  });
});
