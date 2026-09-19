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
  test('同一轮事件内跨年、月、周导航也保留目标日期', async ({ authenticatedPage: page }) => {
    await page.goto('/yearly?year=2029');
    await expect(page.getByRole('heading', { name: '2029年' })).toBeVisible();
    await expect(page.getByText('1月', { exact: true })).toBeVisible();
    const urls = await page.evaluate(() => ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'].map(key => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      return location.pathname + location.search;
    }));
    expect(urls[0]).toMatch(/^\/monthly\?year=2029&month=/);
    expect(urls[1]).toMatch(/^\/\?(date|week)=2029-/);
    expect(urls[2]).toMatch(/^\/monthly\?year=2029&month=/);
    expect(urls[3]).toBe('/yearly?year=2029');
    await expect(page.getByRole('heading', { name: '2029年' })).toBeVisible();
  });

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
    await expect(page).toHaveURL(/\/\?week=2026-07-27/);
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
    // 年份必须挑一个不等于今年的，否则"保留了原年份"和"重置成今年"两种结果
    // 长得一模一样，这条用例什么都证明不了（原来用的正是当年的 2026）。
    await page.goto('/yearly?year=2029');
    await expect(page.getByRole('heading', { name: '2029年' })).toBeVisible();
    expect(2029).not.toBe(new Date().getFullYear());

    // 侧边栏顺序是 周/月/年/班级…，所以往周视图走的是 ArrowUp。原来这里按的是
    // ArrowDown——实测落到「班级管理」（不是周视图），于是这条用例走的是
    // "非课表页回年视图"那条兜底分支，跟名字说的「切换到周视图再回来」根本不是一回事，
    // 而真正的"周→年"分支（navTarget 里 weekTouchesYear 那一支）一直没人走。
    await page.keyboard.press('ArrowUp'); // → 月课表
    await expect(page).toHaveURL(/\/monthly/);
    await page.keyboard.press('ArrowUp'); // → 周课表
    await expect(page).toHaveURL(/\/(\?|$)/);

    await page.keyboard.press('ArrowDown'); // → 月课表
    await expect(page).toHaveURL(/\/monthly/);
    await page.keyboard.press('ArrowDown'); // → 年课表
    await expect(page).toHaveURL(/\/yearly\?year=2029/);
    await expect(page.getByRole('heading', { name: '2029年' })).toBeVisible();
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
  test('周视图Ctrl+左右键导航后URL同步更新为week=参数', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-07-20');
    await page.keyboard.press('Control+ArrowRight');
    await expect(page).toHaveURL(/\/\?week=2026-07-27/);
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
  test('周视图按钮切换触发CSS滑动动画', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    // Inject spy on style.setProperty to verify animation sequence
    await page.evaluate(() => {
      const divs = document.querySelectorAll('div');
      let t = null;
      for (const d of divs) { if (d.style.getPropertyValue('--day-offset')) { t = d; break; } }
      (window as any).__animLog = [];
      const orig = t!.style.setProperty.bind(t!.style);
      t!.style.setProperty = function(p: string, v: string, pr?: string) {
        (window as any).__animLog.push({ tm: performance.now(), p, v });
        return orig(p, v, pr);
      };
    });

    await page.getByRole('button', { name: '下一周' }).click();
    await page.waitForTimeout(300);

    const log = await page.evaluate(() => (window as any).__animLog);
    // Expect: transition-set → target-offset-set → snap-to-init-offset
    const transitions = log.filter((e: any) => e.p === '--day-transition');
    const offsets = log.filter((e: any) => e.p === '--day-offset');
    expect(transitions.length).toBeGreaterThanOrEqual(2); // animation + snap
    expect(offsets.length).toBeGreaterThanOrEqual(2);
    // First transition should be the animation value
    expect(transitions[0].v).toContain('220ms');
    // After animation, transition should be 'none' (snap)
    expect(transitions[transitions.length - 1].v).toBe('none');
  });

  test('键盘Ctrl+左右方向键也触发动画', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-07-20');
    await page.evaluate(() => {
      const divs = document.querySelectorAll('div');
      let t = null;
      for (const d of divs) { if (d.style.getPropertyValue('--day-offset')) { t = d; break; } }
      (window as any).__animLog2 = [];
      const orig = t!.style.setProperty.bind(t!.style);
      t!.style.setProperty = function(p: string, v: string, pr?: string) {
        (window as any).__animLog2.push({ tm: performance.now(), p, v });
        return orig(p, v, pr);
      };
    });

    await page.keyboard.press('Control+ArrowRight');
    await page.waitForTimeout(300);

    const log = await page.evaluate(() => (window as any).__animLog2);
    const transitions = log.filter((e: any) => e.p === '--day-transition');
    expect(transitions.length).toBeGreaterThanOrEqual(2);
    expect(transitions[0].v).toContain('220ms');
    expect(transitions[transitions.length - 1].v).toBe('none');
  });

  test('纯方向键左右（1天步进）也触发滑动动画', async ({ authenticatedPage: page }) => {
    await page.goto('/?date=2026-07-20');
    await page.evaluate(() => {
      const divs = document.querySelectorAll('div');
      let t = null;
      for (const d of divs) { if (d.style.getPropertyValue('--day-offset')) { t = d; break; } }
      (window as any).__animLog3 = [];
      const orig = t!.style.setProperty.bind(t!.style);
      t!.style.setProperty = function(p: string, v: string, pr?: string) {
        (window as any).__animLog3.push({ tm: performance.now(), p, v });
        return orig(p, v, pr);
      };
    });

    // Plain ArrowRight (no Ctrl/Meta) = 1-day step — must animate
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    const log = await page.evaluate(() => (window as any).__animLog3);
    const transitions = log.filter((e: any) => e.p === '--day-transition');
    const offsets = log.filter((e: any) => e.p === '--day-offset');
    // Must have animation transition + snap transition
    expect(transitions.length).toBeGreaterThanOrEqual(2);
    // First transition must be the 220ms animation
    expect(transitions[0].v).toContain('220ms');
    // Last transition must be 'none' (snap back to buffer)
    expect(transitions[transitions.length - 1].v).toBe('none');
    // Target offset must have been set (the actual slide destination)
    expect(offsets.some((o: any) => o.v !== '-33.33333333333333%')).toBe(true);
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
    // 用例名说的是"保留年份"，就得先真的有一个年份可保留。直接 goto('/students')
    // 出发时 getViewDate('year') 是 null（store 是模块内存，整页加载就清空），
    // getNavTarget 返回的是光秃秃的 /yearly——只断言 /yearly 的话，把保留逻辑
    // 整个删掉也照样绿。所以先在年视图落一个年份，再走客户端跳转过去。
    await page.goto('/yearly?year=2029');
    await expect(page.getByRole('heading', { name: '2029年' })).toBeVisible();

    // 侧边栏点击是客户端跳转，不重载页面，viewDate 才留得住
    await page.getByRole('link', { name: '学生管理' }).click();
    await expect(page).toHaveURL(/\/students/);

    await page.keyboard.press('ArrowUp'); // → classes
    await expect(page).toHaveURL(/\/classes/);
    await page.keyboard.press('ArrowUp'); // → yearly
    await expect(page).toHaveURL(/\/yearly\?year=2029/);
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

  test('年视图Home后ArrowUp到月再ArrowUp到周显示今天', async ({ authenticatedPage: page }) => {
    // Start far from today
    await page.goto(`/yearly?year=${todayYear() - 1}`);

    // Home → current year
    await page.keyboard.press('Home');
    await expect(page.getByRole('heading', { name: todayYearStr() })).toBeVisible();

    // ArrowUp → month (should be today's month, not stale)
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('heading', { name: todayMonthStr() })).toBeVisible();

    // ArrowUp → week (should be today's week, not stale)
    await page.keyboard.press('ArrowUp');
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
