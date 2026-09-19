import { test, expect } from './auth';

test('a saving dialog cycles focus past disabled footer buttons', async ({ authenticatedPage: page }) => {
  await page.goto('/students');
  let releaseSave!: () => void;
  const heldSave = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route('**/api/students', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await heldSave;
    await route.fulfill({ status: 400, json: { error: 'Test save cancelled' } });
  });
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建学生' });
  const first = dialog.getByRole('textbox').first();
  await first.fill('E2E焦点测试');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  try {
    await expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled();
    const lastEnabled = dialog.getByRole('button', { name: 'E2E英语班', exact: true });
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(lastEnabled).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
  } finally {
    releaseSave();
  }
});

test('mobile navigation is absent when closed and contains keyboard focus when open', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: '班级管理' })).toHaveCount(0);
  const opener = page.getByRole('button', { name: '打开导航' });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: '主导航' });
  await expect(drawer.getByRole('link', { name: '班级管理' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: '关闭导航' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button', { name: '退出登录' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: '关闭导航' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: '班级管理' })).toHaveCount(0);
  await expect(opener).toBeFocused();
});
