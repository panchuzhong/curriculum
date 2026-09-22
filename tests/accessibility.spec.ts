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
    // 不能写死某个班名：弹窗里每个班都是一个切换按钮，而 E2E 库里的班级会随着
    // 别的 spec（classes / schedule-monthly-yearly 各自按需建的长期夹具）累积，
    // 于是这条用例只在「从没跑过这套 E2E 的干净库」上成立，第二次跑必挂。
    // 这里要的本来就是「最后一个可聚焦的控件」——保存/取消此刻是禁用的。
    // :visible 不能省：useConfirm 的 <dialog> 也渲染在这个子树里，关闭时它的按钮
    // 仍在 DOM 中（display:none），焦点陷阱按 getClientRects 跳过它们，选择器也得跳。
    const lastEnabled = dialog.locator('button:not([disabled]):visible').last();
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
