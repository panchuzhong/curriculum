import { test, expect } from './auth';

test.describe('设置页面', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示设置页面标题', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  });

  test('显示学科管理区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '学科管理' })).toBeVisible();
    await expect(page.getByText('数学')).toBeVisible();
    await expect(page.getByText('物理')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存学科设置' })).toBeVisible();
  });

  test('显示快速添加学科按钮', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: '+ 信息技术' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 美术' })).toBeVisible();
  });

  test('显示节假日管理区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '法定节假日管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '手动添加' })).toBeVisible();
  });

  test('显示节假日列表', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    // 只搜「节假日」「调休上班」会命中区块顶部那句说明文案
    //（「管理节假日和调休上班日。批量排课时会自动排除节假日…」），
    // 列表本身一条都没被断言——把整个列表删掉用例照样绿。这里看真实的行。
    const rows = page.locator('div.max-h-60 > div');
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText(String(new Date().getFullYear()));
  });

  test('显示修改密码区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();
    await expect(page.getByText('当前密码')).toBeVisible();
    await expect(page.getByText('新密码', { exact: true })).toBeVisible();
    await expect(page.getByText('确认新密码')).toBeVisible();
    await expect(page.getByRole('button', { name: '修改密码' })).toBeVisible();
  });

  test('显示API Key区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'API Key' })).toBeVisible();
    await expect(page.getByRole('button', { name: '复制' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新生成 API Key' })).toBeVisible();
  });

  test('显示定价阶梯区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '定价阶梯' })).toBeVisible();
  });
});

test.describe('设置操作', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('修改密码成功后新密码可用', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByPlaceholder('请输入用户名').fill('pcz');
    await page.getByPlaceholder('请输入密码').fill('test1234');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL('/');

    // Change password — locate inputs via the password form section
    await page.goto('/settings');
    const pwForm = page.locator('form').filter({ hasText: '当前密码' });
    await pwForm.locator('input[type="password"]').nth(0).fill('test1234');
    await pwForm.locator('input[type="password"]').nth(1).fill('test5678');
    await pwForm.locator('input[type="password"]').nth(2).fill('test5678');
    await page.getByRole('button', { name: '修改密码' }).click();
    await expect(page.getByText(/成功|已修改/)).toBeVisible();

    // Logout
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.waitForURL('**/login');

    // Login with new password
    await page.getByPlaceholder('请输入用户名').fill('pcz');
    await page.getByPlaceholder('请输入密码').fill('test5678');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL('/');

    // Change back to original password
    await page.goto('/settings');
    const pwForm2 = page.locator('form').filter({ hasText: '当前密码' });
    await pwForm2.locator('input[type="password"]').nth(0).fill('test5678');
    await pwForm2.locator('input[type="password"]').nth(1).fill('test1234');
    await pwForm2.locator('input[type="password"]').nth(2).fill('test1234');
    await page.getByRole('button', { name: '修改密码' }).click();
    await expect(page.getByText(/成功|已修改/)).toBeVisible();
  });

  test('修改密码旧密码错误时失败', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    const pwForm = page.locator('form').filter({ hasText: '当前密码' });
    await pwForm.locator('input[type="password"]').nth(0).fill('wrongpassword');
    await pwForm.locator('input[type="password"]').nth(1).fill('test5678');
    await pwForm.locator('input[type="password"]').nth(2).fill('test5678');
    await page.getByRole('button', { name: '修改密码' }).click();
    await expect(page.getByText('当前密码错误')).toBeVisible();
    await expect(page).toHaveURL(/\/settings/);
  });

  // 两条客户端校验：都在发请求之前拦下，所以服务端永远看不到这两种输入，
  // 也就没有第二道防线。它们是预先存在的（不属于本次改动），但一直没有用例。
  //
  // 这条必须拦住请求，而不只是断言看到了提示——旧密码填的是**正确**的那个，
  // 所以守卫一旦回归，这个请求会真的成功，把共享测试账号的密码改成 abcd5678，
  // 之后每一条用例都登不上去。断言"请求没发出去"既是在测守卫，也是在保护夹具；
  // route 拦截同时兜住了万一：即便守卫坏了，请求也出不去。
  test('两次新密码不一致时当场拦下，不发请求', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    let calls = 0;
    await page.route('**/api/auth/password', route => { calls++; return route.abort(); });

    const pwForm = page.locator('form').filter({ hasText: '当前密码' });
    await pwForm.locator('input[type="password"]').nth(0).fill('test1234');
    await pwForm.locator('input[type="password"]').nth(1).fill('abcd5678');
    await pwForm.locator('input[type="password"]').nth(2).fill('abcd9999');
    await page.getByRole('button', { name: '修改密码' }).click();

    await expect(page.getByText('两次输入的新密码不一致')).toBeVisible();
    expect(calls).toBe(0);
  });

  // 这一条要断言「没发请求」，不能只断言看到了那句话：
  // 服务端的 withMessage 写的是一模一样的「新密码至少8位」，把客户端这道校验
  // 整个删掉，页面上照样会出现这句话——只看文案的断言根本分不出是谁拦的。
  test('新密码不足 8 位时当场拦下，不发请求', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    let calls = 0;
    await page.route('**/api/auth/password', async route => { calls++; await route.abort(); });
    const pwForm = page.locator('form').filter({ hasText: '当前密码' });
    await pwForm.locator('input[type="password"]').nth(0).fill('test1234');
    await pwForm.locator('input[type="password"]').nth(1).fill('abc123');
    await pwForm.locator('input[type="password"]').nth(2).fill('abc123');
    await page.getByRole('button', { name: '修改密码' }).click();
    await expect(page.getByText('新密码至少8位')).toBeVisible();
    expect(calls).toBe(0);
  });

  test('添加自定义学科', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    const subjectName = `E2E学科_${Date.now()}`;
    const input = page.getByPlaceholder('自定义学科名称');
    await expect(input).toBeVisible();
    await input.fill(subjectName);
    // Scope to the subject area to avoid matching other "添加" buttons
    await input.locator('..').getByRole('button', { name: '添加' }).click();
    await page.getByRole('button', { name: '保存学科设置' }).click();
    // 必须刷新后再看：add() 只改本地 state，页面从头到尾不重新拉取，
    // 不刷新的话把 api.updateSubjects 整个删掉这条断言照样成立。
    await page.reload();
    await expect(page.getByText(subjectName)).toBeVisible();
    // 清理：删掉本次新增，避免共享教师账号的学科列表随每次运行膨胀
    const row = page.locator('div.space-y-1 > div').filter({ hasText: subjectName });
    await row.getByRole('button', { name: '删除' }).click();
    await page.getByRole('button', { name: '保存学科设置' }).click();
    await page.reload();
    await expect(page.getByText(subjectName)).toHaveCount(0);
  });

  // 「添加」按钮没有置灰态，所以空名称必须自己报出来，否则点下去毫无反应，
  // 看起来就像按钮坏了。这条守卫此前没有用例。
  test('学科名称留空时说明原因，且不往列表里加空项', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    const input = page.getByPlaceholder('自定义学科名称');
    await expect(input).toBeVisible();

    const rows = page.locator('div.space-y-1 > div');
    const before = await rows.count();

    await input.fill('   ');   // 只打空格，trim 之后就是空
    await input.locator('..').getByRole('button', { name: '添加' }).click();

    await expect(page.getByText('请先填写学科名称').first()).toBeVisible();
    // 列表没有多出一项（尤其不能多出一个空白项）
    expect(await rows.count()).toBe(before);
  });

  test('重复学科名会说明原因而不是静默丢弃', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    const input = page.getByPlaceholder('自定义学科名称');
    const name = `E2E重复_${Date.now()}`;
    await input.fill(name);
    // 和上面那个用例一样按父元素收窄：设置页上叫「添加」的按钮不止一个
    await input.locator('..').getByRole('button', { name: '添加' }).click();
    await expect(page.getByText(name).first()).toBeVisible();
    // 再加一次同名：修复前什么都不发生，输入框里的字还在，像是点击没生效。
    await input.fill(name);
    await input.locator('..').getByRole('button', { name: '添加' }).click();
    await expect(page.getByText(`「${name}」已在列表中`).first()).toBeVisible();
    // 全程不点「保存学科设置」，改动只留在本地 state，不污染共享测试账号
  });

  // 保存失败是唯一一条只能靠 toast 告知的路径（没有置灰、也没有内联红字）：
  // 它静默的话，用户会以为学科已经存下了，下次打开才发现没有。
  test('学科保存失败时会报出来，而不是假装成功', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await page.route('**/api/auth/subjects', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '存储不可用' }) }));

    await page.getByRole('button', { name: '保存学科设置' }).click();
    await expect(page.getByText(/保存失败/).first()).toBeVisible();
    // 服务端的理由要带上，光说「失败」等于没说
    await expect(page.getByText(/存储不可用/).first()).toBeVisible();
  });

  // 节假日列表的年份翻页：其他视图都把翻页夹在同一对上下限里，这里也不例外。
  // 从今年往回翻到 1900 只需一百二十多下，而且翻页不发请求（reload 只在挂载时跑）。
  test('节假日年份翻到 1900 后就置灰', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    // 学科区也有按钮：从年份那个 span 往上一级圈定作用域。
    //（不能拿 hasText 筛容器：容器文本连着两个按钮是「◀2026年▶」，锥不上 ^\\d{4}年$。）
    const pager = page.getByText(/^\d{4}年$/).locator('..');
    const prev = pager.getByRole('button', { name: '◀' });
    const steps = new Date().getFullYear() - 1900;
    for (let i = 0; i < steps; i++) await prev.click();

    await expect(pager.getByText('1900年')).toBeVisible();
    await expect(prev).toBeDisabled();
    await expect(pager.getByRole('button', { name: '▶' })).toBeEnabled();
  });

  // addHoliday 里两条空值守卫：都是这次改动新加的（之前是默默 return），
  // 一条用例都没有。顺序有意义：先判日期再判名称。
  test('节假日没填完时各报各的理由', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    const name = page.getByPlaceholder('名称（如：春节）');

    await page.getByRole('button', { name: '手动添加' }).click();
    await name.fill('E2E缺日期');
    await name.locator('..').getByRole('button', { name: '添加' }).click();
    await expect(page.getByText('请先选择日期').first()).toBeVisible();

    // 补上日期、清掉名称，报的就该是另一句
    await page.locator('input[type="date"]').first().fill(`${new Date().getFullYear()}-06-16`);
    await name.fill('');
    await name.locator('..').getByRole('button', { name: '添加' }).click();
    await expect(page.getByText('请先填写名称').first()).toBeVisible();
  });

  // 日期框上的 min/max 只把越界值标成 :invalid，value 照样提交。上面的列表按年份筛，
  // 年份被原生控件左移成 0261 的记录哪一年都不属于，存进去就删不掉了。
  // 这条守卫此前没有用例（settings.spec.ts 只试过合法日期）。
  test('越界的节假日日期被拒，并说出范围', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    // 「没存进去」必须靠「请求压根没发出去」来证。原先写的是列表里查不到这一行，
    // 那句断言永远成立：HolidayManager 只渲染所选年份（默认今年）的记录，
    // 3000-01-01 那行不管建没建都不会出现在列表里。
    let posts = 0;
    await page.route('**/api/holidays', route => {
      if (route.request().method() === 'POST') { posts++; return route.abort(); }
      return route.continue();
    });
    await page.getByRole('button', { name: '手动添加' }).click();
    await page.locator('input[type="date"]').first().fill('3000-01-01');
    await page.getByPlaceholder('名称（如：春节）').fill('E2E越界');
    await page.getByPlaceholder('名称（如：春节）').locator('..').getByRole('button', { name: '添加' }).click();

    // 用例名承诺「说出范围」，就得连范围一起断言：只匹配「日期无效」的话，
    // 把提示换成光秃秃的四个字也照样通过，而用户从「日期无效」里看不出该改成什么。
    await expect(page.getByText('日期无效，须在 1900-01-01 ~ 2999-12-31 之间').first()).toBeVisible();
    expect(posts).toBe(0);
  });

  test('手动添加节假日', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    // 管理器只显示所选年份（默认今年）的记录，测试日期必须落在今年才能出现在列表里
    const testDate = `${new Date().getFullYear()}-06-15`;
    // 上次运行若在添加后中断会残留同日期行，先清掉避免 409
    const stale = page.locator('div.max-h-60 > div').filter({ hasText: testDate });
    if (await stale.count() > 0) {
      await stale.first().getByRole('button', { name: '删除' }).click();
      await expect(page.getByText(testDate)).toHaveCount(0);
    }

    await page.getByRole('button', { name: '手动添加' }).click();
    await page.locator('input[type="date"]').first().fill(testDate);
    await page.getByPlaceholder('名称（如：春节）').fill('E2E测试假期');
    // 添加区是 div 而非 form；从名称输入框的父级圈定作用域，避开学科区的同名按钮
    await page.getByPlaceholder('名称（如：春节）').locator('..').getByRole('button', { name: '添加' }).click();
    // 添加成功后表单收起、列表出现该日期
    await expect(page.getByText(testDate)).toBeVisible();
    await expect(page.getByText('E2E测试假期')).toBeVisible();
    // 清理，不再向持久库积累数据
    await page.locator('div.max-h-60 > div').filter({ hasText: testDate })
      .getByRole('button', { name: '删除' }).click();
    await expect(page.getByText(testDate)).toHaveCount(0);
  });
});

test.describe('导航和布局', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('导航栏显示系统名称', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('heading', { name: '课表管理' })).toBeVisible();
  });

  test('导航栏显示退出登录按钮', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  });

  test('点击退出登录跳转到登录页', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  });

  test('导航链接正确跳转', async ({ authenticatedPage: page }) => {
    await page.getByRole('link', { name: '月课表' }).click();
    await expect(page).toHaveURL(/\/monthly/);

    await page.getByRole('link', { name: '班级管理' }).click();
    await expect(page).toHaveURL(/\/classes/);

    await page.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/settings/);
  });

});
