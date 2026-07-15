/**
 * B6 visual-parity reference capture: screenshots of the LEGACY client
 * (running dev blockpy-server) stored as the layout/color ground truth for
 * docs/appendices/A8-ui-parity.md.
 *
 * Usage: node tools/capture-ui-reference.mjs [groupUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'appendices', 'ui-reference');
mkdirSync(OUT_DIR, { recursive: true });

const GROUP_URL =
  process.argv[2] ?? 'https://localhost:5000/assignments/load?&course_id=3&assignment_group_id=189';

const browser = await chromium.launch();
const page = await browser.newPage({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 1000 },
});

async function step(name, fn) {
  process.stdout.write(`>> ${name} ... `);
  try {
    await fn();
    console.log('ok');
  } catch (err) {
    console.log(`SKIPPED (${String(err).split('\n')[0]})`);
  }
}

const shot = (name) => page.screenshot({ path: join(OUT_DIR, name), fullPage: true });

async function navigateTo(assignmentId) {
  await page.selectOption('select.assignment-selector', { value: String(assignmentId) });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
}

await step('load group', async () => {
  await page.goto(GROUP_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
});

await step('reading 1021', async () => {
  await shot('legacy-reading.png');
});

// NOTE: no quiz capture - group 189's quiz is an EXAM and its questions are
// sensitive (removed 2026-07-10). Capture the quiz UI from a non-exam
// practice quiz instead when one is available.

await step('blockpy editor 1024 - default view', async () => {
  await navigateTo(1024);
  await page.waitForSelector('button.blockpy-run');
  await shot('legacy-editor-default.png');
});

await step('blockpy editor 1024 - after a run (console + feedback)', async () => {
  await page.evaluate(() => {
    const cm = document.querySelector('.blockpy-python-blockmirror .CodeMirror')?.CodeMirror;
    cm?.setValue('print("Visual parity reference")\n');
  });
  await page.click('button.blockpy-run');
  await page.waitForTimeout(5000);
  await shot('legacy-editor-after-run.png');
});

await step('blockpy editor 1024 - blocks view', async () => {
  // BlockMirror view toggle buttons carry mode classes; try common hooks
  const toggle = page
    .locator(
      '.blockmirror-menu button, .blockpy-mode-set-blocks, [data-bind*="setMode"], .blockmirror-view-mode',
    )
    .first();
  await toggle.click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  await shot('legacy-editor-blocks.png');
});

await browser.close();
console.log(`\nScreenshots in ${OUT_DIR}`);
