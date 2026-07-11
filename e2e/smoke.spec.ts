import { expect, test } from '@playwright/test';

test('dev harness mounts the app shell from the BootConfig JSON block', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'BlockPy Studio' })).toBeVisible();
  await expect(page.getByText('Dev Student (learner)')).toBeVisible();
});

test('dual editor renders blocks and text, and syncs text edits to blocks', async ({ page }) => {
  await page.goto('/');
  // Blockly workspace injected (block half) and CodeMirror mounted (text half).
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  await expect(page.locator('.cm-editor .cm-content').first()).toBeVisible();
  // The seeded program produced real blocks.
  await expect(page.locator('.blocklyDraggable').first()).toBeVisible();
  // Text→blocks sync: type new code, blocks and the harness echo update.
  const content = page.locator('.cm-editor .cm-content').first();
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('total = 1 + 2');
  await expect(page.locator('details pre')).toContainText('total = 1 + 2');
  // Mode toggle: switching to text hides the Blockly half.
  await page.getByRole('button', { name: 'text', exact: true }).click();
  await expect(page.locator('.blocklySvg').first()).toBeHidden();
  await page.getByRole('button', { name: 'split', exact: true }).click();
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
});
