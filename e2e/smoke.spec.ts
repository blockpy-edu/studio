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
  // File tab strip: answer.py active; the & file shows as uneditable and
  // opens read-only in text mode (D3-A/LD-3).
  await expect(page.locator('.nav-link.active')).toHaveText('answer.py');
  const readonlyTab = page.locator('.nav-link.uneditable');
  await expect(readonlyTab).toHaveText('&sample_data.txt');
  await readonlyTab.click();
  await expect(page.locator('.cm-editor .cm-content').first()).toContainText(
    'temperature',
  );
  await expect(page.locator('.blocklySvg').first()).toBeHidden();
  await expect(page.locator('.blockpy-mode-set-blocks')).toHaveCount(0);
  await page.locator('.nav-link', { hasText: 'answer.py' }).click();
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
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

test('Run boots the engine lazily and reports it in the console', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.blockpy-run').click();
  // Engine boot is lazy (R7): the console announces the load immediately and
  // the Run button flips to its running state.
  await expect(page.locator('.blockpy-printer')).toContainText(
    'Loading Python engine',
  );
  await expect(page.locator('button.blockpy-run')).toHaveClass(
    /blockpy-run-running/,
  );
});

// Full Pyodide execution downloads Pyodide + Pedal wheels from CDNs — opt in
// locally with PYODIDE_E2E=1 (not part of the default suite).
test('real Pyodide run executes, grades with Pedal, and shows Complete', async ({ page }) => {
  test.skip(!process.env.PYODIDE_E2E, 'set PYODIDE_E2E=1 to run');
  test.setTimeout(300_000);
  await page.goto('/');
  await page.locator('button.blockpy-run').click();
  // Student output streams first…
  await expect(page.locator('.blockpy-printer')).toContainText('0', {
    timeout: 150_000,
  });
  // …then the Pedal on_run grader resolves: green Complete badge (§10.1).
  await expect(page.locator('.blockpy-feedback')).toContainText('Complete', {
    timeout: 240_000,
  });
  await expect(page.locator('button.blockpy-run')).not.toHaveClass(
    /blockpy-run-running/,
  );
  // Incorrect submission path: change the code, rerun, get the gentle hint.
  const content = page.locator('.cm-editor .cm-content').first();
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('a = 1\nprint(a)');
  await page.locator('button.blockpy-run').click();
  await expect(page.locator('.blockpy-feedback')).toContainText(
    'Try printing the value of a.',
    { timeout: 60_000 },
  );
});

test('layout regressions: no horizontal overflow, panels side by side, white editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  // 1. No horizontal scroll on the page.
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // 2. Console and feedback are side by side (same top, disjoint x-ranges).
  const consoleBox = (await page.locator('.blockpy-console').boundingBox())!;
  const feedbackBox = (await page.locator('.blockpy-feedback').boundingBox())!;
  expect(Math.abs(consoleBox.y - feedbackBox.y)).toBeLessThan(2);
  expect(feedbackBox.x).toBeGreaterThanOrEqual(
    consoleBox.x + consoleBox.width - 1,
  );
  // 3. The text editor surface is white, not the parchment page tint.
  const editorBg = await page
    .locator('.cm-editor')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(editorBg).toBe('rgb(255, 255, 255)');
  // 4. Blockly media resolves (no 404 → garbled sprites).
  const spriteStatus = await page.evaluate(async () => {
    const response = await fetch('/blockly-media/sprites.png');
    return response.status;
  });
  expect(spriteStatus).toBe(200);
  // 5. Toolbar buttons carry icons (lucide SVGs).
  const runIcons = await page
    .locator('button.blockpy-run svg')
    .count();
  expect(runIcons).toBeGreaterThan(0);
});
