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
    await expect(page.getByText('2026春季')).toBeVisible();
    await expect(page.getByText(/2026-\d{2}-\d{2}.*~.*2026-\d{2}-\d{2}/)).toBeVisible();
  });

  test('学期有编辑和删除按钮', async ({ authenticatedPage: page }) => {
    await page.goto('/semesters');
    await expect(page.getByRole('button', { name: '编辑' })).toBeVisible();
    await expect(page.getByRole('button', { name: '删除' })).toBeVisible();
  });
});
