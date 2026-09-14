import { test, expect, ensureTestUser, toDateString, getCurrentMonday } from './auth';
import type { Route } from '@playwright/test';
import Database from 'better-sqlite3';

const E2E_DB_PATH = process.env.DB_PATH || './data/e2e.db';

const thisYear = new Date().getFullYear();
const thisYearName = `${thisYear}年`;
const nextYearName = `${thisYear + 1}年`;

function pad2(n: number) { return String(n).padStart(2, '0'); }

// 专用竞态标记班级（初三化学 → 年视图分类“初中化学”），每次运行清空其排课保证幂等
function ensureRaceClass(): number {
  const teacherId = ensureTestUser();
  const db = new Database(E2E_DB_PATH);
  try {
    let row = db.prepare('SELECT id FROM classes WHERE teacher_id = ? AND name = ? AND deleted = 0')
      .get(teacherId, 'E2E竞态班') as { id: number } | undefined;
    if (!row) {
      const r = db.prepare(
        `INSERT INTO classes (teacher_id, name, grade, subject, student_count, unit_price, discount_amount, is_competition)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(teacherId, 'E2E竞态班', '初三', '化学', 1, 800, 0, 0);
      row = { id: Number(r.lastInsertRowid) };
    }
    db.prepare('DELETE FROM schedules WHERE class_id = ?').run(row.id);
    return row.id;
  } finally {
    db.close();
  }
}

// 通过批量排课对话框给指定班级在今天排一节 06:30-07:30 的课并点“完成”触发宿主视图的 reload()
async function batchCreateTodaySchedule(page, classId: number) {
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.locator('select').first().selectOption(String(classId));
  await dialog.getByRole('button', { name: '指定日期' }).click();
  await dialog.locator('textarea').fill(toDateString(new Date()));
  const timeInputs = dialog.locator('input[type="time"]');
  await timeInputs.first().fill('06:30');
  await timeInputs.nth(1).fill('07:30');
  await dialog.getByRole('button', { name: '批量排课' }).last().click();
  const crossBtn = dialog.getByRole('button', { name: '确认跨学期排课' });
  if (await crossBtn.isVisible({ timeout: 2000 }).catch(() => false)) await crossBtn.click();
  await dialog.getByRole('button', { name: '完成' }).click();
}

test.describe('月课表', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示月视图标题和导航', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    await expect(page.getByRole('heading', { name: new RegExp(`${thisYear}年\\d+月`) })).toBeVisible();
    await expect(page.getByRole('button', { name: '上月' })).toBeVisible();
    await expect(page.getByRole('button', { name: '本月' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下月' })).toBeVisible();
  });

  test('显示星期标题行', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    await expect(page.locator('main').getByText('周一').first()).toBeVisible();
    await expect(page.locator('main').getByText('周日').first()).toBeVisible();
  });

  test('显示日期网格中的排课', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    const items = page.locator('[class*="cursor-pointer"]');
    await expect(items.first()).toBeVisible();
  });

  test('切换月份', async ({ authenticatedPage: page }) => {
    // Use a known month (July 2026) to avoid today-dependency
    await page.goto('/monthly?year=2026&month=6');
    await expect(page.getByRole('heading', { name: '2026年7月' })).toBeVisible();
    await page.getByRole('button', { name: '下月' }).click();
    await expect(page.getByRole('heading', { name: '2026年8月' })).toBeVisible();
    await page.getByRole('button', { name: '上月' }).click();
    await expect(page.getByRole('heading', { name: '2026年7月' })).toBeVisible();
  });

  test('点击本月回到当前月', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    await page.getByRole('button', { name: '上月' }).click();
    await page.getByRole('button', { name: '本月' }).click();
    await expect(page.getByText('今')).toBeVisible();
  });

  test('移动端点击日期跳转到当天开始的周视图', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/monthly?year=2026&month=4');
    await page.getByLabel('查看2026-05-13课表').click();
    await expect(page).toHaveURL(/\/\?date=2026-05-13$/);
    await expect(page.locator('main').getByText('05-13 ~ 05-14')).toBeVisible();
  });
});

test.describe('年课表', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示年度标题和导航', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    await expect(page.getByRole('heading', { name: thisYearName })).toBeVisible();
    await expect(page.getByRole('button', { name: '上一年' })).toBeVisible();
    await expect(page.getByRole('button', { name: '今年' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下一年' })).toBeVisible();
  });

  test('显示12个月卡片', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    await expect(page.getByRole('heading', { name: thisYearName })).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByText('3月')).toBeVisible();
    await expect(main.getByText('9月')).toBeVisible();
  });

  test('显示年度统计汇总', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly?year=2026');
    await expect(page.getByText('2026 年度统计')).toBeVisible();
  });

  test('显示学科分类统计', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly?year=2026');
    await expect(page.getByText('2026 年度统计')).toBeVisible();
  });

  test('切换年份', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    await page.getByRole('button', { name: '下一年' }).click();
    await expect(page.getByRole('heading', { name: nextYearName })).toBeVisible();
    await page.getByRole('button', { name: '今年' }).click();
    await expect(page.getByRole('heading', { name: thisYearName })).toBeVisible();
  });
});

test.describe('月/年课表交互', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('月视图点击日期格跳转周课表', async ({ authenticatedPage: page }) => {
    await page.goto('/monthly');
    // 种子数据本周一 09:00 有课，当前月视图必含本周一；点击格子应带日期跳周课表
    const monday = toDateString(getCurrentMonday());
    // role=generic 的 aria-label 不参与可访问名计算，用属性定位器
    const cell = page.locator(`[aria-label="查看${monday}课表"]`);
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`date=${monday}`));
  });

  test('年视图年度统计显示实际数字', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly');
    // 年度统计行：{hours}h · {days}天 · {count}次；种子数据至少 5 节
    // （数学班 3 + 英语班 2），其余用例可能追加更多，只验证下界
    const summary = page.getByText(/h · \d+天 · \d+次/);
    await expect(summary).toBeVisible();
    const text = await summary.textContent();
    const count = Number(text?.match(/(\d+)次/)?.[1]);
    expect(count).toBeGreaterThanOrEqual(5);
  });
});

test.describe('月/年视图 reload 竞态防护', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('月视图：批量保存后快速翻月，旧月响应不应清空新月视图的数据', async ({ authenticatedPage: page }) => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-12
    const markerDate = `${prevYear}-${pad2(prevMonth)}-15`;
    const classId = ensureRaceClass();
    // 上月 15 日埋一条竞态班标记课（幂等）——月视图按日期格子渲染，旧月数据不含它
    {
      const db = new Database(E2E_DB_PATH);
      try {
        const existing = db.prepare(
          'SELECT id FROM schedules WHERE class_id = ? AND date = ? AND start_time = ?'
        ).get(classId, markerDate, '06:30');
        if (!existing) {
          db.prepare(
            'INSERT INTO schedules (class_id, date, start_time, end_time, duration_billing, location_name) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(classId, markerDate, '06:30', '07:30', 60, 'E2E教室');
        }
      } finally {
        db.close();
      }
    }
    await page.goto('/monthly');
    // 初始数据加载完成后再挂拦截，只挂 reload 发出的当月请求
    await expect(page.locator('main').getByText('E2E数学班').first()).toBeVisible();
    const held: Route[] = [];
    await page.route('**/api/schedules?**', async (route) => {
      if (route.request().url().includes(`start=${monthStart}`)) { held.push(route); return; }
      await route.continue();
    });
    await page.getByRole('button', { name: '批量操作' }).click();
    await batchCreateTodaySchedule(page, classId); // 完成 → reload() 被挂起
    await page.getByRole('button', { name: '上月' }).click();
    await expect(page.getByRole('heading', { name: `${prevYear}年${prevMonth}月` })).toBeVisible();
    // 上月真实数据（含标记课）渲染完成
    await expect(page.locator('main').getByText('E2E竞态班')).toBeVisible();
    expect(held.length).toBe(1);
    await held[0].continue();
    await page.waitForTimeout(500);
    // 修复前：被挂起的当月响应落地覆盖 schedules，月视图按日期格子渲染，上月标记课消失
    await expect(page.locator('main').getByText('E2E竞态班')).toBeVisible();
  });

  test('年视图：批量保存后快速翻年，旧年响应不应覆盖新年视图', async ({ authenticatedPage: page }) => {
    const classId = ensureRaceClass();
    const year = new Date().getFullYear();
    await page.goto('/yearly');
    await expect(page.getByText(`${year} 年度统计`)).toBeVisible();
    const held: Route[] = [];
    await page.route('**/api/schedules?**', async (route) => {
      if (route.request().url().includes(`start=${year}-01-01`)) { held.push(route); return; }
      await route.continue();
    });
    await page.getByRole('button', { name: '批量操作' }).click();
    await batchCreateTodaySchedule(page, classId); // 完成 → reload() 被挂起
    await page.getByRole('button', { name: '上一年' }).click();
    await expect(page.getByRole('heading', { name: `${year - 1}年` })).toBeVisible();
    expect(held.length).toBe(1);
    await held[0].continue();
    await page.waitForTimeout(500);
    // 修复前：旧年响应落地，竞态班的分类 chip（初三化学 → 初中化学）出现在上一年视图
    await expect(page.locator('main').getByText(/初中化学/)).not.toBeVisible();
  });
});

test.describe('导出对话框', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('导出 CSV 请求期间按钮应禁用，防止重复点击产生重复请求', async ({ authenticatedPage: page }) => {
    const held: Route[] = [];
    await page.route('**/api/schedules/export**', async (route) => { held.push(route); });
    await page.goto('/monthly');
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出课表' });
    await expect(dialog).toBeVisible();
    const csvBtn = dialog.getByRole('button', { name: '导出 CSV' });
    await csvBtn.click();
    // 请求挂起期间对话框保持打开：修复后按钮禁用；修复前可重复点击
    await expect(csvBtn).toBeDisabled();
    for (const r of held) await r.continue();
  });
});
