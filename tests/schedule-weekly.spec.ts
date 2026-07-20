import { test, expect, ensureTestUser, toDateString, addDays, getCurrentMonday } from './auth';
import Database from 'better-sqlite3';

const E2E_DB_PATH = process.env.DB_PATH || './data/e2e.db';

const scheduleCard = 'main .absolute.rounded-md.cursor-pointer';

async function clickFirstScheduleCard(page) {
  await page.waitForSelector(scheduleCard, { timeout: 10000 });
  await page.evaluate((selector) => {
    const card = document.querySelector(selector);
    if (card) card.click();
  }, scheduleCard);
}

// 保证本周三存在一节 22:00-23:59 的晚点课程，使周视图网格扩展出 24:00 行（幂等）。
function ensureLateSchedule() {
  const teacherId = ensureTestUser();
  const db = new Database(E2E_DB_PATH);
  try {
    const classRow = db.prepare('SELECT id FROM classes WHERE teacher_id = ? AND name = ? AND deleted = 0')
      .get(teacherId, 'E2E数学班') as { id: number } | undefined;
    if (!classRow) throw new Error('E2E数学班 seed missing');
    const wednesday = toDateString(addDays(getCurrentMonday(), 2));
    const existing = db.prepare(
      'SELECT id FROM schedules WHERE class_id = ? AND date = ? AND start_time = ? AND end_time = ?'
    ).get(classRow.id, wednesday, '22:00', '23:59');
    if (!existing) {
      db.prepare(
        'INSERT INTO schedules (class_id, date, start_time, end_time, duration_billing, location_name) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(classRow.id, wednesday, '22:00', '23:59', 119, 'E2E教室');
    }
  } finally {
    db.close();
  }
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

test.describe('排课操作', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('编辑排课修改地点', async ({ authenticatedPage: page }) => {
    await clickFirstScheduleCard(page);
    await expect(page.getByRole('heading', { name: '编辑排课' })).toBeVisible();
    const locationInput = page.getByPlaceholder(/地点/);
    if (await locationInput.isVisible()) {
      await locationInput.clear();
      await locationInput.fill(`E2E地点_${Date.now()}`);
    }
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('heading', { name: '编辑排课' })).not.toBeVisible();
  });

  test('删除排课', async ({ authenticatedPage: page }) => {
    // Count cards before
    await page.waitForSelector(scheduleCard, { timeout: 10000 });
    const countBefore = await page.locator(scheduleCard).count();
    if (countBefore === 0) return; // No schedules to delete

    await clickFirstScheduleCard(page);
    await expect(page.getByRole('heading', { name: '编辑排课' })).toBeVisible();
    await page.getByRole('button', { name: '删除' }).click();
    await page.getByRole('button', { name: '确认' }).click();
    // Verify card count decreased
    await expect(page.locator(scheduleCard)).toHaveCount(countBefore - 1);
  });
});

test.describe('扩展时段格子', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('点击 24:00 扩展行新建排课，开始时间应为合法的 00:00', async ({ authenticatedPage: page }) => {
    ensureLateSchedule();
    await page.goto('/');
    // 晚点课程（22:00-23:59）使网格扩展出 24:00 行
    const label24 = page.locator('main').getByText('24:00', { exact: true });
    await expect(label24).toBeVisible();
    const lateBlock = page.locator('main').getByText('22:00-23:59');
    await expect(lateBlock).toBeVisible();
    // 在晚点课程所在列、24:00 行内点击空白格子
    const blockBox = (await lateBlock.boundingBox())!;
    const labelBox = (await label24.boundingBox())!;
    await page.mouse.click(blockBox.x + blockBox.width / 2, labelBox.y + labelBox.height + 4);
    const dialog = page.getByRole('dialog', { name: '排课编辑' });
    await expect(dialog).toBeVisible();
    // 修复前：桌面端把 "24:00" 传给弹窗，time input 无法渲染（值为空），保存会被服务端拒绝
    await expect(dialog.locator('input[type="time"]').first()).toHaveValue('00:00');
  });
});
