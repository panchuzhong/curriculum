import { test, expect, ensureTestUser, toDateString, addDays, getCurrentMonday, TEST_USER } from './auth';
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

  test('切换到下一周并验证日期变化', async ({ authenticatedPage: page }) => {
    const main = page.locator('main');
    const rangeText = main.getByText(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/);
    await expect(rangeText).toBeVisible();
    const before = await rangeText.textContent();
    await page.getByRole('button', { name: '下一周' }).click();
    await expect(rangeText).not.toHaveText(before!);
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

  test('取消删除确认后保留排课弹窗', async ({ authenticatedPage: page }) => {
    await clickFirstScheduleCard(page);
    const editDialog = page.getByRole('dialog', { name: '排课编辑' });
    await editDialog.getByRole('button', { name: '删除' }).click();
    const confirmDialog = page.locator('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '取消' }).click();
    await expect(editDialog).toBeVisible();
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
    await expect(dialog.locator('input[type="date"]')).toHaveValue(toDateString(addDays(getCurrentMonday(), 3)));
  });
});

test.describe('排课弹窗保存按钮状态', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('未选择班级时保存禁用，选择后启用', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    // Click an empty cell in the Saturday column (seed schedules are Mon-Wed only)
    // The 21-day buffer renders three Saturdays (last/current/next week);
    // index 1 is the visible current-week one.
    const satHeader = page.locator('main').getByText('周六', { exact: true }).nth(1);
    await expect(satHeader).toBeVisible();
    const box = (await satHeader.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height + 120);

    const dialog = page.getByRole('dialog', { name: '排课编辑' });
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole('button', { name: '保存', exact: true });
    // Before the fix the button was clickable but the handler silently no-opped
    await expect(save).toBeDisabled();

    await dialog.getByRole('combobox').selectOption({ index: 1 });
    await expect(save).toBeEnabled();
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe('批量删课预览', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('预览数量与实际删除范围一致（含学期过滤）', async ({ authenticatedPage: page }) => {
    const expected = ensureDeletePreviewData();
    await page.goto('/');
    await page.getByRole('button', { name: '批量操作' }).click();
    const dialog = page.getByRole('dialog', { name: '批量排课' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '批量删课' }).click();
    await dialog.getByRole('button', { name: '日期范围' }).click();

    await dialog.locator('input[type="date"]').nth(0).fill(expected.start);
    await dialog.locator('input[type="date"]').nth(1).fill(expected.end);
    const mathOption = dialog.getByRole('option', { name: /E2E数学班/ });
    await dialog.getByRole('combobox').selectOption(await mathOption.getAttribute('value'));
    await dialog.getByRole('button', { name: '预览删除' }).click();

    // Oracle computed from the DB with the same semantics as the server:
    // only schedules inside at least one semester are deletable by default.
    await expect(dialog.getByText(`将删除 ${expected.willDelete} 条排课，操作不可撤销`)).toBeVisible();
    if (expected.filtered > 0) {
      await expect(dialog.getByText(`另有 ${expected.filtered} 条因不在当前学期内不会删除`)).toBeVisible();
    } else {
      await expect(dialog.getByText(/因不在当前学期内不会删除/)).toHaveCount(0);
    }

    // Cancel returns to the pre-preview state (dry-run must not have deleted)
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '预览删除' })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('切换删除模式后旧预览失效', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '批量操作' }).click();
    const dialog = page.getByRole('dialog', { name: '批量排课' });
    await dialog.getByRole('button', { name: '批量删课' }).click();
    await dialog.getByRole('button', { name: '日期范围' }).click();
    const dates = dialog.locator('input[type="date"]');
    await dates.first().fill(toDateString(addDays(new Date(), -7)));
    await dates.nth(1).fill(toDateString(new Date()));
    const classSelect = dialog.getByRole('combobox').first();
    const classValue = await classSelect.locator('option', { hasText: 'E2E数学班' }).first().getAttribute('value');
    expect(classValue).not.toBeNull();
    await classSelect.selectOption(classValue!);
    await dialog.getByRole('button', { name: '预览删除' }).click();
    await expect(dialog.getByText(/将删除 \d+ 条排课/)).toBeVisible();

    await dialog.getByRole('button', { name: '学期模式' }).click();
    await expect(dialog.getByText(/将删除 \d+ 条排课/)).not.toBeVisible();
    await expect(dialog.getByRole('button', { name: '预览删除' })).toBeVisible();
  });
});

test.describe('批量排课学期预选', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('默认选中进行中的学期', async ({ authenticatedPage: page }) => {
    // 种子里的「E2E春季学期」按运行日期锚定，始终覆盖今天。
    // 单元测试只覆盖 pickDefaultSemesterId 的选取规则，这里覆盖它到下拉框的接线。
    await page.goto('/');
    await page.getByRole('button', { name: '批量操作' }).click();
    const dialog = page.getByRole('dialog', { name: '批量排课' });
    await expect(dialog).toBeVisible();
    // 默认状态为「批量排课 + 学期模式」，select 依次为：班级、学期、每周几
    const semesterSelect = dialog.locator('select').nth(1);
    await expect(semesterSelect.locator('option:checked')).toHaveText(/E2E春季学期/);
  });
});

test.describe('批量排课弹窗防误关', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('在日期列表内起手拖选、松手落在遮罩上时不应关闭弹窗', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '批量操作' }).click();
    const dialog = page.getByRole('dialog', { name: '批量排课' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '指定日期' }).click();

    const textarea = dialog.locator('textarea');
    await textarea.fill('2026-09-01, 2026-09-08, 2026-09-15');
    // 在 textarea 内按下、拖到面板外的遮罩上松开：浏览器会把 click 派发到
    // 两者的最近公共祖先（遮罩），仅凭 e.target === e.currentTarget 无法区分
    // 这种误触与真正的点击遮罩关闭。
    const box = (await textarea.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(5, 5);
    await page.mouse.up();

    await expect(dialog).toBeVisible();
    await expect(textarea).toHaveValue('2026-09-01, 2026-09-08, 2026-09-15');
  });
});

test.describe('登录后的节假日覆盖', () => {
  test('无需刷新页面即可加载数据库节假日', async ({ page }) => {
    const teacherId = ensureTestUser();
    const date = toDateString(getCurrentMonday());
    const db = new Database(E2E_DB_PATH);
    try {
      db.prepare('DELETE FROM holidays WHERE teacher_id = ? AND date = ?').run(teacherId, date);
      db.prepare('INSERT INTO holidays (teacher_id, date, type, name) VALUES (?, ?, ?, ?)')
        .run(teacherId, date, 'holiday', '登录后加载');
    } finally {
      db.close();
    }

    await page.goto('/login');
    await page.getByPlaceholder('请输入用户名').fill(TEST_USER.username);
    await page.getByPlaceholder('请输入密码').fill(TEST_USER.password);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByText('登录后加载', { exact: true })).toBeVisible();
  });
});

// Seeds three extra E2E数学班 schedules (16:00, idempotent): two deep in the
// past (inside the seeded semester for current run dates) and one recent, then
// computes the expected preview from the DB using server-equivalent semantics.
function ensureDeletePreviewData() {
  const teacherId = ensureTestUser();
  const db = new Database(E2E_DB_PATH);
  try {
    const cls = db.prepare("SELECT id FROM classes WHERE teacher_id = ? AND name = 'E2E数学班' AND deleted = 0")
      .get(teacherId) as { id: number };
    if (!cls) throw new Error('E2E数学班 seed missing');

    const today = new Date();
    const day = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return toDateString(d);
    };
    const start = day(-30);
    const end = toDateString(today);
    const dates = [day(-25), day(-20), day(-5)];
    for (const date of dates) {
      const existing = db.prepare(
        'SELECT id FROM schedules WHERE class_id = ? AND date = ? AND start_time = ?'
      ).get(cls.id, date, '16:00');
      if (!existing) {
        db.prepare('INSERT INTO schedules (class_id, date, start_time, end_time, duration_billing, location_name) VALUES (?, ?, ?, ?, ?, ?)')
          .run(cls.id, date, '16:00', '17:30', 90, 'E2E教室');
      }
    }

    // Oracle: same semantics as PUT/DELETE /api/schedules/batch
    const rows = db.prepare(
      "SELECT date FROM schedules WHERE class_id = ? AND date >= ? AND date <= ?"
    ).all(cls.id, start, end) as { date: string }[];
    const semesters = db.prepare(
      'SELECT start_date, end_date FROM semesters WHERE teacher_id = ?'
    ).all(teacherId) as { start_date: string; end_date: string }[];
    const inSemester = (date: string) =>
      semesters.some(s => date >= s.start_date && date <= s.end_date);
    // Mirror the server's filterBySemesters asymmetry: filtering only applies
    // when candidates straddle a semester boundary (some in, some out).
    const inCount = rows.filter(r => inSemester(r.date)).length;
    const willDelete = (inCount > 0 && inCount < rows.length) ? inCount : rows.length;
    return { start, end, willDelete, filtered: rows.length - willDelete };
  } finally {
    db.close();
  }
}
