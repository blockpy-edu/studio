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
  // Footer (Row 5): the boot load marks Assignment ready (legacy
  // _postBlocking lifecycle); untouched endpoints stay offline.
  const footer = page.locator('.blockpy-status');
  await expect(footer.locator('.badge.server-status-ready')).toHaveCount(1);
  await expect(footer.locator('.badge.server-status-offline')).toHaveCount(7);
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

test('view-swap button toggles full and minified editors, code round-trips', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  // Swap to the minified variant: compact chrome only — no file tabs,
  // instructions, feedback, or footer; CM6 text editor + Run/Reset.
  await page.getByRole('button', { name: 'Switch to minified editor' }).click();
  await expect(page.locator('.blockpy-minified')).toBeVisible();
  // Full chrome gone (the minified root reuses .blockpy-content for the
  // parchment frame + scoped colors, so check for full-editor regions).
  await expect(page.locator('.blockpy-content.container-fluid')).toHaveCount(0);
  await expect(page.locator('.blockpy-header')).toHaveCount(0);
  await expect(page.locator('.blockpy-files')).toHaveCount(0);
  // Same parchment frame colors as the regular editor.
  const frame = page.locator('.blockpy-minified');
  expect(
    await frame.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgb(252, 248, 227)');
  expect(
    await frame.evaluate((el) => getComputedStyle(el).borderTopColor),
  ).toBe('rgb(250, 235, 204)');
  await expect(page.locator('.blockpy-minified button.blockpy-run')).toBeVisible();
  await expect(page.locator('.blockpy-minified .cm-content')).toContainText(
    'print(a)',
  );
  // Blocks side is collapsed in the minified text-only mode.
  await expect(page.locator('.blocklySvg').first()).toBeHidden();
  // Layout: editor column on the RIGHT of the console/feedback column;
  // console above feedback; toolbar above the editor.
  const consoleBox = (await page
    .locator('.blockpy-minified-printer')
    .boundingBox())!;
  const feedbackBox = (await page
    .locator('.blockpy-minified-feedback')
    .boundingBox())!;
  const toolbarBox = (await page
    .locator('.blockpy-minified-toolbar')
    .boundingBox())!;
  const editorBox = (await page
    .locator('.blockpy-minified-right .cm-editor')
    .boundingBox())!;
  expect(editorBox.x).toBeGreaterThanOrEqual(consoleBox.x + consoleBox.width - 1);
  expect(feedbackBox.y).toBeGreaterThanOrEqual(consoleBox.y + consoleBox.height - 1);
  expect(editorBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 1);
  await expect(page.locator('.blockpy-minified-feedback')).toContainText(
    'Ready',
  );
  // Edit in minified, swap back — the full editor picks the change up from
  // the VFS.
  const miniContent = page.locator('.blockpy-minified .cm-content');
  await miniContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('a = 7\nprint(a)');
  await page.getByRole('button', { name: 'Switch to full editor' }).click();
  await expect(page.locator('.blockpy-content.container-fluid')).toBeVisible();
  await expect(
    page.locator('.blockpy-python-blockmirror .cm-content').first(),
  ).toContainText('a = 7');
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
});

test('Add New menu creates and opens files (instructor view)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  // Students (hide_files defaults true) get no Add New dropdown.
  await expect(page.locator('.blockpy-files .dropdown')).toHaveCount(0);
  await page.locator('#blockpy-as-instructor').check();
  await page.getByRole('button', { name: 'Add New' }).click();
  // Create an instructor file through the dialog with the & namespace.
  await page.getByRole('link', { name: 'Instructor File' }).click();
  await page
    .locator('.blockpy-instructor-file-dialog-filename')
    .fill('data.csv');
  await expect(
    page.locator('.blockpy-instructor-file-dialog-filetype'),
  ).toHaveText('csv');
  await page
    .locator('.blockpy-instructor-file-dialog-namespace')
    .selectOption('&');
  await page.getByRole('button', { name: 'Create' }).click();
  // The new file opened as the active tab (read-only & space, text mode).
  await expect(page.locator('.nav-link.active')).toHaveText('&data.csv');
  await expect(page.locator('.blockpy-mode-set-blocks')).toHaveCount(0);
  // On Change now exists, so it left the menu and joined the tab strip.
  await page.getByRole('button', { name: 'Add New' }).click();
  await page.getByRole('link', { name: 'On Change' }).click();
  await expect(page.locator('.nav-link.active')).toHaveText('On Change');
  await page.getByRole('button', { name: 'Add New' }).click();
  await expect(page.getByRole('link', { name: 'On Change' })).toHaveCount(0);
});

test('images.blockpy tab opens the uploaded-files manager (§14.2 uploads)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  await page.locator('#blockpy-as-instructor').check();
  await page.getByRole('button', { name: 'Add New' }).click();
  await page.getByRole('link', { name: 'Images' }).click();
  // The manager replaces the code editor for this tab, listing the
  // stub server's uploaded file with modify actions (instructor).
  await expect(page.locator('.blockpy-images-manager')).toBeVisible();
  await expect(page.locator('.blockpy-images-manager')).toContainText('capitals.txt');
  const manager = page.locator('.blockpy-images-manager');
  await expect(manager.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Upload' })).toBeVisible();
  // Leaving the tab restores the code editor.
  await page.locator('.nav-link', { hasText: 'answer.py' }).click();
  await expect(page.locator('.blockpy-images-manager')).toHaveCount(0);
  await expect(page.locator('.cm-editor .cm-content').first()).toBeVisible();
});

test('AssignmentHost dispatches types via altAssignmentChangingFunction (§5.3/§15.3)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  // The harness typeIndex marks 102 as a quiz: dispatching hides (does not
  // unmount) the editor and mounts the quiz slot; the URL follows.
  await page.evaluate(() =>
    (window as never as { altAssignmentChangingFunction(id: number): Promise<void> })
      .altAssignmentChangingFunction(102),
  );
  await expect(page.locator('.blockpy-host-quiz')).toBeVisible();
  await expect(page.locator('.blockpy-host-editor')).toBeHidden();
  await expect(page.locator('.blockpy-content')).toBeAttached(); // still mounted
  expect(new URL(page.url()).searchParams.get('assignment_id')).toBe('102');
  // Back to the blockpy assignment: the editor returns, the quiz unmounts.
  await page.evaluate(() =>
    (window as never as { altAssignmentChangingFunction(id: number): Promise<void> })
      .altAssignmentChangingFunction(101),
  );
  await expect(page.locator('.blockpy-host-editor')).toBeVisible();
  await expect(page.locator('.blockpy-host-quiz')).toHaveCount(0);
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
});

test('group navigation: dual headers, boundaries, markCorrect, clock (§9/§16.1.4)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  // Dual-rendered header/footer from one store (editor.html includes the
  // macro twice); subordinate quiz 102 is filtered from the selector.
  const headers = page.locator('.assignment-selector-div');
  await expect(headers).toHaveCount(2);
  const top = headers.first();
  const bottom = headers.last();
  await expect(top.locator('option')).toHaveText(['Hello World', 'Reading: Variables']);
  await expect(top.locator('.completion-box')).toHaveText('(0/2 completed)');
  // Boundaries: at the first assignment, First/Back disabled, Next/Last live.
  await expect(top.locator('.assignment-selector-first')).toBeDisabled();
  await expect(top.locator('.assignment-selector-back')).toBeDisabled();
  await expect(top.locator('.assignment-selector-next')).toBeEnabled();
  // markCorrect global (§15.3) updates BOTH instances: ✔ prefix, count,
  // green Next (btn-success replaces btn-outline-secondary).
  await page.evaluate(() =>
    (window as never as { markCorrect(id: number): void }).markCorrect(103),
  );
  for (const header of [top, bottom]) {
    await expect(header.locator('option[value="103"]')).toHaveText('✔ Reading: Variables');
    await expect(header.locator('.completion-rate')).toHaveText('1');
    await expect(header.locator('.assignment-selector-next')).toHaveClass(/btn-success/);
  }
  // Completion-box click expands the selector to a list box in both
  // instances; the state persists across a reload (exact localStorage key).
  await top.locator('.completion-box').click();
  await expect(top.locator('select.assignment-selector')).toHaveJSProperty('size', 2);
  await expect(bottom.locator('select.assignment-selector')).toHaveJSProperty('size', 2);
  expect(
    await page.evaluate(() => localStorage.getItem('blockpy_assignmentSelectorExpanded')),
  ).toBe('true');
  // Time-spent clock: session tier text, then click → activity mode fetches
  // the stubbed 25-minute total through estimate_group_duration (§9.4).
  await expect(top.locator('.assignment-selector-clock')).toHaveText('(Just started)');
  await top.locator('.assignment-selector-clock').click();
  await expect(top.locator('.assignment-selector-clock')).toHaveText('~25 minutes spent');
  await top.locator('.assignment-selector-clock').click();
  await expect(top.locator('.assignment-selector-clock')).toHaveText('(Just started)');
  // Selecting the reading dispatches through the AssignmentHost: reading
  // slot mounts, the editor hides (not unmounts), the URL follows, and
  // Next/Last disable at the end of the group.
  await top.locator('select.assignment-selector').selectOption('103');
  await expect(page.locator('.blockpy-host-reading')).toBeVisible();
  await expect(page.locator('.blockpy-host-editor')).toBeHidden();
  expect(new URL(page.url()).searchParams.get('assignment_id')).toBe('103');
  await expect(bottom.locator('select.assignment-selector')).toHaveValue('103');
  await expect(top.locator('.assignment-selector-next')).toBeDisabled();
  await expect(top.locator('.assignment-selector-last')).toBeDisabled();
  await expect(top.locator('.assignment-selector-back')).toBeEnabled();
  // Back returns to the coding assignment.
  await top.locator('.assignment-selector-back').click();
  await expect(page.locator('.blockpy-host-editor')).toBeVisible();
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  // The expansion survived the trip and a full reload.
  await page.reload();
  await page.locator('.blocklySvg').first().waitFor();
  await expect(
    page.locator('.assignment-selector-div').first().locator('select.assignment-selector'),
  ).toHaveJSProperty('size', 2);
});

test('reading assignment: content, load⇒correct, runnable block (§11.2)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  // The reading auto-marks correct on load (A7 §4): watch for the
  // updateSubmission POST the reader sends with the READING's ids.
  const markReadPost = page.waitForRequest(
    (request) =>
      request.url().includes('update_submission') &&
      request.method() === 'POST' &&
      (request.postData() ?? '').includes('assignment_id=103'),
  );
  await page
    .locator('.assignment-selector-div')
    .first()
    .locator('select.assignment-selector')
    .selectOption('103');
  // Reader body: settings header/summary + markdown content.
  const reading = page.locator('.blockpy-host-reading');
  await expect(reading).toBeVisible();
  await expect(reading.getByRole('heading', { name: 'Chapter 1' })).toBeVisible();
  await expect(reading.getByText('Variables hold values.')).toBeVisible();
  await expect(reading.getByRole('heading', { name: 'Variables' })).toBeVisible();
  const markReadBody = (await markReadPost).postData() ?? '';
  expect(markReadBody).toContain('correct=true');
  expect(markReadBody).toContain('status=1');
  // …and the navigation reflects the server echo: ✔, count, green Next.
  const header = page.locator('.assignment-selector-div').first();
  await expect(header.locator('option[value="103"]')).toHaveText('✔ Reading: Variables');
  await expect(header.locator('.completion-rate')).toHaveText('1');
  await expect(header.locator('.assignment-selector-next')).toHaveClass(/btn-success/);
  // Relative image/link targets rewrote through download_file (A6 §2.4).
  const img = reading.locator('.blockpy-reader-content img');
  expect(await img.getAttribute('src')).toBe(
    '/api/download_file?placement=assignment&directory=103&filename=variables.png',
  );
  // Runnable python fence (part id): Run button hydrates the minified
  // editor in place and hides the highlighted pre; the plain fence stays.
  await expect(reading.locator('.reader-launch-blockpy')).toBeVisible();
  await reading.getByRole('button', { name: 'Run' }).click();
  await expect(reading.locator('.blockpy-minified')).toBeVisible();
  await expect(reading.locator('.blockpy-minified .cm-content')).toContainText('age = 5');
  await expect(reading.locator('.reader-launch-blockpy')).toBeHidden();
  await expect(reading.locator('pre:not(.reader-launch-blockpy) code.language-python')).toBeVisible();
  // Back to the coding assignment: the editor returns intact.
  await page
    .locator('.assignment-selector-div')
    .first()
    .locator('.assignment-selector-back')
    .click();
  await expect(page.locator('.blockpy-host-editor')).toBeVisible();
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
});

test('quiz assignment: attempt lifecycle, autosave, server grading (§11.3)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  // Quiz 102 is subordinate (not in the nav selector) — dispatch through
  // the host global, like the legacy loadAssignmentWrapper path.
  await page.evaluate(() =>
    (window as never as { altAssignmentChangingFunction(id: number): Promise<void> })
      .altAssignmentChangingFunction(102),
  );
  const quiz = page.locator('.blockpy-host-quiz');
  await expect(quiz).toBeVisible();
  // READY: dual attempt bars, attempts-left text, content hidden pre-attempt.
  await expect(quiz.getByRole('button', { name: 'Start Quiz' })).toHaveCount(2);
  await expect(quiz.getByText('3 attempts left.').first()).toBeVisible();
  await expect(quiz.getByText('Variables can change.')).toHaveCount(0);
  await quiz.getByRole('button', { name: 'Start Quiz' }).first().click();
  // ATTEMPTING: questions render — 2 fixed + 1 of the 2-question pool.
  await expect(quiz.getByText('Quiz In Progress!').first()).toBeVisible();
  await expect(quiz.locator('.quizzer-question-card')).toHaveCount(3);
  await expect(quiz.getByText('Variables can change.')).toBeVisible();
  // Answer + autosave: the save_file POST carries the QUIZ's ids and the
  // whole submission JSON document.
  // Match the ANSWER save by content — the Start-triggered attempt save
  // races with this listener ('+' is a space in urlencoded bodies).
  const decodeForm = (body: string) => decodeURIComponent(body.replace(/\+/g, ' '));
  const savePost = page.waitForRequest(
    (request) =>
      request.url().includes('save_file') &&
      (request.postData() ?? '').includes('assignment_id=102') &&
      decodeForm(request.postData() ?? '').includes('"tf1": "true"'),
  );
  await quiz.getByLabel('True').check();
  const saveBody = (await savePost).postData() ?? '';
  expect(saveBody).toContain('filename=answer.py');
  // Submit: updateSubmission {status: 0, correct: false}; the stub grades
  // fully correct and returns the feedbacks map.
  const submitPost = page.waitForRequest(
    (request) =>
      request.url().includes('update_submission') &&
      (request.postData() ?? '').includes('assignment_id=102'),
  );
  const submitButton = quiz.getByRole('button', { name: 'Submit answer' }).first();
  await expect(submitButton).toBeEnabled();
  await submitButton.click();
  const submitBody = (await submitPost).postData() ?? '';
  expect(submitBody).toContain('status=0');
  expect(submitBody).toContain('correct=false');
  // COMPLETED: per-question feedback boxes + green/incorrect status squares.
  await expect(quiz.getByText(/You have completed the quiz/).first()).toBeVisible();
  await expect(quiz.getByText('Right!')).toBeVisible();
  await expect(quiz.locator('.quizzer-feedback.bg-success').first()).toBeVisible();
  // markCorrect(102): subordinate id — the numerator bumps with no ✔
  // anywhere (the legacy unknown-option quirk, A7 §2).
  const header = page.locator('.assignment-selector-div').first();
  await expect(header.locator('.completion-rate')).toHaveText('1');
  await expect(header.locator('option[value="101"]')).toHaveText('Hello World');
  await expect(header.locator('.assignment-selector-next')).toHaveClass(/btn-success/);
  // Back to the editor.
  await page.evaluate(() =>
    (window as never as { altAssignmentChangingFunction(id: number): Promise<void> })
      .altAssignmentChangingFunction(101),
  );
  await expect(page.locator('.blockpy-host-editor')).toBeVisible();
});

test('History mode: toolbar + merge diff + Use adopts the old version', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  const historyButton = page.getByRole('button', { name: 'History' });
  await historyButton.click();
  // History toolbar (legacy HISTORY_TOOLBAR_HTML) + the CM6 merge diff
  // replace the dual editor; the most recent edit is selected.
  await expect(page.locator('.blockpy-history-toolbar')).toBeVisible();
  await expect(page.locator('.cm-mergeView')).toBeVisible();
  await expect(page.locator('.blockpy-python-blockmirror')).toHaveCount(0);
  await expect(historyButton).toHaveClass(/active/);
  // Step back to the middle version (a = 0 / b = a + 1 / print(a)) — the
  // diff's left side shows the historical code.
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.locator('.cm-mergeView')).toContainText('b = a + 1');
  // Use adopts it: history mode exits, the dual editor returns with it.
  await page.getByRole('button', { name: 'Use' }).click();
  await expect(page.locator('.blockpy-history-toolbar')).toHaveCount(0);
  await expect(
    page.locator('.blockpy-python-blockmirror .cm-content').first(),
  ).toContainText('b = a + 1');
  // Blocks regenerated from the adopted version too.
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
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
  // The grading POST (§14.3) fires after feedback presents; it must carry
  // the block-workspace PNG (legacy getPngFromBlocks, server.js:675-680).
  const updatePost = page.waitForRequest(
    (request) =>
      request.url().includes('update_submission') && request.method() === 'POST',
    { timeout: 240_000 },
  );
  await page.locator('button.blockpy-run').click();
  // Student output streams first…
  await expect(page.locator('.blockpy-printer')).toContainText('0', {
    timeout: 150_000,
  });
  // …then the Pedal on_run grader resolves: green Complete badge (§10.1).
  await expect(page.locator('.blockpy-feedback')).toContainText('Complete', {
    timeout: 240_000,
  });
  const updateBody = (await updatePost).postData() ?? '';
  expect(updateBody).toContain('correct=true');
  expect(updateBody).toContain(`image=${encodeURIComponent('data:image/png;base64,')}`);
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
  // Editing !on_run.py changes grading on the very next run (the grader is
  // read from the VFS per run, not captured at boot).
  await page.locator('#blockpy-as-instructor').check();
  await page.locator('.nav-link', { hasText: 'On Run' }).click();
  const onRunContent = page.locator('.cm-editor .cm-content').first();
  await onRunContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(
    'from pedal import *\ngently("Edited grader speaking!", label="edited")',
  );
  await page.locator('.nav-link', { hasText: 'answer.py' }).click();
  await page.locator('button.blockpy-run').click();
  await expect(page.locator('.blockpy-feedback')).toContainText(
    'Edited grader speaking!',
    { timeout: 60_000 },
  );
  await page.locator('#blockpy-as-instructor').uncheck();
  // Student programs can open() staged VFS files (student search-order view,
  // prefix-stripped: '&sample_data.txt' → 'sample_data.txt').
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type("print(open('sample_data.txt').read())");
  await page.locator('button.blockpy-run').click();
  await expect(page.locator('.blockpy-printer')).toContainText(
    'temperature,42',
    { timeout: 60_000 },
  );
  // Remote uploaded files stage too (preload_all_files → listUploadedFiles →
  // downloadFile → VFS remote contents, consulted last in the search order).
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type("print(open('capitals.txt').read())");
  await page.locator('button.blockpy-run').click();
  await expect(page.locator('.blockpy-printer')).toContainText(
    'France,Paris',
    { timeout: 60_000 },
  );
  await expect(page.locator('button.blockpy-run')).not.toHaveClass(
    /blockpy-run-running/,
  );
  // Queued inputs (quick-menu dialog) replay into input() — the compat-mode
  // stdin strategy (M1.3.4 → inputsPrefill).
  await page.locator('[title="Edit Inputs"]').click();
  await page.locator('textarea.blockpy-input-list').fill('Ada');
  await page.locator('.blockpy-dialog .modal-okay').click();
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('name = input("Who? ")\nprint("Hi", name)');
  await expect(content).toContainText('Who?'); // typed text landed in CM
  await expect(page.locator('button.blockpy-run')).not.toHaveClass(
    /blockpy-run-running/,
  );
  await expect(page.locator('button.blockpy-run')).toContainText('Run');
  await page.locator('button.blockpy-run').click();
  await expect(page.locator('.blockpy-printer')).toContainText('Who?', {
    timeout: 60_000,
  });
  await expect(page.locator('.blockpy-printer')).toContainText('Hi Ada', {
    timeout: 60_000,
  });
  // matplotlib plots render inline in the console (§10.2): the engine
  // auto-loads the package from imports, captures Agg figures as PNGs.
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(
    'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.show()',
  );
  await page.locator('button.blockpy-run').click();
  const plot = page.locator('.blockpy-printer .blockpy-console-image-output img');
  await expect(plot).toBeVisible({ timeout: 120_000 });
  expect(await plot.getAttribute('src')).toContain('data:image/png;base64,');
  // Minified variant shares the already-booted page engine: swap views,
  // run, and the inline output console streams the result.
  await page.getByRole('button', { name: 'Switch to minified editor' }).click();
  const miniContent = page.locator('.blockpy-minified .cm-content');
  await miniContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('print("mini", 6 * 7)');
  await page.locator('.blockpy-minified button.blockpy-run').click();
  await expect(page.locator('.blockpy-minified-printer')).toContainText(
    'mini 42',
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
