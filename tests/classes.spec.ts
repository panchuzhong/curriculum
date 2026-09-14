import { test, expect, ensureTestUser, toDateString, getCurrentMonday } from './auth';
import Database from 'better-sqlite3';

const E2E_DB_PATH = process.env.DB_PATH || './data/e2e.db';

// 保证存在一个没有任何定价记录的班级（定价功能上线前的老班级/旧备份还原后的状态）。
// 幂等：每次运行先清空该班级的定价记录，防止历史运行残留导致状态漂移。
function ensureZeroPricingClass() {
  const teacherId = ensureTestUser();
  const db = new Database(E2E_DB_PATH);
  try {
    let row = db.prepare('SELECT id FROM classes WHERE teacher_id = ? AND name = ? AND deleted = 0')
      .get(teacherId, 'E2E无定价班') as { id: number } | undefined;
    if (!row) {
      const result = db.prepare(
        `INSERT INTO classes (teacher_id, name, grade, subject, student_count, unit_price, discount_amount, is_competition)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(teacherId, 'E2E无定价班', '高二', '物理', 3, 500, 0, 0);
      row = { id: Number(result.lastInsertRowid) };
    }
    db.prepare('DELETE FROM class_pricing WHERE class_id = ?').run(row.id);
  } finally {
    db.close();
  }
}

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

test.describe('定价管理', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('无定价记录的班级点击新增定价应显示表单', async ({ authenticatedPage: page }) => {
    ensureZeroPricingClass();
    await page.goto('/classes');
    await page.getByText('E2E无定价班').click();
    await page.getByRole('button', { name: '定价历史' }).click();
    await expect(page.getByText('暂无定价记录')).toBeVisible();
    await page.getByRole('button', { name: '新增定价' }).click();
    // 修复前：空记录分支提前 return 不含表单，按钮点击无效
    await expect(page.getByText('生效日期')).toBeVisible();
    await expect(page.getByRole('button', { name: '添加' })).toBeVisible();
  });
});

test.describe('定价历史列', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示「优惠金额」表头，金额为 0 时显示 ¥0 而非破折号', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    await page.getByText('E2E数学班').first().click();
    await page.getByRole('button', { name: '定价历史' }).click();

    await expect(page.getByRole('columnheader', { name: '优惠金额' })).toBeVisible();
    // 种子定价记录的 discount_amount 为 0；改前该格渲染为「—」，看起来像没有这一列
    const row = page.getByRole('row').filter({ hasText: '2026-01-01' });
    await expect(row.getByRole('cell').nth(3)).toHaveText('¥0');
  });
});

test.describe('排课历史', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  // 种子数据：E2E数学班在本周有两节课，另有一节固定在 2026-05-13；
  // E2E春季学期锚定为 today-22 ~ today+120，因此 2026-05-13 落在学期之外。
  async function openHistory(page: import('@playwright/test').Page) {
    await page.goto('/classes');
    await page.getByText('E2E数学班').first().click();
    await page.getByRole('button', { name: '排课历史' }).click();
  }

  test('默认只显示当前学期内的排课', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    const thisMonday = toDateString(getCurrentMonday());

    await expect(page.getByRole('cell', { name: thisMonday })).toBeVisible();
    await expect(page.getByRole('cell', { name: '2026-05-13' })).toHaveCount(0);
  });

  test('放宽开始日期后能看到学期之外的历史排课', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    await page.locator('input[type="date"]').first().fill('2026-01-01');

    await expect(page.getByRole('cell', { name: '2026-05-13' })).toBeVisible();
  });

  test('每行显示日期/星期/时间/时长/地点，并给出小计', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    const row = page.getByRole('row').filter({ hasText: toDateString(getCurrentMonday()) });

    await expect(row.getByRole('cell').nth(1)).toHaveText(/^周[一二三四五六日]$/);
    await expect(row.getByRole('cell').nth(2)).toHaveText('09:00-10:30');
    await expect(row.getByRole('cell').nth(3)).toHaveText('1.5h');
    await expect(row.getByRole('cell').nth(4)).toHaveText('E2E教室');
    await expect(page.getByText(/共 \d+ 节 · [\d.]+h/)).toBeVisible();
  });

  test('时段内没有排课时给出提示', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    await page.locator('input[type="date"]').first().fill('2000-01-01');
    await page.locator('input[type="date"]').nth(1).fill('2000-01-31');

    await expect(page.getByText('该时段无排课')).toBeVisible();
  });
});

test.describe('排课历史日期边界', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('清空某一端的日期表示该方向不设限，而不是筛出空表', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    await page.getByText('E2E数学班').first().click();
    await page.getByRole('button', { name: '排课历史' }).click();

    // 清空开始日期：应把学期之前的历史排课一并纳入
    await page.locator('input[type="date"]').first().fill('');
    await expect(page.getByRole('cell', { name: '2026-05-13' })).toBeVisible();

    // 清空结束日期：仍应保留已匹配的行
    await page.locator('input[type="date"]').nth(1).fill('');
    await expect(page.getByRole('cell', { name: '2026-05-13' })).toBeVisible();
  });
});

test.describe('排课历史降级', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('学期接口失败时排课仍正常显示', async ({ authenticatedPage: page }) => {
    // 修复前：getSemesters 失败会让 Promise.all 整体 reject，已到手的排课
    // 被丢弃，表格显示「该时段无排课」
    await page.route('**/api/semesters*', route =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/classes');
    await page.getByText('E2E数学班').first().click();
    await page.getByRole('button', { name: '排课历史' }).click();
    // 提示先断言（toast 3 秒后自动消失）；StrictMode 双挂载会弹两条，取其一
    await expect(page.getByText(/学期列表加载失败/).first()).toBeVisible();
    // 排课照常展示：学期不可用时默认范围为全部排课
    await expect(page.getByRole('cell', { name: '2026-05-13' })).toBeVisible();
    await expect(page.getByText('该时段无排课')).toHaveCount(0);
  });
});
