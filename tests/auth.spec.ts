import { test, expect } from '@playwright/test';
import { ensureTestUser, TEST_USER } from './auth';

test.describe('登录页', () => {
  test.beforeEach(async ({ page }) => {
    ensureTestUser();
    await page.goto('/login');
  });

  test('显示登录表单', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '请输入用户名' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '请输入密码' })).toBeVisible();
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  });

  test('显示系统介绍', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '课表管理系统' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '智能排课' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '统计报表' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI Agent' })).toBeVisible();
  });

  test('显示注册链接', async ({ page }) => {
    await expect(page.getByRole('link', { name: '立即注册' })).toBeVisible();
  });

  test('用户名为空时不发登录请求，也不跳转', async ({ page }) => {
    // 只断言"还停在 /login"是恒成立的：原生 required 会挡住提交，handleSubmit
    // 根本不会跑，页面当然不动。真正该证的是这一下什么请求都没发出去。
    let posts = 0;
    await page.route('**/api/auth/login', route => { posts++; return route.abort(); });

    await page.getByRole('button', { name: '登录' }).click();
    expect(posts).toBe(0);
    await expect(page).toHaveURL(/\/login/);
  });

  test('错误密码时提示错误', async ({ page }) => {
    await page.getByRole('textbox', { name: '请输入用户名' }).fill(TEST_USER.username);
    await page.getByRole('textbox', { name: '请输入密码' }).fill('wrongpassword');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });

  test('正确凭据登录后跳转到首页', async ({ page }) => {
    await page.getByRole('textbox', { name: '请输入用户名' }).fill(TEST_USER.username);
    await page.getByRole('textbox', { name: '请输入密码' }).fill(TEST_USER.password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL('/');
    await expect(page.getByRole('link', { name: '周课表' })).toBeVisible();
  });
});

test.describe('注册页', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('显示注册表单', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
  });

  test('注册表单包含必要字段', async ({ page }) => {
    await expect(page.getByPlaceholder('请输入姓名')).toBeVisible();
    await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
    await expect(page.getByPlaceholder('至少8位')).toBeVisible();
    await expect(page.getByRole('button', { name: '注册' })).toBeVisible();
  });

  // 「两次密码不一致」只有客户端拦得住：confirmPassword 根本不发给服务端，
  // 所以这个守卫一旦没了，用户就用打错的那一遍密码注册成功了，还以为是后一遍——
  // 下次登录才发现进不去，而且没有任何提示说过哪里不对。
  // 另一条守卫「密码至少8位」服务端也有同样的字样，所以这里连「请求没发出去」一起断言，
  // 否则删掉客户端守卫、由服务端回同一句话，用例照样绿（Settings 那条就踩过这个坑）。
  test('两次密码不一致时当场拦下，不发注册请求', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/auth/register', route => { calls++; return route.abort(); });

    await page.getByPlaceholder('请输入姓名').fill('E2E注册');
    await page.getByPlaceholder('请输入用户名').fill(`e2e_${Date.now()}`);
    await page.getByPlaceholder('至少8位').fill('correct-horse');
    await page.getByPlaceholder('再次输入密码').fill('correct-hoRse');
    await page.getByRole('button', { name: '注册' }).click();

    await expect(page.getByText('两次输入的密码不一致')).toBeVisible();
    expect(calls).toBe(0);
    // 没跳走：还停在注册页
    await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
  });

  test('密码不足 8 位时当场拦下，不发注册请求', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/auth/register', route => { calls++; return route.abort(); });

    await page.getByPlaceholder('请输入姓名').fill('E2E注册');
    await page.getByPlaceholder('请输入用户名').fill(`e2e_${Date.now()}`);
    await page.getByPlaceholder('至少8位').fill('short');
    await page.getByPlaceholder('再次输入密码').fill('short');
    await page.getByRole('button', { name: '注册' }).click();

    await expect(page.getByText('密码至少8位')).toBeVisible();
    expect(calls).toBe(0);
  });
});

test.describe('未登录访问受保护页面', () => {
  test('重定向到登录页', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  });
});
