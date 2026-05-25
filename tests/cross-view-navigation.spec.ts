import { test, expect } from './auth';

// Date helpers — compute dynamic values so tests don't break as time passes
function pad(n: number) { return String(n).padStart(2, '0'); }
function todayYear() { return new Date().getFullYear(); }
function todayMonthIdx() { return new Date().getMonth(); }
function todayYearStr() { return `${todayYear()}年`; }
function todayMonthStr() { return `${todayYear()}年${todayMonthIdx() + 1}月`; }
function nextYearStr() { return `${todayYear() + 1}年`; }
function prevYearStr() { return `${todayYear() - 1}年`; }
function todayMonday() {
  const d = new Date(); d.setDate(d.getDate() - (d.getDay() || 7) + 1); return d;
}
function todayWeekText() {
  const m = todayMonday(); const s = new Date(m); s.setDate(m.getDate() + 6);
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())} ~ ${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
}
function todayWeekRegExp() {
  return new RegExp(todayWeekText().replace(/[.~ -]/g, '\\$&'));
}

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
    await page.goto(`/yearly?year=${todayYear() + 1}`);
    await page.keyboard.press('Home');
    await expect(page.getByRole('heading', { name: todayYearStr() })).toBeVisible();
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

test.describe('非周一weekStart的精确周保留', () => {
  test('周视图ArrowRight推进到周二后方向键往返保持同样的周', async ({ authenticatedPage: page }) => {
    // Start at Monday May 25
    await page.goto('/?date=2026-05-25');
    await expect(page.getByText(/2026-05-25 ~ 2026-05-31/)).toBeVisible();

    // ArrowRight advances by 1 day → Tuesday May 26
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText(/2026-05-26 ~ 2026-06-01/)).toBeVisible();

    // ArrowDown to month → ArrowUp back
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');

    // Should still show 2026-05-26 ~ 2026-06-01 (not shifted to 05-25)
    await expect(page.getByText(/2026-05-26 ~ 2026-06-01/)).toBeVisible();
  });
});

test.describe('周→月→年→月→周全往返保留日期', () => {
  test('8月3日周→月→年→月→周不丢失上下文', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-08-03');
    await expect(page.getByText(/2026-08-03 ~ 2026-08-09/)).toBeVisible();

    // Week → Month (August)
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/monthly\?year=2026&month=7/);
    await expect(page.getByRole('heading', { name: '2026年8月' })).toBeVisible();

    // Month → Year (2026)
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/yearly\?year=2026/);

    // Year → Month (should be August, not May)
    await page.keyboard.press('ArrowUp');
    await expect(page).toHaveURL(/\/monthly\?year=2026&month=7/);
    await expect(page.getByRole('heading', { name: '2026年8月' })).toBeVisible();

    // Month → Week (should be Aug 3, not May 4)
    await page.keyboard.press('ArrowUp');
    await expect(page.getByText(/2026-08-03 ~ 2026-08-09/)).toBeVisible();
  });

  test('7月周→月→年→月→周全往返', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-07-13');
    await expect(page.getByText(/2026-07-13 ~ 2026-07-19/)).toBeVisible();

    await page.keyboard.press('ArrowDown'); // → July month
    await page.keyboard.press('ArrowDown'); // → 2026 year
    await page.keyboard.press('ArrowUp');   // → July month
    await page.keyboard.press('ArrowUp');   // → July week

    await expect(page.getByText(/2026-07-13 ~ 2026-07-19/)).toBeVisible();
  });
});

test.describe('方向键完整循环所有侧边栏链接', () => {
  test('从周课表连续按8次方向键下可环回周课表', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-08-03');

    // NAV_LINKS: /, /monthly, /yearly, /classes, /students, /semesters, /reports, /settings
    await page.keyboard.press('ArrowDown'); // → monthly
    await expect(page).toHaveURL(/\/monthly/);
    await page.keyboard.press('ArrowDown'); // → yearly
    await expect(page).toHaveURL(/\/yearly/);
    await page.keyboard.press('ArrowDown'); // → classes
    await expect(page).toHaveURL(/\/classes/);
    await page.keyboard.press('ArrowDown'); // → students
    await expect(page).toHaveURL(/\/students/);
    await page.keyboard.press('ArrowDown'); // → semesters
    await expect(page).toHaveURL(/\/semesters/);
    await page.keyboard.press('ArrowDown'); // → reports
    await expect(page).toHaveURL(/\/reports/);
    await page.keyboard.press('ArrowDown'); // → settings
    await expect(page).toHaveURL(/\/settings/);
    await page.keyboard.press('ArrowDown'); // → back to week (wrap)
    await expect(page).toHaveURL(/\/(\?|$)/);
  });

  test('从设置方向键上可回到统计报表再回到学期管理', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await page.keyboard.press('ArrowUp'); // → reports
    await expect(page).toHaveURL(/\/reports/);
    await page.keyboard.press('ArrowUp'); // → semesters
    await expect(page).toHaveURL(/\/semesters/);
    await page.keyboard.press('ArrowUp'); // → students
    await expect(page).toHaveURL(/\/students/);
    await page.keyboard.press('ArrowUp'); // → classes
    await expect(page).toHaveURL(/\/classes/);
    await page.keyboard.press('ArrowUp'); // → yearly
    await expect(page).toHaveURL(/\/yearly/);
    await page.keyboard.press('ArrowUp'); // → monthly
    await expect(page).toHaveURL(/\/monthly/);
    await page.keyboard.press('ArrowUp'); // → week
    await expect(page).toHaveURL(/\/(\?|$)/);
  });

  test('从学生管理方向键上到班级管理再到年课表保留年份', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    await page.keyboard.press('ArrowUp'); // → classes
    await expect(page).toHaveURL(/\/classes/);
    await page.keyboard.press('ArrowUp'); // → yearly
    await expect(page).toHaveURL(/\/yearly/);
  });
});

test.describe('非课表页面切换后课表视图日期上下文', () => {
  test('班级管理方向键上到年课表再上到月课表保留年份→月份', async ({ authenticatedPage: page }) => {
    // Set up: visit August week, then month, so stored dates are August
    await page.goto('/?date=2026-08-03');
    await page.keyboard.press('ArrowDown'); // → August month
    await expect(page.getByRole('heading', { name: '2026年8月' })).toBeVisible();

    // Navigate down past yearly, classes, to students
    await page.keyboard.press('ArrowDown'); // → year
    await page.keyboard.press('ArrowDown'); // → classes
    await page.keyboard.press('ArrowDown'); // → students
    await expect(page).toHaveURL(/\/students/);

    // Go back up: students → classes → yearly → monthly
    await page.keyboard.press('ArrowUp'); // → classes
    await page.keyboard.press('ArrowUp'); // → yearly (2026)
    await expect(page).toHaveURL(/\/yearly\?year=2026/);
    await page.keyboard.press('ArrowUp'); // → monthly (should be August)
    await expect(page).toHaveURL(/\/monthly\?year=2026&month=7/);
    await expect(page.getByRole('heading', { name: '2026年8月' })).toBeVisible();
  });
});

test.describe('非周一weekStart完整循环保留', () => {
  test('周三weekStart循环8个页面后保留同样的周', async ({ authenticatedPage: page }) => {
    // Set up: navigate to Wednesday June 3 (3 days past Monday June 1 → two ArrowRight clicks)
    await page.goto('/?date=2026-06-01');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText(/2026-06-03 ~ 2026-06-09/)).toBeVisible();

    // Full ArrowDown cycle through all 8 links back to week
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowDown');
    }

    // Should preserve the exact same week, not shift to Monday
    await expect(page).toHaveURL(/\/\?week=2026-06-03/);
    await expect(page.getByText(/2026-06-03 ~ 2026-06-09/)).toBeVisible();
  });
});

test.describe('Home键重置后跨视图导航', () => {
  test('月视图Home后ArrowUp应回到今天所在的周', async ({ authenticatedPage: page }) => {
    // Use August as a date far from any possible today
    await page.goto('/monthly?year=2026&month=7');
    await expect(page.getByRole('heading', { name: '2026年8月' })).toBeVisible();

    // Home → today's month
    await page.keyboard.press('Home');
    await expect(page.getByRole('heading', { name: todayMonthStr() })).toBeVisible();

    // ArrowUp → should be today's week (not day-10 week from stale data)
    await page.keyboard.press('ArrowUp');
    await expect(page.getByText(todayWeekRegExp())).toBeVisible();
  });

  test('年视图Home后ArrowDown到月再ArrowDown到周显示今天', async ({ authenticatedPage: page }) => {
    // Start far from today
    await page.goto(`/yearly?year=${todayYear() - 1}`);

    // Home → current year
    await page.keyboard.press('Home');
    await expect(page.getByRole('heading', { name: todayYearStr() })).toBeVisible();

    // ArrowDown → month (should be today's month, not stale)
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('heading', { name: todayMonthStr() })).toBeVisible();

    // ArrowDown → week (should be today's week, not stale)
    await page.keyboard.press('ArrowDown');
    await expect(page.getByText(todayWeekRegExp())).toBeVisible();
  });

  test('周视图Home后ArrowDown到月再ArrowDown到年再ArrowUp回到周保留今天', async ({ authenticatedPage: page }) => {
    // Start far from today
    await page.goto(`/?date=${todayYear() - 1}-12-25`);

    // Home → today's week
    await page.keyboard.press('Home');
    await expect(page.getByText('今天')).toBeVisible();

    // ArrowDown → month
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('heading', { name: todayMonthStr() })).toBeVisible();

    // ArrowDown → year
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('heading', { name: todayYearStr() })).toBeVisible();

    // ArrowUp → month (today, not stale)
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('heading', { name: todayMonthStr() })).toBeVisible();

    // ArrowUp → week (today, not stale)
    await page.keyboard.press('ArrowUp');
    await expect(page.getByText(todayWeekRegExp())).toBeVisible();
  });
});
