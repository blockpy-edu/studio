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

test('quick menu, footer, and highlighted instructions render per A8', async ({ page }) => {
  await page.goto('/');
  // Quick menu (Row 1 right): fullscreen/inputs/images buttons + clock.
  const menu = page.locator('.blockpy-quick-menu');
  await expect(menu.locator('[title="Full Screen"]')).toBeVisible();
  await expect(menu.locator('[title="Edit Inputs"]')).toBeVisible();
  await expect(menu.locator('[title="Toggle Images"]')).toBeVisible();
  await expect(menu.locator('.blockpy-menu-clock')).toHaveText(
    /^\d{1,2}:\d{2}(am|pm)$/,
  );
  // Pink bug icon stays dead (display:none) — legacy parity.
  await expect(menu.locator('.blockpy-student-error')).toBeHidden();
  // Footer (Row 5): status badges default offline; identity line present.
  const footer = page.locator('.blockpy-status');
  await expect(footer.locator('.badge.server-status-offline')).toHaveCount(8);
  await expect(footer).toContainText('Editor Version: 0.1.0');
  // EDIT_INPUTS dialog round trip (queued inputs for compat-mode stdin).
  await menu.locator('[title="Edit Inputs"]').click();
  const dialog = page.locator('.blockpy-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('textarea.blockpy-input-list').fill('Ada\n42');
  await dialog.locator('.modal-okay').click();
  await expect(dialog).toHaveCount(0);
  // Instructions code fence highlighted by hljs (LD-10) after the debounce.
  await expect(
    page.locator('.blockpy-instructions pre code.hljs'),
  ).toBeVisible();
});

test('Run boots the engine lazily; system messages go to status + dev console', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.blockpy-run').click();
  // Engine boot is lazy (R7). The load announcement is a SYSTEM message:
  // footer status area, not the student console.
  await expect(page.locator('.blockpy-status')).toContainText(
    'Loading Python engine',
  );
  await expect(page.locator('.blockpy-printer')).not.toContainText(
    'Loading Python engine',
  );
  await expect(page.locator('button.blockpy-run')).toHaveClass(
    /blockpy-run-running/,
  );
  // The Execution badge reflects the active run.
  await expect(
    page.locator('.blockpy-status .badge').last(),
  ).toHaveClass(/server-status-active/);
  // Dev console is instructor-only and shares the console slot: students
  // see no toggle; instructors get a toggle badged with the unseen count.
  await expect(page.locator('.blockpy-console-toggle')).toHaveCount(0);
  await page.locator('#blockpy-as-instructor').check();
  const toggle = page.locator('.blockpy-console-toggle');
  await expect(toggle).toContainText('Dev Console');
  await expect(toggle.locator('.blockpy-console-toggle-badge')).toHaveText('1');
  await toggle.click();
  await expect(page.locator('.blockpy-dev-console')).toBeVisible();
  await expect(page.locator('.blockpy-dev-console')).toContainText(
    'Loading Python engine',
  );
  // The badge is consumed by viewing; the toggle now points back.
  await expect(page.locator('.blockpy-console-toggle')).toContainText(
    'Console',
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
  // Trace explorer: the run collected an E3 trace; stepping shows variables,
  // and the LAST page shows the final end-of-run state (module-return
  // snapshot: a = 0).
  await page.getByRole('button', { name: /View Trace/ }).click();
  await expect(page.locator('.blockpy-trace')).toContainText('Step:');
  await page.getByRole('button', { name: 'Last step' }).click();
  const lastRow = page.locator('.blockpy-trace table tbody tr', {
    hasText: 'a',
  });
  await expect(lastRow).toContainText('int');
  await expect(lastRow.locator('code')).toHaveText('0');
  await page.getByRole('button', { name: /Hide Trace/ }).click();
  // REPL: the successful run pinned an Evaluate button in the console
  // (legacy beginEval); clicking it opens the inline input line (§6.4).
  await page.locator('button.blockpy-btn-eval').click();
  const evalInput = page.getByRole('textbox', { name: 'Evaluate expression' });
  await evalInput.fill('a + 41');
  await page.getByRole('button', { name: 'Enter' }).click();
  // Frozen echo line + the value, all inside the printer.
  await expect(
    page.locator('.blockpy-printer input[disabled]').first(),
  ).toHaveValue('a + 41');
  await expect(page.locator('.blockpy-printer code')).toContainText('41', {
    timeout: 30_000,
  });
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
  // Queued inputs (quick-menu dialog) replay into input() — the compat-mode
  // stdin strategy (M1.3.4 → inputsPrefill).
  await page.locator('[title="Edit Inputs"]').click();
  await page.locator('textarea.blockpy-input-list').fill('Ada');
  await page.locator('.blockpy-dialog .modal-okay').click();
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('name = input("Who? ")\nprint("Hi", name)');
  await page.locator('button.blockpy-run').click();
  await expect(page.locator('.blockpy-printer')).toContainText('Hi Ada', {
    timeout: 60_000,
  });
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
  // 6. Feedback badge is content-sized, not stretched by the flex column
  //    (offsetWidth catches the stretch even while the badge is empty).
  const badgeWidth = await page
    .locator('.feedback-badge')
    .evaluate((el) => (el as HTMLElement).offsetWidth);
  const feedbackPane = (await page
    .locator('.blockpy-feedback')
    .boundingBox())!;
  expect(badgeWidth).toBeLessThan(feedbackPane.width / 2);
  // 7. The dev console swaps into the console slot (same half-width column
  //    as the student console) with the dark terminal styling.
  await page.locator('#blockpy-as-instructor').check();
  await page.locator('.blockpy-console-toggle').click();
  const devPrinter = page.locator('.blockpy-dev-printer');
  await expect(devPrinter).toBeVisible();
  const devBox = (await devPrinter.boundingBox())!;
  // Re-measure: the instructor toggle grows the file-tab strip, shifting
  // rows below Row 2.
  const feedbackNow = (await page
    .locator('.blockpy-feedback')
    .boundingBox())!;
  expect(devBox.y).toBeGreaterThanOrEqual(feedbackNow.y - 1);
  expect(devBox.y).toBeLessThan(feedbackNow.y + feedbackNow.height);
  expect(devBox.width).toBeLessThan(feedbackNow.width * 1.1);
  expect(
    await devPrinter.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe('rgb(255, 255, 255)');
});
