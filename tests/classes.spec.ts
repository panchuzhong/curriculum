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

  // 年份段不会在第 4 位后自动跳段，直接键入整个日期时多出的数字继续落在年份里。
  // 没有 max 约束时年份能涨到 5 位以上，「2026」就变成了「20261」。
  test('年份段多打一位也不会产生位数不对的年份', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    for (const input of [page.locator('input[type="date"]').first(), page.locator('input[type="date"]').nth(1)]) {
      await input.click();
      await page.keyboard.type('20261');
      expect(await input.inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // 兜底：HTML 规范允许 4 位以上的年份，别的浏览器仍可能给出这种值。
  // 筛选是按字符串比大小的，位数一多比较结果就没有意义，整张表会被静默筛空。
  test('日期值位数异常时该端视为不设限，而不是把表筛空', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    await page.locator('input[type="date"]').first().evaluate((el: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '20261-08-26');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.getByText('该时段无排课')).toHaveCount(0);
    await expect(page.getByRole('cell', { name: '2026-05-13' })).toBeVisible();
  });
});

// 表格是 w-full 的：多出来的宽度加在右对齐列文字的左边、左对齐列文字的右边，
// 所以「右对齐列 → 左对齐列」这个交界处的间距永远只有两侧 padding 之和，
// 其余交界随表格变宽而变宽（1280px 实测 79~243px），唯独这里卡在 16px。
// 修复给该列补了 sm:pl-10（40px），只作用于 ≥640px：390px 实测各列交界都在
// 16~47px 同一量级，单独给一列加 40px 反而成了新的异常，窄屏保持原样。
test.describe('表格相邻列间距', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  const MIN_GAP = 32;

  async function textGap(row: import('@playwright/test').Locator, leftIndex: number) {
    return row.evaluate((tr, i) => {
      const cells = [...tr.querySelectorAll('td')];
      const textRect = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect();
      };
      return textRect(cells[i + 1]).left - textRect(cells[i]).right;
    }, leftIndex);
  }

  async function targetPadding(row: import('@playwright/test').Locator, index: number) {
    return row.evaluate(
      (tr, i) => getComputedStyle([...tr.querySelectorAll('td')][i]).paddingLeft,
      index,
    );
  }

  // 锁住断点本身：改成全宽度加缩进（去掉 sm:）或干脆去掉缩进都在这里失败，
  // 免得哪天有人「统一一下」把窄屏的列也推宽。
  for (const { tab, rowText } of [
    { tab: '排课历史', rowText: 'E2E教室' },
    { tab: '定价历史', rowText: '2026-01-01' },
  ]) {
    test(`${tab}：缩进只在 ≥640px 生效`, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto('/classes');
      await page.getByText('E2E数学班').first().click();
      await page.getByRole('button', { name: tab }).click();
      const row = page.getByRole('row').filter({ hasText: rowText }).first();
      await expect(row).toBeVisible();

      // 窄屏保持基础 padding；只断言「宽屏更大」，具体多少像素由上面的间距测试兜底
      expect(await targetPadding(row, 4)).toBe('8px'); // p-2
      await page.setViewportSize({ width: 1280, height: 720 });
      expect(parseFloat(await targetPadding(row, 4))).toBeGreaterThan(8); // sm:pl-10
    });
  }

  test('排课历史「时长」与「地点」之间留出可读间距', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    await page.getByText('E2E数学班').first().click();
    await page.getByRole('button', { name: '排课历史' }).click();
    const row = page.getByRole('row').filter({ hasText: 'E2E教室' }).first();
    await expect(row).toBeVisible();

    expect(await textGap(row, 3)).toBeGreaterThanOrEqual(MIN_GAP);
  });

  test('定价历史「优惠金额」与「原因」之间留出可读间距', async ({ authenticatedPage: page }) => {
    await page.goto('/classes');
    await page.getByText('E2E数学班').first().click();
    await page.getByRole('button', { name: '定价历史' }).click();
    const row = page.getByRole('row').filter({ hasText: '2026-01-01' }).first();
    await expect(row).toBeVisible();

    expect(await textGap(row, 3)).toBeGreaterThanOrEqual(MIN_GAP);
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
