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
