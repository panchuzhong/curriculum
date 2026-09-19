import { test, expect, ensureTestUser } from './auth';
import Database from 'better-sqlite3';
import type { Route } from '@playwright/test';

test('a pending or failed report never presents the previous period totals as current', async ({ authenticatedPage: page }) => {
  await page.goto('/reports');
  await expect(page.getByRole('table').getByText('E2E数学班')).toBeVisible();
  let releaseFailure!: () => void;
  const heldFailure = new Promise<void>(resolve => { releaseFailure = resolve; });
  let fail = true;
  await page.route('**/api/schedules/summary?**', async route => {
    if (fail) {
      await heldFailure;
      await route.fulfill({ status: 503, json: { error: '报表服务暂不可用' } });
    } else {
      await route.fulfill({ json: {
        count: 2, hours: 2, revenue: 1234,
        byClass: [{ classId: 9999, name: 'E2E恢复报表', subject: '数学', grade: '高一', count: 2, hours: 2, revenue: 1234 }],
        bySubject: [], byGrade: [], byMonth: [],
      } });
    }
  });
  await page.getByRole('button', { name: '▶', exact: true }).click();
  try {
    await expect(page.getByRole('status')).toHaveText('正在加载报表…');
    await expect(page.getByRole('table')).toHaveCount(0);
    releaseFailure();
    await expect(page.getByRole('alert')).toContainText('报表服务暂不可用');
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('该时段无排课记录')).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: '▶', exact: true }).click();
    await expect(page.getByRole('table').getByText('E2E恢复报表')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    releaseFailure();
  }
});

const E2E_DB_PATH = process.env.DB_PATH || './data/e2e.db';

function pad2(n: number) { return String(n).padStart(2, '0'); }

// Guarantees the unfiltered year report spans ≥2 months while E2E英语班
// (seeded with only current-week schedules) spans exactly 1 month. This makes
// the month-chart filter assertion date-independent.
// 在「今年」和「去年」的同一个月各放一节课（幂等），用来验证跨年的自定义区间
// 不会把两条不同年份的柱子都标成「5月」。
function ensureTwoYearData() {
  const teacherId = ensureTestUser();
  const db = new Database(E2E_DB_PATH);
  try {
    const math = db.prepare("SELECT id FROM classes WHERE teacher_id = ? AND name = 'E2E数学班' AND deleted = 0")
      .get(teacherId) as { id: number };
    if (!math) throw new Error('E2E数学班 seed missing');
    const y = new Date().getFullYear();
    // 日子要避开别的用例钉住的种子日期（2026-05-13 被排课历史用例按单元格精确匹配，
    // 同一天多插一行会让那边的 getByRole('cell') 命中两个元素）。
    for (const year of [y - 1, y]) {
      const date = `${year}-04-13`;
      const existing = db.prepare('SELECT id FROM schedules WHERE class_id = ? AND date = ? AND start_time = ?')
        .get(math.id, date, '07:00');
      if (!existing) {
        db.prepare('INSERT INTO schedules (class_id, date, start_time, end_time, duration_billing, location_name) VALUES (?, ?, ?, ?, ?, ?)')
          .run(math.id, date, '07:00', '08:00', 60, 'E2E教室');
      }
    }
    return y;
  } finally {
    db.close();
  }
}

function ensureMonthFilterData() {
  const teacherId = ensureTestUser(); // also seeds E2E英语班 (current week only)
  const db = new Database(E2E_DB_PATH);
  try {
    const math = db.prepare("SELECT id FROM classes WHERE teacher_id = ? AND name = 'E2E数学班' AND deleted = 0")
      .get(teacherId) as { id: number };
    if (!math) throw new Error('E2E数学班 seed missing');
    // A 数学班 schedule in an adjacent month (day 15, 08:00, idempotent)
    const now = new Date();
    const adj = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    const adjDate = `${adj.getFullYear()}-${pad2(adj.getMonth() + 1)}-15`;
    const existing = db.prepare(
      'SELECT id FROM schedules WHERE class_id = ? AND date = ? AND start_time = ?'
    ).get(math.id, adjDate, '08:00');
    if (!existing) {
      db.prepare('INSERT INTO schedules (class_id, date, start_time, end_time, duration_billing, location_name) VALUES (?, ?, ?, ?, ?, ?)')
        .run(math.id, adjDate, '08:00', '09:30', 90, 'E2E教室');
    }
  } finally {
    db.close();
  }
}

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
    // 「统计报表」这个标题在四个标签页上都在，点完再断言一次它等于什么都没测。
    // 周报显示的是一段日期区间，月报显示的是「YYYY年M月」——要看的是这个。
    await expect(page.getByText(todayRangeRegExp())).toBeVisible();

    await page.getByRole('button', { name: '月报' }).click();
    await expect(page.getByText(thisMonthStr)).toBeVisible();
    await expect(page.getByText(todayRangeRegExp())).toHaveCount(0);
  });
});

test.describe('报表数据验证', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('汇总统计卡片显示实际数字', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    // 本周种子数据非空（数学班两节+英语班），三张卡片的数值区都必须渲染出数字，
    // expect 轮询替代固定等待
    const card = (label: string) =>
      page.locator('main .text-gray-500').filter({ hasText: label }).locator('..');
    // 只断言"有数字"是不够的：summary 还没到货、或者整个 getScheduleSummary
    // 调用被删掉时，Reports 会把三项都默认成 0 并照常渲染，而 /\d/ 正好匹配那个 0。
    // 用例名说的是"实际数字"，种子数据本周非空，所以要断言是正数。
    const numberIn = async (label: string) => {
      const txt = await card(label).innerText();
      const m = txt.replace(/[,，]/g, '').match(/\d+(?:\.\d+)?/);
      return m ? Number(m[0]) : NaN;
    };
    await expect.poll(() => numberIn('排课次数')).toBeGreaterThan(0);
    await expect.poll(() => numberIn('教学时长')).toBeGreaterThan(0);
    await expect.poll(() => numberIn('预估收入')).toBeGreaterThan(0);
  });

  test('切换班级筛选改变数据', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    // 未筛选时两个种子班都在按班级统计表里；筛选到数学班后英语班行应消失
    const table = page.getByRole('table');
    await expect(table.getByRole('cell', { name: 'E2E英语班' })).toBeVisible();
    await page.getByRole('combobox').selectOption({ label: 'E2E数学班' });
    await expect(table.getByRole('cell', { name: 'E2E英语班' })).toHaveCount(0);
    await expect(table.getByRole('cell', { name: 'E2E数学班' })).toBeVisible();
  });

  test('切换到月报后按班级统计表格有数据行', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '月报' }).click();
    // 轮询等待数据行出现（表头之外至少一行），替代固定 sleep
    await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible();
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
    // Home is a page shortcut: it must not fire while typing in the date field.
    await startInput.blur();
    await page.keyboard.press('Home');
    // Both inputs should be today
    const today = `${todayYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
    await expect(startInput).toHaveValue(today);
  });
});

test.describe('报表竞态防护', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('快速切换时段时，过期响应不应覆盖最新数据', async ({ authenticatedPage: page }) => {
    // 挂起远古空时段（2020-01）的响应，模拟乱序到达
    const held: Route[] = [];
    await page.route('**/api/schedules/summary**', async (route) => {
      if (route.request().url().includes('start=2020-01-01')) { held.push(route); return; }
      await route.continue();
    });
    await page.goto('/reports');
    // 当前周数据（非空）加载完成
    await expect(page.getByRole('heading', { name: '按班级统计' })).toBeVisible();
    // 查一个必定为空的远古时段（请求被挂起）
    await page.getByRole('button', { name: '自定义' }).click();
    const inputs = page.locator('input[type="date"]');
    await inputs.first().fill('2020-01-01');
    await inputs.nth(1).fill('2020-01-31');
    // 立刻切回周报（当前周请求放行并渲染）
    await page.getByRole('button', { name: '周报' }).click();
    await expect(page.getByRole('heading', { name: '按班级统计' })).toBeVisible();
    // 只放行最后被挂起的旧响应（必为空的 2020-01）：修复前它覆盖当前周数据
    for (let i = 0; i < held.length - 1; i++) await held[i].abort();
    expect(held.length).toBeGreaterThan(0);
    await held[held.length - 1].continue();
    await page.waitForTimeout(500);
    await expect(page.getByText('该时段无排课记录')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: '按班级统计' })).toBeVisible();
  });
});

test.describe('报表班级筛选联动', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('按月份统计图表跟随班级筛选（服务端过滤）', async ({ authenticatedPage: page }) => {
    ensureMonthFilterData();
    await page.goto('/reports');
    await page.getByRole('button', { name: '年报' }).click();

    // Unfiltered: 数学班 spans ≥2 months → month chart visible
    await expect(page.getByRole('heading', { name: '按月份统计' })).toBeVisible();

    // Filter to 英语班 (current-week only): 1 month → month chart collapses.
    // Before the fix, byMonth came unfiltered from the server so the chart
    // (and its numbers) ignored the class filter.
    await page.getByRole('combobox').selectOption({ label: 'E2E英语班' });
    await expect(page.getByRole('heading', { name: '按月份统计' })).not.toBeVisible();

    // Back to all classes: chart returns
    await page.getByRole('combobox').selectOption({ label: '全部班级' });
    await expect(page.getByRole('heading', { name: '按月份统计' })).toBeVisible();
  });

  test('历史周报切换班级时保留当前周', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '◀' }).first().click();
    const range = page.getByText(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/);
    const before = await range.textContent();
    await page.getByRole('combobox').selectOption({ label: 'E2E数学班' });
    await expect(range).toHaveText(before!);
  });
});

test.describe('自定义区间倒挂提示', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('开始日期晚于结束日期时显示提示而非静默旧数据', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '自定义' }).click();
    const inputs = page.locator('input[type="date"]');
    await inputs.first().fill('2026-05-01');
    await inputs.nth(1).fill('2026-01-01');
    await expect(page.getByText('开始日期晚于结束日期')).toBeVisible();
  });

  // 年份段不会在第 4 位后自动跳段，没有 max 时「2026」会被打成「20261」。
  // 这里的区间是拿字符串比大小的，位数一多就会误判成倒挂、停在上一个区间的数据上。
  test('年份段多打一位也不会产生位数不对的年份', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '自定义' }).click();
    const start = page.locator('input[type="date"]').first();
    await start.click();
    await page.keyboard.type('20261');

    expect(await start.inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 加上 max 之后原生控件不再留下 5 位年份，而是把年份段左移：在「2026」后面再打
  // 一位得到的是「0261」。它位数正确、也小于结束日期，倒挂判断拦不住 —— 改前会照发
  // 一个 0261 年至今的请求，卡片显示一个看起来合理的全历史聚合。
  test('年份被左移成越界值时给出提示并停发请求', async ({ authenticatedPage: page }) => {
    const summaryUrls: string[] = [];
    await page.route('**/api/schedules/summary**', route => {
      summaryUrls.push(route.request().url());
      return route.continue();
    });
    await page.goto('/reports');
    await page.getByRole('button', { name: '自定义' }).click();
    const start = page.locator('input[type="date"]').first();
    await start.click();
    await page.keyboard.type('20261');

    // 年份滑到了 1900 之前（不是 5 位年份，但同样不可用）
    expect(await start.inputValue()).toMatch(/^[01]\d{3}-\d{2}-\d{2}$/);
    await expect(page.getByText('日期无效')).toBeVisible();
    expect(summaryUrls.filter(u => /start=[01]\d{3}-/.test(u))).toEqual([]);
  });
});

// 自定义区间被拒时不发请求，下面的卡片仍显示上一个有效区间的数字——不给一句
// 说明的话，那些数字看起来就像当前区间的结果。这一段整个改动里原本一条用例都没有。
test.describe('自定义区间被拒时要说明', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('倒挂的自定义区间给出理由，而不是静默沿用上一段数据', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '自定义' }).click();
    const inputs = page.locator('input[type="date"]');
    await inputs.first().fill('2026-06-10');
    await inputs.nth(1).fill('2026-06-01');
    // 连理由一起钉：只断言共用的后半句的话，把 `${customRangeError}，` 整个去掉
    // 两条用例的输出一模一样，分开写两条就没意义了。
    await expect(page.getByText('开始日期晚于结束日期，图表为上一有效区间的数据')).toBeVisible();
  });

  test('清空一端同样给出理由', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '自定义' }).click();
    const inputs = page.locator('input[type="date"]');
    await inputs.nth(1).fill('');
    await expect(page.getByText('请填写完整的日期区间，图表为上一有效区间的数据')).toBeVisible();
  });
});

// 此前我以为这一段沟不到（从今年往上翻到 2999 要九百多下），其实往下翻到 1900
// 只需一百二十多下。下限上的三件事一起钉：按钮置灰、键盘路径抦住、而且抦了要说理由。
test.describe('年报翻到下限', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('翻到 1900 后按钮置灰，键盘再翻会说明原因', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: '年报' }).click();

    const prev = page.getByRole('button', { name: '◀' });
    const steps = new Date().getFullYear() - 1900;
    for (let i = 0; i < steps; i++) await prev.click();

    await expect(page.getByText('1900年')).toBeVisible();
    await expect(prev).toBeDisabled();

    // 键盘没有「按钮变灰」这个提示，得自己说一句
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText(/已到可用日期范围的最早一年/).first()).toBeVisible();
    await expect(page.getByText('1900年')).toBeVisible();
  });
});

test.describe('跨年的自定义区间', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  // byMonth 的标签原来只写「M月」，年份被丢掉：区间跨两个自然年时会出现两条
  // 一模一样的「5月」，老师分不出哪条是哪年。而 BarChart 的 key 取
  // item.key ?? item.label，这两条还会共用同一个 React key。
  test('按月份统计要把年份写出来，两条不同年的同月不能重名', async ({ authenticatedPage: page }) => {
    const y = ensureTwoYearData();
    await page.goto('/reports');
    await page.getByRole('button', { name: '自定义' }).click();

    const dates = page.locator('input[type="date"]');
    await dates.first().fill(`${y - 1}-01-01`);
    await dates.nth(1).fill(`${y}-12-31`);

    const chart = page.locator('main');
    await expect(chart.getByText(`${y - 1}年4月`)).toBeVisible();
    await expect(chart.getByText(`${y}年4月`)).toBeVisible();
    // 不该再出现不带年份的裸「5月」
    expect(await chart.getByText('4月', { exact: true }).count()).toBe(0);
  });

  // 对照：区间没跨年时仍然只写「M月」，不必啰嗦
  test('区间不跨年时标签仍然只写月份', async ({ authenticatedPage: page }) => {
    const y = ensureTwoYearData();
    await page.goto('/reports');
    await page.getByRole('button', { name: '自定义' }).click();

    const dates = page.locator('input[type="date"]');
    await dates.first().fill(`${y}-01-01`);
    await dates.nth(1).fill(`${y}-12-31`);

    await expect(page.locator('main').getByText('4月', { exact: true })).toBeVisible();
  });
});
