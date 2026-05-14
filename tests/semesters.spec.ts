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
    await page.getByRole('button', { name: '新建学期' }).click();
    await page.getByPlaceholder('如：2026春季').fill(uniqueName);
    await page.locator('input[type="date"]').first().fill('2027-02-01');
    await page.locator('input[type="date"]').last().fill('2027-06-30');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(uniqueName)).toBeVisible();
  });

  test('编辑学期名称', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    await page.getByRole('button', { name: '编辑' }).first().click();
    const nameInput = page.getByPlaceholder('如：2026春季');
    await nameInput.clear();
    await nameInput.fill(`编辑后_${Date.now()}`);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('heading', { name: '学期管理' })).toBeVisible();
  });

  test('删除学期', async ({ authenticatedPage: page }) => {
    // Create a semester first so we can delete it
    await page.goto('/semesters');
    const uniqueName = `待删除_${Date.now()}`;
    await page.getByRole('button', { name: '新建学期' }).click();
    await page.getByPlaceholder('如：2026春季').fill(uniqueName);
    await page.locator('input[type="date"]').first().fill('2028-01-01');
    await page.locator('input[type="date"]').last().fill('2028-03-31');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(uniqueName)).toBeVisible();

    // Find the semester row that contains the name, then click its delete button
    const semesterRow = page.locator('div.flex.items-center').filter({ hasText: uniqueName });
    page.on('dialog', dialog => dialog.accept());
    await semesterRow.getByRole('button', { name: '删除' }).click();
    await expect(page.getByText(uniqueName)).not.toBeVisible();
  });
});
