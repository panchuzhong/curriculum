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
    const table = page.getByRole('table');
    await expect(table.getByText('E2E学生')).toBeVisible();
    const select = page.getByRole('combobox');
    // 选项文案带人数后缀（如「E2E数学班 (1人)」），先取实际文案再选。
    // E2E学生只属于数学班：筛选到英语班应从表中消失，切回数学班应恢复。
    const englishOption = select.locator('option', { hasText: 'E2E英语班' });
    await select.selectOption({ label: await englishOption.textContent() });
    await expect(table.getByText('E2E学生')).toHaveCount(0);
    const mathOption = select.locator('option', { hasText: 'E2E数学班' });
    await select.selectOption({ label: await mathOption.textContent() });
    await expect(table.getByText('E2E学生')).toBeVisible();
  });

  test('点击编辑按钮', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    await page.getByRole('button', { name: '编辑' }).first().click();
    await expect(page.getByRole('dialog', { name: '编辑学生' })).toBeVisible();
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

  test('编辑学生姓名并验证表格显示', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    // 用一次性学生：改共享种子行（E2E学生）会污染后续测试且无法恢复
    const seedName = `E2E编辑源_${Date.now()}`;
    await page.getByRole('button', { name: '新建' }).click();
    let form = page.locator('form').filter({ hasText: '姓名' });
    await form.locator('input[required]').fill(seedName);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('table').getByText(seedName)).toBeVisible();

    await page.getByRole('row').filter({ hasText: seedName }).getByRole('button', { name: '编辑' }).click();
    form = page.locator('form').filter({ hasText: '姓名' });
    const newName = `E2E编辑后_${Date.now()}`;
    await form.locator('input[required]').clear();
    await form.locator('input[required]').fill(newName);
    await page.getByRole('button', { name: '保存' }).click();
    // 只断言弹窗关闭测不出保存失败；断言新名字入表、旧名字消失
    await expect(page.getByRole('table').getByText(newName)).toBeVisible();
    await expect(page.getByRole('table').getByText(seedName)).toHaveCount(0);
  });

  test('取消删除确认后保留编辑弹窗', async ({ authenticatedPage: page }) => {
    await page.goto('/students');
    await page.getByRole('button', { name: '编辑' }).first().click();
    const editDialog = page.getByRole('dialog', { name: '编辑学生' });
    await editDialog.getByRole('button', { name: '删除' }).click();
    const confirmDialog = page.locator('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '取消' }).click();
    await expect(editDialog).toBeVisible();
  });
});
