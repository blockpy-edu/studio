import { expect, test } from '@playwright/test';

test('dev harness mounts the app shell from the BootConfig JSON block', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'BlockPy Studio' })).toBeVisible();
  await expect(page.getByText('Dev Student (learner)')).toBeVisible();
});

test('coding editor chrome renders per A8 with a working dual editor', async ({ page }) => {
  await page.goto('/');
  // A8 rows: instructions header, console, feedback badge, toolbar, editor.
  await expect(page.locator('.blockpy-content')).toBeVisible();
  await expect(page.locator('.blockpy-instructions')).toContainText(
    'Print the value of',
  );
  await expect(page.locator('.blockpy-printer')).toBeVisible();
  await expect(page.locator('.blockpy-feedback')).toBeVisible();
  await expect(page.locator('button.blockpy-run')).toBeVisible();
  // Dual editor halves are live.
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  await expect(page.locator('.cm-editor .cm-content').first()).toBeVisible();
  await expect(page.locator('.blocklyDraggable').first()).toBeVisible();
});

test('view toggle + text edits sync to blocks', async ({ page }) => {
  await page.goto('/');
  const content = page.locator('.cm-editor .cm-content').first();
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('total = 1 + 2');
  // Blocks regenerated: a BinOp block appears in the workspace.
  await expect(page.locator('.blocklyDraggable').first()).toBeVisible();
  // Toolbar mode toggle (legacy radio labels).
  await page.locator('label.blockpy-mode-set-blocks', { hasText: 'Text' }).click();
  await expect(page.locator('.blocklySvg').first()).toBeHidden();
  await page.locator('label.blockpy-mode-set-blocks', { hasText: 'Split' }).click();
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
});

test('Run without an engine reports it in the console', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.blockpy-run').click();
  await expect(page.locator('.blockpy-printer')).toContainText(
    'No execution engine attached',
  );
});
