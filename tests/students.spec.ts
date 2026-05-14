import { test, expect } from './auth';

test.describe('学生管理', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('显示学生列表', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: '学生管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建' })).toBeVisible();
  });

  test('显示学生表格', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '姓名' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '出生日期' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '电话' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '父母' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '联系方式' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '所在班级' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '操作' })).toBeVisible();
  });

  test('显示学生数据', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows.nth(1)).toBeVisible();
  });

  test('按班级筛选学生', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    const select = page.getByRole('combobox');
    await expect(select).toBeVisible();
    await select.selectOption({ index: 1 });
  });

  test('点击编辑按钮', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    const editBtn = page.getByRole('button', { name: '编辑' }).first();
    await editBtn.click();
  });
});

test.describe('学生CRUD', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('新建学生并验证表格显示', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    const uniqueName = `E2E学生_${Date.now()}`;
    await page.getByRole('button', { name: '新建' }).click();
    await expect(page.getByRole('heading', { name: '新建学生' })).toBeVisible();
    // Label not linked via htmlFor — locate input by required attribute in student form
    const form = page.locator('form').filter({ hasText: '姓名' });
    await form.locator('input[required]').fill(uniqueName);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('table').getByText(uniqueName)).toBeVisible();
  });

  test('编辑学生姓名', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    await page.getByRole('button', { name: '编辑' }).first().click();
    await expect(page.getByRole('heading', { name: '编辑学生' })).toBeVisible();
    const form = page.locator('form').filter({ hasText: '姓名' });
    const nameInput = form.locator('input[required]');
    await nameInput.clear();
    await nameInput.fill(`编辑后_${Date.now()}`);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('heading', { name: '学生管理' })).toBeVisible();
  });
});
