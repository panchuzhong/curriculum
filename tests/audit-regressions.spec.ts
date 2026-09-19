import { test, expect } from './auth';

test('an obsolete delete preview cannot authorize deletion after the class changes', async ({ authenticatedPage: page }) => {
  let releasePreview: () => void;
  const heldPreview = new Promise<void>(resolve => { releasePreview = resolve; });
  await page.route('**/api/schedules/batch', async route => {
    expect(route.request().postDataJSON().dryRun).toBe(true);
    await heldPreview;
    await route.fulfill({ json: { count: 7, ids: [1, 2, 3, 4, 5, 6, 7] } });
  });
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('button', { name: '批量删课' }).click();
  await dialog.getByRole('button', { name: '日期范围' }).click();
  const classSelect = dialog.getByRole('combobox').first();
  await classSelect.selectOption({ label: 'E2E数学班 (高一 数学)' });
  await dialog.locator('input[type="date"]').first().fill('2026-09-01');
  await dialog.locator('input[type="date"]').nth(1).fill('2026-09-30');
  const sent = page.waitForRequest('**/api/schedules/batch');
  await dialog.getByRole('button', { name: '预览删除' }).click();
  await sent;
  await classSelect.selectOption({ label: 'E2E英语班 (高二 英语)' });
  const response = page.waitForResponse('**/api/schedules/batch');
  releasePreview!();
  await (await response).finished();
  // Let the response's promise callbacks and React's render complete.
  await page.waitForTimeout(100);
  await expect(dialog.getByRole('button', { name: '确认', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '预览删除' })).toBeVisible();
});

test('batch scheduling preserves zero billing and displays missing holiday data', async ({ authenticatedPage: page }) => {
  let submitted;
  await page.route('**/api/schedules/batch', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { count: 1, ids: [1], holidayDataMissing: ['2090'] } });
  });
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('combobox').first().selectOption({ label: 'E2E数学班 (高一 数学)' });
  // 班级和学期是两个并行请求，选班级只等到了前者；学期还没预选上时
  // handleSubmit 会静静地提前 return，弹窗停在表单上，这条用例就零星地超时。
  await expect(dialog.getByRole('combobox').nth(1)).not.toHaveValue('');
  await dialog.getByRole('spinbutton').fill('0');
  await dialog.getByRole('button', { name: '批量排课', exact: true }).last().click();
  // 先断言请求真的发了：这条用例偶尔会在全量跑里超时（单跑/重复跑/冷缓存都重现不了），
  // 而「成功排课」超时区分不了是根本没提交还是没渲染。下次再遇到时，报错直接说清楚是哪一种。
  await expect.poll(() => submitted, { timeout: 5000 }).toBeDefined();
  await expect(dialog.getByText('成功排课 1 次')).toBeVisible();
  expect(submitted.durationBilling).toBe(0);
  await expect(dialog.getByText(/2090.*未跳过节假日/)).toBeVisible();
});

for (const view of ['monthly', 'yearly']) {
  test(`${view} export displays the historical year that it will export`, async ({ authenticatedPage: page }) => {
    await page.goto(`/${view}?year=2019&month=0`);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出课表' });
    await expect(dialog.getByRole('combobox').first()).toHaveValue('2019');
    const endYearIndex = view === 'monthly' ? 2 : 1;
    await expect(dialog.getByRole('combobox').nth(endYearIndex)).toHaveValue('2019');
  });
}

test('invalid weekly URL dates fall back to a usable current week', async ({ authenticatedPage: page }) => {
  await page.goto('/?week=invalid&date=2026-02-30');
  await expect(page.getByRole('button', { name: '下一周', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}/);
});

test('a pending weekly animation cannot navigate back after switching views', async ({ authenticatedPage: page }) => {
  await page.keyboard.press('ArrowRight');
  // Trigger the view switch before the 220 ms slide finishes.
  await page.getByRole('link', { name: '月课表' }).evaluate((link: HTMLAnchorElement) => link.click());
  await expect(page).toHaveURL(/\/monthly/);
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/monthly/);
});

// 年份段不会在第 4 位后自动跳段：年份打到一半（0002）就点「生成日期」，下面的
// 循环会从那一年一天天走到结束日期 —— 七十多万个日期、8MB 字符串，全塞进输入框。
// min/max 拦不住，浏览器对越界值只标 invalid，value 照样给出来。
test('an out-of-range start date cannot flood the date list', async ({ authenticatedPage: page }) => {
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('button', { name: '指定日期' }).click();
  const dates = dialog.locator('input[type="date"]');
  await dates.nth(1).fill('2026-09-30');
  await dates.first().fill('0002-01-01');
  await dialog.getByRole('button', { name: '生成日期' }).click();

  await expect(page.getByText(/日期无效/).first()).toBeVisible();
  expect((await dialog.locator('textarea').inputValue()).length).toBeLessThan(200);
});

// 上下限之内也可能是几十年的跨度：1900-01-01 ~ 2999-12-31 逐日就是 40 万个日期，
// 先在主线程拼出几 MB 的字符串，再被服务端「dates 最多 365 项」整单打回。
// 截断到 365 而不是丢弃：提示说「最多生成 365 个」，输入框里就得真的有 365 个。
test('an in-range decades-long span cannot build a 400k-date list', async ({ authenticatedPage: page }) => {
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('button', { name: '指定日期' }).click();
  const dates = dialog.locator('input[type="date"]');
  // 先填结束日期，避免开始日期一改就把结束日期顺延成 +9 天
  await dates.nth(1).fill('2999-12-31');
  await dates.first().fill('1900-01-01');
  await dialog.getByRole('button', { name: '生成日期' }).click();

  await expect(page.getByText(/一次最多生成 365 个日期/).first()).toBeVisible();
  const generated = (await dialog.locator('textarea').inputValue()).split(/[,，\s]+/).filter(Boolean);
  expect(generated).toHaveLength(365);
  expect(generated[0]).toBe('1900-01-01');
  // 截断的提示得活过 toast 的 3 秒：截断后的 365 个日期本身是合法输入，
  // 错过提示的人会直接提交，以为排完了整个区间
  await expect(dialog.getByText(`已截断到 ${generated[364]}`)).toBeVisible();
});

// 日期列表是一个 textarea，可以手敲也可以粘贴，不经过日期输入框：日期框上的
// min/max 和校验都管不到它。服务端的 isValidDate 曾经收 0261-01-01，存进去之后所有
// 视图都按区间查询，这批排课再也看不到、删不掉。
test('a hand-edited date list cannot smuggle an out-of-range date past the pickers', async ({ authenticatedPage: page }) => {
  // 「没排进去」最硬的证据是请求压根没发出去。原先靠的是
  // getByText(/成功排课/).toHaveCount(0)——toHaveCount 会重试，真排成了、提示
  // 三秒后自己消失，这条断言照样通过。
  let posts = 0;
  await page.route('**/api/schedules/batch', route => { posts++; return route.abort(); });

  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('combobox').first().selectOption({ label: 'E2E数学班 (高一 数学)' });
  await dialog.getByRole('button', { name: '指定日期' }).click();
  await dialog.locator('textarea').fill('2026-09-21, 0261-01-01');
  // 上方的操作类型切换和底部的提交按钮同名，要的是后者
  await dialog.getByRole('button', { name: '批量排课' }).last().click();

  await expect(page.getByText(/日期无效/).first()).toBeVisible();
  // 停在表单上，没有走到「成功排课 N 次」那一屏
  await expect(dialog.locator('textarea')).toBeVisible();
  expect(posts).toBe(0);
});

// 服务端的 isValidDate 收紧到 1900~2999 后，前端放行的年份范围得跟上：
// intParam 曾放行 1000~9999，/yearly?year=1000 会让区间查询 400，页面只剩一张空表
// 加一条「加载课表失败」。周视图的 ?week= 参数同理。
test('out-of-range year/week URL params fall back instead of 400ing the whole view', async ({ authenticatedPage: page }) => {
  const thisYear = new Date().getFullYear();

  // 不要再写 expect(getByText(/加载课表失败/)).toHaveCount(0)：那句话是
  // toast(e.message || '加载课表失败') 的兜底，而 api.js 把服务端的 error 原样
  // 抛出来、服务端每个响应都带 error，所以它永远不会出现——断言恒成立，什么都拦不住。
  // 改成正面断言：视图确实渲染出来了。
  await page.goto('/yearly?year=1000');
  await expect(page.getByRole('heading', { name: `${thisYear}年` })).toBeVisible();
  await expect(page.locator('main').getByText('3月')).toBeVisible();

  await page.goto('/monthly?year=9999&month=0');
  await expect(page.getByRole('heading', { name: new RegExp(`^${thisYear}年`) })).toBeVisible();
  await expect(page.locator('main').getByText('周一').first()).toBeVisible();

  // 这一腿原本只断言「没有加载课表失败」，而那句话根本不会出现（见下），
  // 等于什么都没拦。改成正面断言：年份 1000 被拒后退回一个可用的当前周，
  // 网格里不得出现 1000 年的列。
  await page.goto('/?week=1000-01-01');
  await expect(page.getByRole('button', { name: '上一周' })).toBeEnabled();
  await expect(page.getByText(/1000-/)).toHaveCount(0);
});

// 周视图前后各多取 7 天做缓冲：贴着下限的那一周，缓冲落到 1899 年，
// 传给服务端就是 400——显示的日期合法，请求参数却不合法。
test('the weekly buffer at the lower bound does not 400 the fetch', async ({ authenticatedPage: page }) => {
  // 盯真正发出去的区间，而不是断言「没弹加载课表失败」：
  // api.js 把服务端的 message 原样抛出来，真 400 时弹的是
  // 「start/end 须为有效的 YYYY-MM-DD（1900-01-01 ~ 2999-12-31）」，
  // 那条正则永远匹配不上，把 fetchRange 的夹整个删掉也照样绿。
  //
  // 两端都要看。只收 start 的话，只删掉 fetchRange 里结束那一个 clamp
  // 照样全绿：下限那一周的结束（weekStart+13）本来就在范围内，
  // 而上限那一周才是结束 clamp 唯一管用的地方。
  const ranges: { start: string | null; end: string | null }[] = [];
  await page.route('**/api/schedules?**', async route => {
    const q = new URL(route.request().url()).searchParams;
    ranges.push({ start: q.get('start'), end: q.get('end') });
    await route.continue();
  });

  await page.goto('/?week=1900-01-01');
  await expect(page.getByText('1900-01-01 ~ 1900-01-07')).toBeVisible();

  // 上限：dates[20] = weekStart+13，不夹的话发出去的就是 end=3000-01-xx，
  // 服务端 400，整张表空掉。
  await page.goto('/?week=2999-12-31');
  await expect(page.getByText('2999-12-31 ~ 3000-01-06')).toBeVisible();

  expect(ranges.length).toBeGreaterThan(0);
  for (const r of ranges) {
    expect(r.start).not.toBeNull();
    expect(r.end).not.toBeNull();
    expect(r.start! >= '1900-01-01').toBe(true);
    expect(r.end! <= '2999-12-31').toBe(true);
  }
});

// 月/年视图翻不出上下限，周视图也不能：翻出去之后请求会被夹回边界，
// 屏上列出的日期和真正查询的区间就不是同一段了。
test('weekly paging stops at the upper bound instead of drifting past it', async ({ authenticatedPage: page }) => {
  await page.goto('/?week=2999-12-31');
  // 越界的一步不走，而且按钮是灰的——拦了又不说，和页面卡死了没区别
  await expect(page.getByRole('button', { name: '下一周' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '后一天' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '上一周' })).toBeEnabled();

  await expect(page).toHaveURL(/week=2999-12-31/);

  // 标题说的区间和网格里列出的列是同一段（包括尾巴上越界的那几个空格子）；
  // 夹的是抓取区间和导出默认值，不是显示。
  // 这样周一对齐和「范围内每一天都看得到」两个性质都保住了。
  await expect(page.getByText('2999-12-31 ~ 3000-01-06')).toBeVisible();

  // 键盘没有「按钮变灰」这个提示，得说一声，否则和页面卡死了没区别
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/已到可用日期范围的最晚一天/)).toBeVisible();
  await expect(page).toHaveURL(/week=2999-12-31/);
});

// useBoundWarning 的限流就是这个 hook 存在的全部理由，而它此前没有任何用例：
// 把「seen.has(message) 就返回」整句删掉，整套单测全绿。
// 两件事要分开钉：同一句话不重弹，不同的话得各弹各的（限流是按文案做的，
// 按「有没有弹过」做的话，交替按方向键和 Ctrl+方向键就能把第二句吞掉）。
test('在边界上连按方向键只弹一条，不同的提示各弹各的', async ({ authenticatedPage: page }) => {
  await page.goto('/?week=2999-12-31');
  await expect(page.getByRole('button', { name: '下一周' })).toBeDisabled();

  // 长按方向键就是连续触发；不限流的话这里会堆出 4 条
  //（ToastProvider 最多同时显示 5 条，没到截断的份上）。
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  const oneDay = page.getByText(/已到可用日期范围的最晚一天/);
  await expect(oneDay.first()).toBeVisible();
  // 和本用例末尾同一个理由：toHaveCount 会一直重试，限流真坏掉、4 条真堆上去时，
  // 它只会等到多余的几条过期、剩下一条，然后给通过。这里要的是「此刻就只有一条」。
  await page.waitForTimeout(150);
  expect(await oneDay.count()).toBe(1);

  // Ctrl+方向键跨 visibleDays 天，报的是另一句话，不能被上一句的限流盖掉。
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByText(/这一步跨 \d+ 天，会超出可用日期范围/).first()).toBeVisible();

  // 限流是「一段时间内不重弹」，不是「一辈子只弹一次」。过了窗口又撞到边界，
  // 还得再说一遍——没有那句按时间清陈旧项的话，这一句从此再也不会出现。
  await expect(oneDay).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(oneDay.first()).toBeVisible();

  // 限流窗口不能比 toast 的存活时间短（ToastProvider 导出 TOAST_DURATION_MS 就是为了这个）：
  // 短了的话第二条会在第一条还没消失时就堆上去。等一段比窗口短、又不到 toast 过期的时间，
  // 再按一下：窗口正常就仍然只有一条，被改短了就会变成两条。
  await page.waitForTimeout(2000);
  await page.keyboard.press('ArrowRight');
  // 这里必须用不重试的 count()：toHaveCount 会一直重试，窗口真被改短、真的堆了两条时，
  // 它只会等到第一条过期变成一条然后给通过——断言就白写了。
  await page.waitForTimeout(150);
  expect(await oneDay.count()).toBe(1);
});

// 八处 warnAtBound 里，此前只有周视图的「最晚一天」和 Ctrl 跨步那一句有用例。
// 剩下的每句都在各自视图的边界上，一次 goto 加一次按键就撞得到；而「最早/最晚」是
// 三元算出来的，方向写反了照样能骗过只匹配前半句的断言，所以断言整句。
test('周视图翻到最早一天时说「最早」', async ({ authenticatedPage: page }) => {
  await page.goto('/?week=1900-01-01');
  await expect(page.getByRole('button', { name: '上一周' })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('已到可用日期范围的最早一天').first()).toBeVisible();
});

test('月视图翻过两头时各说各的', async ({ authenticatedPage: page }) => {
  await page.goto('/monthly?year=1900&month=0');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('已到可用日期范围的最早一个月').first()).toBeVisible();

  await page.goto('/monthly?year=2999&month=11');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('已到可用日期范围的最晚一个月').first()).toBeVisible();
});

test('年视图翻过两头时各说各的', async ({ authenticatedPage: page }) => {
  await page.goto('/yearly?year=1900');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('已到可用日期范围的最早一年').first()).toBeVisible();

  await page.goto('/yearly?year=2999');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('已到可用日期范围的最晚一年').first()).toBeVisible();
});

// 最后一屏的尾巴上排着 DATE_MAX 之后的空格子——标题和列要对得上，所以故意画出来。
// 能这么做的前提是 onCellClick 里的 isUsableDate 守卫：点这些格子不能开排课弹窗，
// 开了让人填完再报「日期无效」才是白跑一趟。CLAUDE.md 和 useWeekNavigation 那条
// 三方权衡的注释都拿这个守卫当「尾巴列可以留着」的理由，而它此前一条用例都没有。
test('停在最后一周时，越界的尾巴格子点不开排课弹窗', async ({ authenticatedPage: page }) => {
  await page.goto('/?week=2999-12-31');
  await expect(page.getByText('2999-12-31 ~ 3000-01-06')).toBeVisible();

  // 先拿范围内的首列对照：同样的点法应该能开弹窗，
  // 否则下面那条断言只是「没点中格子」而不是「被守卫拦了」。
  await page.locator('[data-date="2999-12-31"] .cursor-pointer').first().click();
  const dialog = page.getByRole('dialog', { name: '排课编辑' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toHaveCount(0);

  // 越界的那一列：只应当得到一句话，不开弹窗。
  await page.locator('[data-date="3000-01-01"] .cursor-pointer').first().click();
  await expect(page.getByText(/日期无效/).first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

// 周视图的首列可以停在 DATE_MAX 上，导出对话框默认的结束日期是「首列 + 屏上天数 - 1」，
// 不夹的话算出 3000-01-06，对话框一打开就判定区间无效，两个导出按钮都是置灰的。
test('the export dialog is usable on the last week in range', async ({ authenticatedPage: page }) => {
  await page.goto('/?week=2999-12-31');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出课表' });

  await expect(dialog.getByText(/日期无效/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '导出 PNG' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '导出 CSV' })).toBeEnabled();
});

// 开始日期一变，对话框自己把结束填成「开始 + 9 天」。不夹的话它会写出一个
// 用户没打过的越界日期，然后每次点「生成日期」都报日期无效，min/max 也拦不住程序写入的值。
test('the auto-filled end date cannot land outside the supported range', async ({ authenticatedPage: page }) => {
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('button', { name: '指定日期' }).click();
  const dates = dialog.locator('input[type="date"]');
  await dates.first().fill('2999-12-28');

  expect(await dates.nth(1).inputValue()).toBe('2999-12-31');

  await dialog.getByRole('button', { name: '生成日期' }).click();
  await expect(page.getByText(/日期无效/)).toHaveCount(0);
  expect(await dialog.locator('textarea').inputValue()).toBe('2999-12-28, 2999-12-29, 2999-12-30, 2999-12-31');
});

// 学期列表还在路上时先选班级，等它到达后预选 semesterId：两次更新必须叠加。
// 这一侧盯的是预选那次写入（组件里的 setForm(f => f.semesterId ? f : ...)）。
//
// 反过来的顺序——预选先到，随后那一下 onChange 闭包的还是旧 form，把 semesterId
// 写回 ''——才是最初那个 bug。它在 E2E 里盯不住：React 处理完 change 这类
// 离散事件会同步重渲、给选择框重新绑上新闭包，窗口小到复现不了（它当初
// 就是以偶尔失败的形式被抓到的）。那一侧靠的是「所有 setForm 都写成函数式」
// 这条约定本身，不要以为这个用例拦得住它。
test('picking a class while the semester list is in flight keeps both choices', async ({ authenticatedPage: page }) => {
  let release: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/semesters*', async route => { await held; await route.continue(); });

  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  const classSelect = dialog.getByRole('combobox').first();
  await classSelect.selectOption({ label: 'E2E数学班 (高一 数学)' });
  release!();

  await expect(dialog.getByRole('combobox').nth(1)).not.toHaveValue('');
  expect(await classSelect.inputValue()).not.toBe('');
});

// 学科由 /api/profile 到达后自动填上，提交时必须带得出去。
//
// 注意这条用例**拦不住**「onChange 展开旧 newClass」那个竞态本身——和上面那条
// 学期的情形一样：React 处理 input 这类离散事件会同步重渲，profile 落地与键入之间
// 那个窗口在 E2E 里进不去（把 onChange 改回 setNewClass({ ...newClass, ... })
// 这条用例仍然是绿的，已实测）。函数式 setState 那条约定靠的是约定本身。
// 这里能盯住的是另一半：自动填充确实把学科写进了 newClass，而不只是让 select
// 看起来选中了第一项。
test('typing a class name while the profile is in flight keeps the auto-filled subject', async ({ authenticatedPage: page }) => {
  await page.goto('/');
  // App 启动时自己也拉 /api/profile，挂在页面加载前会把整个应用堵住，
  // 所以等首屏好了再拦，只挂弹窗那一次。
  let release: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/auth/profile*', async route => { await held; await route.continue(); });

  // 同 schedule-weekly.spec.ts：点周六列的一个空格子打开新建排课弹窗
  const satHeader = page.locator('main').getByText('周六', { exact: true }).nth(1);
  await expect(satHeader).toBeVisible();
  const box = (await satHeader.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 120);

  const dialog = page.getByRole('dialog', { name: '排课编辑' });
  await dialog.getByRole('combobox').first().selectOption('__new__');
  await dialog.getByPlaceholder('如：初三数学A班').fill('E2E竞态班');

  // 提交时带出去的学科才算数。不能看 select 的 inputValue：那个 select 没有空的
  // 占位 option，学科列表一到货浏览器就会自动选中第一项，于是不管 newClass.subject
  // 有没有被写上，inputValue 都非空——把自动填充整段删掉也照样绿（已实测）。
  let submitted: any = null;
  await page.route('**/api/classes', route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.abort();
    }
    return route.continue();
  });

  release!();
  await expect.poll(() => dialog.locator('div:has(> label:text-is("学科")) select').inputValue()).not.toBe('');
  await dialog.getByRole('button', { name: '创建并排课' }).click();

  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted.name).toBe('E2E竞态班');
  expect(submitted.subject).toBeTruthy();
});

// 同一个形状的第四处：学期列表还没回来时就点「新建学期」并开始敲名称，
// 迟到的加载会 setForm(模板) 把刚敲的字整个冲掉。
test('typing in a fresh semester form while the list is in flight is not wiped', async ({ authenticatedPage: page }) => {
  await page.goto('/semesters');
  let release: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/semesters*', async route => { await held; await route.continue(); });
  await page.reload();

  await page.getByRole('button', { name: '新建学期' }).click();
  const name = page.getByPlaceholder('如：2026春季');
  await name.fill('E2E竞态学期');
  release!();

  // 必须等在「只有学期列表到货后才会出现」的东西上。原先等的是
  // div.flex.items-center——Layout 的每个侧边栏链接都带这两个类，首屏就可见，
  // 这一等立刻返回，于是下面那句在迟到的 setForm 还没发生时就跑完了：
  // 把 formTouched 守卫整个删掉，用例照样绿（已实测）。
  await expect(page.getByText('E2E春季学期')).toBeVisible();
  await expect(name).toHaveValue('E2E竞态学期');
});

// 反过来的一侧：没动过的表单必须被迟到的列表纠正。列表还没回来就点「新建学期」时，
// 预填用的是 getDefaultsFromSemesters([])——按今天猜的模板；列表到了就得换成「接在你
// 最后一个学期之后」。只看 form 是不是 null 的话，这份猜出来的值会被当成用户输入
// 护住，再也纠正不了。
test('an untouched prefilled semester form is corrected once the list arrives', async ({ authenticatedPage: page }) => {
  await page.goto('/semesters');
  const start = page.locator('input[type="date"]').first();

  // 列表已经在手时打开表单，拿「按真实列表算」的默认值当基准。
  await page.getByRole('button', { name: '新建学期' }).click();
  const expected = await start.inputValue();
  await page.getByRole('button', { name: '取消' }).click();

  // 再来一次，这次让列表迟到。
  let release: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/semesters*', async route => { await held; await route.continue(); });
  await page.reload();
  await page.getByRole('button', { name: '新建学期' }).click();

  // 猜出来的和真实默认值确实不同，否则这个用例什么也证明不了。
  expect(await start.inputValue()).not.toBe(expected);
  release!();
  await expect(start).toHaveValue(expected);
});

// 定价历史的「新增定价」是拿 records[0]（当前定价）预填的。列表还没回来就点开的话，
// 预填全空，而之后到达的列表只写 records、不会回头补这一次——用户得把人数单价重敲一遍。
test('the add-pricing form cannot be opened before current pricing has loaded', async ({ authenticatedPage: page }) => {
  await page.goto('/classes');
  let release: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/classes/*/pricing', async route => { await held; await route.continue(); });

  await page.getByText('E2E数学班').first().click();
  await page.getByRole('button', { name: '定价历史' }).click();
  const addBtn = page.getByRole('button', { name: '新增定价' });
  await expect(addBtn).toBeDisabled();

  release!();
  await expect(addBtn).toBeEnabled();
  await addBtn.click();
  // 预填来自当前定价，而不是一张空表单
  await expect(page.locator('div:has(> label:text-is("学生人数")) input')).not.toHaveValue('');
  await expect(page.locator('div:has(> label:text-is("单价 (元/人/时)")) input')).not.toHaveValue('');
});
// 反过来的一侧：定价历史加载**失败**时，按钮也必须放开。此前只有"加载中→成功"
// 那一侧有用例，失败这条路没人走过——而 setLoaded 一旦只在成功分支里调用，
// 一次失败的请求就会让「新增定价」永远置灰，这个班从此再也加不了定价，
// 页面上只剩一句转瞬即逝的 toast。
//
// 注意 .finally 换成 .then 并**不是**回归：前面的 .catch 已经把 rejection 吞成了
// 一个 fulfilled promise，后面的 .then 照样会跑（实测两种写法这条用例都绿）。
// 真正要拦的是把 setLoaded 挪进成功分支——那种改法这条用例会红。
test('a failed pricing load still releases the add button', async ({ authenticatedPage: page }) => {
  await page.goto('/classes');
  await page.route('**/api/classes/*/pricing', route =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '定价服务不可用' }) }));

  await page.getByText('E2E数学班').first().click();
  await page.getByRole('button', { name: '定价历史' }).click();

  // 说明原因
  await expect(page.getByText('定价服务不可用').first()).toBeVisible();
  // 并且不能把人卡死在这里
  await expect(page.getByRole('button', { name: '新增定价' })).toBeEnabled();
});


// 学期列表到达前 selectedSemester 必然是 undefined。不区分「还没加载完」和
// 「加载完了但没选」的话，每次打开弹窗都会先闪一下红字「请先选择学期」、
// 按钮也跟着置灰——而下一瞬 pickDefaultSemesterId 就把它选上了。
test('the batch dialog does not blame the user while semesters are still loading', async ({ authenticatedPage: page }) => {
  let release: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/semesters*', async route => { await held; await route.continue(); });

  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await expect(dialog).toBeVisible();

  // 列表还挂着：不报错，但也不能放行——这个窗口里提交会把 semesterId: 0
  // 发出去，换回一句服务端的硬错。
  const submit = dialog.getByRole('button', { name: '批量排课' }).last();
  // 用不重试的 count()：toHaveCount(0) 会一直等到元素消失为止，那句红字
  // 闪一下再收回去也照样通过——而"加载期间闪一下也不能怪用户"正是这条用例要盯的。
  expect(await dialog.getByText('请先选择学期').count()).toBe(0);
  await expect(submit).toBeDisabled();

  release!();
  // 到达后自动选中：红字仍然不出现，按钮也该能点了。
  await expect(dialog.getByRole('combobox').nth(1)).not.toHaveValue('');
  expect(await dialog.getByText('请先选择学期').count()).toBe(0);
  await expect(submit).toBeEnabled();
});

// handleCreate 里的学期重拉没 await，finally 的 setSaving(false) 已经把每一行的
// 「编辑」放开了。在这个窗口里点开某一行的编辑表单，迟到的回调会把它换成
// 「下一个学期」的模板，而 editing 还指着原来那行——再点保存就把人家的学期
// 悄悄改成了模板值。
test('a late semester refetch does not overwrite an edit form opened meanwhile', async ({ authenticatedPage: page }) => {
  const name = `E2E窗口_${Date.now()}`;
  // 年份用一段别的用例没占的区间，避开学期重叠 409。
  const year = 1901 + Math.floor(Date.now() % 48);

  try {
    await page.goto('/semesters');
    await expect(page.getByText('E2E春季学期')).toBeVisible();

    // 只挂 GET：POST 得放行，否则新建本身就完成不了。且必须在首次加载之后才挂。
    let release: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/semesters*', async route => {
      if (route.request().method() === 'GET') await held;
      await route.continue();
    });

    await page.getByRole('button', { name: '新建学期' }).click();
    await page.getByPlaceholder('如：2026春季').fill(name);
    await page.locator('input[type="date"]').first().fill(`${year}-02-01`);
    await page.locator('input[type="date"]').last().fill(`${year}-06-30`);
    await page.getByRole('button', { name: '保存' }).click();

    // 重拉还挂着，但「编辑」已经可点了。
    const seeded = page.locator('div.flex.items-center').filter({ hasText: 'E2E春季学期' });
    await seeded.getByRole('button', { name: '编辑' }).click();
    const nameInput = page.getByPlaceholder('如：2026春季');
    await expect(nameInput).toHaveValue('E2E春季学期');

    release!();

    // 迟到的列表落地后，编辑表单里还得是那一行的值，而不是下一个学期的模板。
    await expect(page.getByText(name)).toBeVisible();
    await expect(nameInput).toHaveValue('E2E春季学期');
  } finally {
    await page.unroute('**/api/semesters*').catch(() => {});
    await page.goto('/semesters');
    const row = page.locator('div.flex.items-center').filter({ hasText: name });
    if (await row.count() > 0) {
      await row.getByRole('button', { name: '删除' }).click();
      await page.getByRole('button', { name: '确认' }).click();
      await expect(page.getByText(name)).not.toBeVisible();
    }
  }
});

// 生成的那条路会就地截断并说一声；手敲/粘贴的这条不拦的话，要跑一趟服务端
// 才换回一句生硬的「dates 须为数组,最多 365 项」。两条路得一致。
test('a pasted date list over the cap is refused client-side', async ({ authenticatedPage: page }) => {
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('combobox').first().selectOption({ label: 'E2E数学班 (高一 数学)' });
  await dialog.getByRole('button', { name: '指定日期' }).click();

  // 366 个合法日期：每一个都能过 isUsableDate，卡的就是个数。
  const start = new Date(Date.UTC(2030, 0, 1));
  const dates = Array.from({ length: 366 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  await dialog.locator('textarea').fill(dates.join(', '));

  await dialog.getByRole('button', { name: '批量排课' }).last().click();
  await expect(page.getByText(/一次最多排 365 个日期，当前有 366 个/)).toBeVisible();
});

// 课程块的位置在 src/utils/schedule.js 的 blockGeometry 里，绝对值有单测钉着，
// 服务端出图那条路也有 image-gen-block-geometry.test.js 钉着调用点。唯独网页这一侧
// 没人看过 ScheduleBlock 是不是真按那个函数摆的——仓库里没有 jsdom / testing-library，
// 组件只能在这里渲染。把 topGapHeight 传成 0（或者少传 firstLabelMin）整套单测全绿，
// 而每个块都会整体偏移几个像素，和时间轴的整点线对不上。
test('周视图的课程块和时间轴的整点线对齐', async ({ authenticatedPage: page }) => {
  // 固定夹具里有一节 09:00~10:30 的课。
  const block = page.locator('main .absolute.rounded-md.cursor-pointer')
    .filter({ hasText: '09:00-10:30' }).first();
  await expect(block).toBeVisible();

  // 时间轴里 09:00 那个标签所在的行，行顶就是 9 点的整点线。
  const hourRow = page.locator('main span', { hasText: /^09:00$/ }).first().locator('..');
  await expect(hourRow).toBeVisible();

  const [blockBox, rowBox] = await Promise.all([block.boundingBox(), hourRow.boundingBox()]);
  expect(blockBox).not.toBeNull();
  expect(rowBox).not.toBeNull();

  // blockGeometry 的 top 比整点线多 1px（留出边框），这里给 2px 容差。
  expect(Math.abs(blockBox!.y - rowBox!.y - 1)).toBeLessThanOrEqual(2);

  // 90 分钟的课应当有一行半高；行高就是整点行的高度。
  expect(blockBox!.height).toBeGreaterThan(rowBox!.height * 1.2);
  expect(blockBox!.height).toBeLessThan(rowBox!.height * 1.8);
});

// 滑动落定时的夹（useWeekNavigation 的 onSettle）一直没人钉：去掉 clampDate，
// 整套单测全绿。后果不是白屏——navigateToWeek 取数走的是已经夹过的 fetchRange——
// 而是滑过头之后 ?week= 被写成范围外的日期、网格显示越界的格子，且边界提示不弹。
// 移动端隐藏了所有翻页按钮，滑动就是全部导航，没有提示等于页面卡死。
test('移动端滑到边界外时停在范围内并给出提示', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?week=2999-12-30');

  const grid = page.locator('main div.flex-1.min-h-0').first();
  await expect(grid).toBeVisible();
  const box = (await grid.boundingBox())!;
  expect(box).not.toBeNull();

  // 往前滑好几格（手指向左拖 = 日期往后走）。
  for (let i = 0; i < 4; i++) {
    await grid.evaluate((el, b) => {
      const y = b.y + b.height / 2;
      const mk = (x: number) => {
        const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        return { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true };
      };
      el.dispatchEvent(new TouchEvent('touchstart', mk(b.x + b.width - 20)));
      el.dispatchEvent(new TouchEvent('touchmove', mk(b.x + b.width / 2)));
      el.dispatchEvent(new TouchEvent('touchmove', mk(b.x + 20)));
      el.dispatchEvent(new TouchEvent('touchend', mk(b.x + 20)));
    }, box);
    await page.waitForTimeout(300);
  }

  // 不管滑了多少下，?week= 都不能越过上界。
  const week = new URL(page.url()).searchParams.get('week');
  expect(week).not.toBeNull();
  expect(week! <= '2999-12-31').toBe(true);
  await expect(page.getByText('已到可用日期范围的最晚一天').first()).toBeVisible();
});
