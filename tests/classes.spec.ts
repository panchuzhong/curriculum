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

  // 无定价记录的班级打开的就是一张空表单，生效日期也是空的。
  // 这条空值守卫是这次改动新加的（之前点「添加」毫无反应），此前没有用例。
  test('生效日期空着就保存时会说明原因', async ({ authenticatedPage: page }) => {
    ensureZeroPricingClass();
    await page.goto('/classes');
    await page.getByText('E2E无定价班').click();
    await page.getByRole('button', { name: '定价历史' }).click();
    await page.getByRole('button', { name: '新增定价' }).click();
    // 「拦住了」要靠「请求没发出去」来证：守卫改成「弹提示但照样提交」时，
    // 提示依旧可见，只断言文案的话用例全绿，而请求已经发出去了。
    let posts = 0;
    await page.route('**/api/classes/*/pricing', route => {
      if (route.request().method() === 'POST') { posts++; return route.abort(); }
      return route.continue();
    });

    // openAdd 总是把生效日期预填成今天，所以这条守卫只有用户自己清空时才走得到。
    await page.locator('input[type="date"]').first().fill('');
    await page.getByRole('button', { name: '添加' }).click();
    await expect(page.getByText('请先填写生效日期').first()).toBeVisible();
    expect(posts).toBe(0);
    // 留空要说「请先填写」，而不是笼统的「日期无效」。下面那条 isUsableDate 守卫
    // 对空串同样不放行，所以光看「请求没发出去」两条守卫分不开——必须断言
    // 用户读到的是针对性的那句，否则把这条守卫去掉也察觉不到。
    expect(await page.getByText('日期无效').count()).toBe(0);
  });

  // 另一条守卫：日期填得出来但越界。原生日期框的年份段能打出 5 位数，
  // min/max 只把值标成 invalid，value 照样提交——所以这里也得当场拦下并说清范围。
  test('生效日期越界时被拒，并说出范围', async ({ authenticatedPage: page }) => {
    ensureZeroPricingClass();
    await page.goto('/classes');
    await page.getByText('E2E无定价班').click();
    await page.getByRole('button', { name: '定价历史' }).click();
    await page.getByRole('button', { name: '新增定价' }).click();

    let posts = 0;
    await page.route('**/api/classes/*/pricing', route => {
      if (route.request().method() === 'POST') { posts++; return route.abort(); }
      return route.continue();
    });

    await page.locator('input[type="date"]').first().fill('3000-01-01');
    await page.getByRole('button', { name: '添加' }).click();

    await expect(page.getByText('日期无效，须在 1900-01-01 ~ 2999-12-31 之间').first()).toBeVisible();
    expect(posts).toBe(0);
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

    // 这一行钉的是本周一，所以唯一正确的值就是「周一」。原来写成
    // /^周[一二三四五六日]$/ 的话七个值都算对——而 weekdayOf 的全部内容就是
    // 那个 (getDay() + 6) % 7（WEEKDAYS 从周一起算，getDay() 从周日起算），
    // 去掉它每一行都会错一天，正则照样放行。
    await expect(row.getByRole('cell').nth(1)).toHaveText('周一');
    await expect(row.getByRole('cell').nth(2)).toHaveText('09:00-10:30');
    await expect(row.getByRole('cell').nth(3)).toHaveText('1.5h');
    await expect(row.getByRole('cell').nth(4)).toHaveText('E2E教室');
    await expect(page.getByText(/共 \d+ 节 · [\d.]+h/)).toBeVisible();
  });

  // 用户实际的复制方式：框选整张表、Ctrl+C。断言的是剪贴板里的纯文本而不是 DOM——
  // 「依旧方便复制」承诺的是粘出来的东西：关掉的列不能混进去，留下的列要按 Tab 分开。
  async function copyTable(page: import('@playwright/test').Page) {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('table').evaluate(table => {
      const range = document.createRange();
      range.selectNode(table);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press('Control+C');
    return page.evaluate(() => navigator.clipboard.readText());
  }
  const copiedRows = (text: string) => text.trim().split('\n').map(line => line.split('\t').map(c => c.trim()));

  test('显示选项默认全勾，复制出来五列都在', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    for (const name of ['年份', '星期', '时长', '地点']) {
      await expect(page.getByRole('checkbox', { name })).toBeChecked();
    }
    const monday = toDateString(getCurrentMonday());
    const rows = copiedRows(await copyTable(page));
    expect(rows[0]).toEqual(['日期', '星期', '时间', '时长', '地点']);
    expect(rows.find(r => r[0] === monday)).toEqual([monday, '周一', '09:00-10:30', '1.5h', 'E2E教室']);
  });

  test('去掉年份后日期只剩月日，复制出来也没有年份', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    const monday = toDateString(getCurrentMonday());
    await page.getByRole('checkbox', { name: '年份' }).uncheck();

    const row = page.getByRole('row').filter({ hasText: '09:00-10:30' }).first();
    await expect(row.getByRole('cell').first()).toHaveText(/^\d{2}-\d{2}$/);
    const text = await copyTable(page);
    expect(text).not.toContain(monday);
    expect(copiedRows(text).find(r => r[0] === monday.slice(5))).toEqual([monday.slice(5), '周一', '09:00-10:30', '1.5h', 'E2E教室']);
  });

  test('关掉星期、时长、地点后这几列不渲染，复制出来只剩日期和时间', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    for (const name of ['星期', '时长', '地点']) await page.getByRole('checkbox', { name }).uncheck();

    await expect(page.getByRole('columnheader')).toHaveText(['日期', '时间']);
    const monday = toDateString(getCurrentMonday());
    const rows = copiedRows(await copyTable(page));
    expect(rows[0]).toEqual(['日期', '时间']);
    expect(rows.find(r => r[0] === monday)).toEqual([monday, '09:00-10:30']);
    // 小计按全部课算，与显示哪几列无关
    await expect(page.getByText(/共 \d+ 节 · [\d.]+h/)).toBeVisible();
  });

  test('只看不点时不往本机存储写东西；点了只写点到的那一项', async ({ authenticatedPage: page }) => {
    // 一打开就把整份默认值写回去的话，以后改了默认值，只是看过一眼的用户也会被
    // 旧默认值钉住；整份覆盖还会抹掉别的标签页刚存的选择。
    await openHistory(page);
    await expect(page.getByRole('checkbox', { name: '年份' })).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('scheduleHistory.columns'))).toBeNull();

    await page.getByRole('checkbox', { name: '年份' }).uncheck();

    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('scheduleHistory.columns')) ?? 'null'))
      .toEqual({ year: false });
  });

  test('显示选项刷新后还在', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    await page.getByRole('checkbox', { name: '地点' }).uncheck();
    await page.getByRole('checkbox', { name: '年份' }).uncheck();

    await openHistory(page); // 重新进页面，不是只切一下标签
    await expect(page.getByRole('checkbox', { name: '地点' })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: '年份' })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: '星期' })).toBeChecked();
    await expect(page.getByRole('columnheader', { name: '地点' })).toHaveCount(0);
  });

  test('「复制表格」复制的和框选整张表复制的一样', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    // 关掉两项再比：按钮得跟着显示选项走，而不是永远复制五列。
    await page.getByRole('checkbox', { name: '年份' }).uncheck();
    await page.getByRole('checkbox', { name: '时长' }).uncheck();
    const bySelection = copiedRows(await copyTable(page));
    // 先往剪贴板里放点别的：不这样的话剪贴板里本来就是框选复制的结果，按钮什么都
    // 不写、只弹一句「已复制」也能过。
    await page.evaluate(() => navigator.clipboard.writeText('（剪贴板旧内容）'));

    await page.getByRole('button', { name: '复制表格' }).click();

    const toast = page.getByText(/已复制 \d+ 节课/);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveClass(/bg-green-600/); // 成功用成功的样式，不是和失败一样的红色
    const byButton = copiedRows(await page.evaluate(() => navigator.clipboard.readText()));
    expect(byButton).toEqual(bySelection);
    expect(byButton[0]).toEqual(['日期', '星期', '时间', '地点']);
  });

  test('没有剪贴板 API 时（内网 http 部署）照样能复制', async ({ authenticatedPage: page }) => {
    // navigator.clipboard 只在安全上下文（HTTPS / localhost）里有；部署在内网 http
    // 地址上它就是 undefined。这时得退回 execCommand，而不是点了没反应。
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      const real = navigator.clipboard;
      (window as any).__readClipboard = () => real.readText();
      (window as any).__writeClipboard = (text: string) => real.writeText(text);
      Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
    });
    await openHistory(page);
    // 剪贴板在浏览器上下文之间是共用的：先放点别的，才知道这次确实写进去了。
    await page.evaluate(() => (window as any).__writeClipboard('（剪贴板旧内容）'));
    const button = page.getByRole('button', { name: '复制表格' });

    await button.click();

    await expect(page.getByText(/已复制 \d+ 节课/)).toBeVisible();
    const rows = copiedRows(await page.evaluate(() => (window as any).__readClipboard()));
    expect(rows[0]).toEqual(['日期', '星期', '时间', '时长', '地点']);
    // 回退路径借一个隐藏的 textarea 选中文字，焦点会被它抢走；用完得还回来，
    // 不然键盘用户下一次 Tab 得从页面顶上重新数。
    await expect(button).toBeFocused();
  });

  test('两种复制方式都失败时，说清楚并给出替代办法', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
      // execCommand 失败时多半是返回 false 而不是抛错：只看有没有抛错的话，
      // 会在什么都没复制的情况下告诉用户「已复制」。
      document.execCommand = () => false;
    });
    await openHistory(page);

    await page.getByRole('button', { name: '复制表格' }).click();

    await expect(page.getByText('复制失败，请框选表格后按 Ctrl+C')).toBeVisible();
    // 失败提示已经在屏幕上了，要是同时还弹过「已复制」，此刻它也还在（提示会叠着
    // 显示几秒）。只数一次：toHaveCount 会一直重试到它自己消失为止。
    expect(await page.getByText(/已复制/).count()).toBe(0);
  });

  test('区间里没有课时「复制表格」不可点', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    await page.locator('input[type="date"]').first().fill('2000-01-01');
    await page.locator('input[type="date"]').nth(1).fill('2000-01-31');

    await expect(page.getByText('该时段无排课')).toBeVisible();
    await expect(page.getByRole('button', { name: '复制表格' })).toBeDisabled();
  });

  test('去掉年份且列表跨年时提示日期会有歧义', async ({ authenticatedPage: page }) => {
    // 跨年的学期是常态（秋季从 9 月到次年 1 月），不带年份时 12-28 和 01-04 谁先谁后
    // 只能靠排列顺序猜。用拦截造一个跨年的列表，不往库里写东西。
    // 排课历史一次拉全部排课，查询下界就是 DATE_MIN。
    await page.route(url => url.pathname === '/api/schedules' && url.searchParams.get('start') === '1900-01-01',
      route => route.fulfill({ json: [
        { id: 9001, classId: 1, date: '2026-12-28', startTime: '09:00', endTime: '10:30', durationBilling: 90, locationName: 'E2E教室' },
        { id: 9002, classId: 1, date: '2027-01-04', startTime: '09:00', endTime: '10:30', durationBilling: 90, locationName: 'E2E教室' },
      ] }));
    await openHistory(page);
    // 默认区间按学期推，随日历会变；两端清空 = 全部，用例才不会哪天过期。
    await page.locator('input[type="date"]').nth(0).fill('');
    await page.locator('input[type="date"]').nth(1).fill('');
    await expect(page.getByRole('cell', { name: '2027-01-04' })).toBeVisible();

    const hint = page.getByText('不带年份时分不清是哪一年');
    await expect(hint).toHaveCount(0); // 带着年份时不需要提示
    await page.getByRole('checkbox', { name: '年份' }).uncheck();
    await expect(hint).toBeVisible();
    // 拖选表格往上多拖了一点时，这行提示不能混进复制内容——和上面那排勾选框一样。
    await expect(hint).toHaveCSS('user-select', 'none');
  });

  test('时段内没有排课时给出提示', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    await page.locator('input[type="date"]').first().fill('2000-01-01');
    await page.locator('input[type="date"]').nth(1).fill('2000-01-31');

    await expect(page.getByText('该时段无排课')).toBeVisible();
  });

  // 年份段不会在第 4 位后自动跳段，直接键入整个日期时多出的数字继续落在年份里。
  // 没有 max 约束时年份能涨到 5 位以上，「2026」就变成了「20261」；加上 max 之后
  // 改为把年份段整个左移，「2026」再打一位得到的是「0261」。
  //
  // click() 落在哪个段取决于横坐标，填好的日期框点中心往往落在月/日段；
  // 数字进了月/日段，「年份是 4 位」就成了一句永远成立的空话。所以先把光标
  // 明确移到最左边的年份段，再用「年份滑到了 1900 之前」来证明数字确实落在了年份上。
  test('年份段多打一位只会把年份左移，不会产生位数不对的年份', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    const start = page.locator('input[type="date"]').first();
    await start.press('ArrowLeft');
    await start.press('ArrowLeft');
    await page.keyboard.type('20261');

    expect(await start.inputValue()).toMatch(/^[01]\d{3}-\d{2}-\d{2}$/);
    await expect(page.getByText(/日期无效/)).toBeVisible();
  });

  // 兜底：HTML 规范允许 4 位以上的年份，别的浏览器仍可能给出这种值。
  // 筛选是按字符串比大小的，位数一多比较结果就没有意义；当成「该方向不设限」
  // 的话，输入框里还显示着 20261-08-26，下面的「共 N 节」却静默涨成了该班全部历史。
  test('日期值位数异常时给出理由，而不是静默改变统计口径', async ({ authenticatedPage: page }) => {
    await openHistory(page);
    await page.locator('input[type="date"]').first().evaluate((el: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '20261-08-26');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.getByText(/日期无效/)).toBeVisible();
    await expect(page.getByText(/共 \d+ 节/)).toHaveCount(0);
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

  test('排课请求失败显示错误而非空历史，重试后恢复', async ({ authenticatedPage: page }) => {
    await page.route('**/api/schedules?**', route =>
      route.fulfill({ status: 503, json: { error: '排课历史暂不可用' } }));
    await page.goto('/classes');
    await page.getByText('E2E数学班', { exact: true }).click();
    await page.getByRole('button', { name: '排课历史' }).click();
    await expect(page.getByRole('alert')).toContainText('排课历史暂不可用');
    await expect(page.getByText('该时段无排课')).toHaveCount(0);
    await page.unroute('**/api/schedules?**');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

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

test.describe('被拦下的操作要说明原因', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  // 线上课不该拿去问高德：短路分支直接清空经纬度并说一声。
  // 这条提示此前没有用例，而它也是「不发请求」的唯一可观察证据。
  test('线上课直接清空经纬度，不请求上游', async ({ authenticatedPage: page }) => {
    await page.route('**/api/geocode/status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }));
    let upstreamCalls = 0;
    await page.route('**/api/geocode?**', async route => { upstreamCalls++; await route.abort(); });

    await page.goto('/classes');
    await page.getByRole('button', { name: '新建班级' }).click();
    const btn = page.getByRole('button', { name: '获取经纬度' });
    const input = page.locator('div.flex.gap-2').filter({ has: btn }).locator('input');

    await input.fill('线上');
    await btn.click();
    await expect(page.getByText('线上课程无需经纬度，已清空').first()).toBeVisible();
    expect(upstreamCalls).toBe(0);
  });

  test('默认地点只打空格时「获取经纬度」保持禁用', async ({ authenticatedPage: page }) => {
    // 没配 AMAP_KEY 时这个按钮压根不渲染，先把 status 打开
    await page.route('**/api/geocode/status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }));
    await page.goto('/classes');
    await page.getByRole('button', { name: '新建班级' }).click();

    const btn = page.getByRole('button', { name: '获取经纬度' });
    await expect(btn).toBeVisible();
    // label 没挂 htmlFor，用按钮所在的那一行反查输入框
    const input = page.locator('div.flex.gap-2').filter({ has: btn }).locator('input');

    await expect(btn).toBeDisabled();
    // 修复前：置灰条件读的是未 trim 的原值，一个空格就把按钮点亮，
    // 而 handler trim 完为空直接 return——点下去毫无反应，也没人说为什么。
    await input.fill('   ');
    await expect(btn).toBeDisabled();
    await input.fill('上海市徐汇区');
    await expect(btn).toBeEnabled();
  });
});
