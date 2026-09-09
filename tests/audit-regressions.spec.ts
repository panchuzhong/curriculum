import { test, expect } from './auth';

test('an obsolete delete preview cannot authorize deletion after the class changes', async ({ authenticatedPage: page }) => {
  let releasePreview: () => void;
  const heldPreview = new Promise<void>(resolve => { releasePreview = resolve; });
  await page.route('**/api/schedules/batch', async route => {
    expect(route.request().postDataJSON().dryRun).toBe(true);
    await heldPreview;
    await route.fulfill({ json: { count: 7, ids: [1, 2, 3, 4, 5, 6, 7] } });
  });
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('button', { name: '批量删课' }).click();
  await dialog.getByRole('button', { name: '日期范围' }).click();
  const classSelect = dialog.getByRole('combobox').first();
  await classSelect.selectOption({ label: 'E2E数学班 (高一 数学)' });
  await dialog.locator('input[type="date"]').first().fill('2026-09-01');
  await dialog.locator('input[type="date"]').nth(1).fill('2026-09-30');
  const sent = page.waitForRequest('**/api/schedules/batch');
  await dialog.getByRole('button', { name: '预览删除' }).click();
  await sent;
  await classSelect.selectOption({ label: 'E2E英语班 (高二 英语)' });
  const response = page.waitForResponse('**/api/schedules/batch');
  releasePreview!();
  await (await response).finished();
  // Let the response's promise callbacks and React's render complete.
  await page.waitForTimeout(100);
  await expect(dialog.getByRole('button', { name: '确认', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '预览删除' })).toBeVisible();
});

test('batch scheduling preserves zero billing and displays missing holiday data', async ({ authenticatedPage: page }) => {
  let submitted;
  await page.route('**/api/schedules/batch', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { count: 1, ids: [1], holidayDataMissing: ['2090'] } });
  });
  await page.getByRole('button', { name: '批量操作' }).click();
  const dialog = page.getByRole('dialog', { name: '批量排课' });
  await dialog.getByRole('combobox').first().selectOption({ label: 'E2E数学班 (高一 数学)' });
  await dialog.getByRole('spinbutton').fill('0');
  await dialog.getByRole('button', { name: '批量排课', exact: true }).last().click();
  await expect(dialog.getByText('成功排课 1 次')).toBeVisible();
  expect(submitted.durationBilling).toBe(0);
  await expect(dialog.getByText(/2090.*未跳过节假日/)).toBeVisible();
});

for (const view of ['monthly', 'yearly']) {
  test(`${view} export displays the historical year that it will export`, async ({ authenticatedPage: page }) => {
    await page.goto(`/${view}?year=2019&month=0`);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出课表' });
    await expect(dialog.getByRole('combobox').first()).toHaveValue('2019');
    const endYearIndex = view === 'monthly' ? 2 : 1;
    await expect(dialog.getByRole('combobox').nth(endYearIndex)).toHaveValue('2019');
  });
}

test('invalid weekly URL dates fall back to a usable current week', async ({ authenticatedPage: page }) => {
  await page.goto('/?week=invalid&date=2026-02-30');
  await expect(page.getByRole('button', { name: '下一周', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}/);
});

test('a pending weekly animation cannot navigate back after switching views', async ({ authenticatedPage: page }) => {
  await page.keyboard.press('ArrowRight');
  // Trigger the view switch before the 220 ms slide finishes.
  await page.getByRole('link', { name: '月课表' }).evaluate((link: HTMLAnchorElement) => link.click());
  await expect(page).toHaveURL(/\/monthly/);
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/monthly/);
});
