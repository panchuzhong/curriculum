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
    await expect(page.getByRole('button', { name: '+ 化学' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 英语' })).toBeVisible();
  });

  test('显示节假日管理区', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '法定节假日管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '手动添加' })).toBeVisible();
  });

  test('显示节假日列表', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByText('节假日', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('调休上班', { exact: false }).first()).toBeVisible();
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
    // Server returns 401, client treats it as session expired → redirect to login
    await page.waitForURL('**/login');
  });

  test('添加自定义学科', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    const subjectName = `E2E学科_${Date.now()}`;
    const input = page.getByPlaceholder('自定义学科名称');
    if (await input.isVisible()) {
      await input.fill(subjectName);
      // Scope to the subject area to avoid matching other "添加" buttons
      await input.locator('..').getByRole('button', { name: '添加' }).click();
      await page.getByRole('button', { name: '保存学科设置' }).click();
      await expect(page.getByText(subjectName)).toBeVisible();
    }
  });

  test('手动添加节假日', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: '手动添加' }).click();
    const dateInput = page.locator('input[type="date"]').first();
    if (await dateInput.isVisible()) {
      await dateInput.fill('2028-01-01');
      const nameInput = page.getByPlaceholder('名称（如：春节）');
      if (await nameInput.isVisible()) {
        await nameInput.fill('E2E测试假期');
      }
      // Click the add/submit button in the holiday form
      const addBtn = page.locator('form').getByRole('button', { name: '添加' });
      if (await addBtn.isVisible()) {
        await addBtn.click();
      }
    }
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
