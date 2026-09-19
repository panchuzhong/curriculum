import { test, expect } from './auth';

test.describe('学期管理', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示学期列表', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    await expect(page.getByRole('heading', { name: '学期管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建学期' })).toBeVisible();
  });

  test('显示已有学期信息', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    // Use flexible matcher — CRUD tests may modify semester data
    await expect(page.getByText(/\d{4}-\d{2}-\d{2}.*~.*\d{4}-\d{2}-\d{2}/).first()).toBeVisible();
  });

  test('学期有编辑和删除按钮', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    await expect(page.getByRole('button', { name: '编辑' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '删除' }).first()).toBeVisible();
  });
});

test.describe('学期CRUD', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('新建学期并验证显示', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    const uniqueName = `E2E学期_${Date.now()}`;
    // 年份要跟真实数据错开，又得落在 DATE_MAX（2999）以内：超出上下限的日期
    // 表单会当成输入错误拒掉。三个 CRUD 用例各占一段，互不撞车。
    const year = 2100 + Math.floor(Date.now() % 300);
    await page.getByRole('button', { name: '新建学期' }).click();
    await page.getByPlaceholder('如：2026春季').fill(uniqueName);
    await page.locator('input[type="date"]').first().fill(`${year}-02-01`);
    await page.locator('input[type="date"]').last().fill(`${year}-06-30`);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(uniqueName)).toBeVisible();

    // Clean up: leaving the row behind accumulates a semester per run.
    const created = page.locator('div.flex.items-center').filter({ hasText: uniqueName });
    await created.getByRole('button', { name: '删除' }).click();
    await page.getByRole('button', { name: '确认' }).click();
    await expect(page.getByText(uniqueName)).not.toBeVisible();
  });

  test('编辑学期名称', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    // Edit a semester this test owns. Editing whatever happens to be first
    // renamed the shared seed row, which the seeder then recreated — leaving
    // two semesters over the same dates behind on every run.
    const originalName = `待编辑_${Date.now()}`;
    const year = 2400 + Math.floor(Date.now() % 300);
    await page.getByRole('button', { name: '新建学期' }).click();
    await page.getByPlaceholder('如：2026春季').fill(originalName);
    await page.locator('input[type="date"]').first().fill(`${year}-02-01`);
    await page.locator('input[type="date"]').last().fill(`${year}-06-30`);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(originalName)).toBeVisible();

    const renamed = `编辑后_${Date.now()}`;
    const row = page.locator('div.flex.items-center').filter({ hasText: originalName });
    await row.getByRole('button', { name: '编辑' }).click();
    const nameInput = page.getByPlaceholder('如：2026春季');
    await nameInput.clear();
    await nameInput.fill(renamed);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(renamed)).toBeVisible();
    await expect(page.getByText(originalName)).not.toBeVisible();

    const renamedRow = page.locator('div.flex.items-center').filter({ hasText: renamed });
    await renamedRow.getByRole('button', { name: '删除' }).click();
    await page.getByRole('button', { name: '确认' }).click();
    await expect(page.getByText(renamed)).not.toBeVisible();
  });

  test('删除学期', async ({ authenticatedPage: page }) => {
    // Create a semester first so we can delete it
    await page.goto('/semesters');
    const uniqueName = `待删除_${Date.now()}`;
    const year = 2700 + Math.floor(Date.now() % 290);
    await page.getByRole('button', { name: '新建学期' }).click();
    await page.getByPlaceholder('如：2026春季').fill(uniqueName);
    await page.locator('input[type="date"]').first().fill(`${year}-01-01`);
    await page.locator('input[type="date"]').last().fill(`${year}-03-31`);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(uniqueName)).toBeVisible();

    // Find the semester row that contains the name, then click its delete button
    const semesterRow = page.locator('div.flex.items-center').filter({ hasText: uniqueName });
    await semesterRow.getByRole('button', { name: '删除' }).click();
    await page.getByRole('button', { name: '确认' }).click();
    await expect(page.getByText(uniqueName)).not.toBeVisible();
  });
});

// 名称留空时的提示此前没有用例。这道守卫在 dateRangeError 之前，是为了让"没填名称"
// 说出自己的理由，而不是被日期的提示盖过去（注释里写明了这个顺序）。
test.describe('新建学期的名称校验', () => {
  test('名称留空时说明原因，并且不发请求', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    let posts = 0;
    await page.route('**/api/semesters', route => {
      if (route.request().method() === 'POST') { posts++; return route.abort(); }
      return route.continue();
    });

    await page.getByRole('button', { name: '新建学期' }).click();
    await page.getByPlaceholder('如：2026春季').fill('');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('请先填写学期名称').first()).toBeVisible();
    expect(posts).toBe(0);
    // 说的是名称的事，不是日期的事——这道守卫排在 dateRangeError 之前就是为了这个。
    // （不能笼统搜「日期」：表单里本来就有"开始日期/结束日期"两个标签。）
    for (const dateMsg of ['请填写完整的日期区间', '开始日期晚于结束日期', '日期无效']) {
      expect(await page.getByText(dateMsg).count()).toBe(0);
    }
  });

  // 对照：名称填了就不该再报这句，否则上面那条也可能只是"这句话一直在"。
  test('名称填好后不再报这句', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    await page.getByRole('button', { name: '新建学期' }).click();
    await page.getByPlaceholder('如：2026春季').fill('E2E名称校验');
    expect(await page.getByText('请先填写学期名称').count()).toBe(0);
  });
});
