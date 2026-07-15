/**
 * A5 - Golden-transcript recorder (DEVELOPMENT_PLAN.md §0.2, spec §16.2).
 *
 * Drives the LEGACY client through a scripted session against a local dev
 * blockpy-server while recording all HTTP traffic to a HAR, then scrubs
 * session cookies and drops static-asset entries so the transcript can be
 * checked in as the normative fixture for @blockpy/api.
 *
 * Usage: node tools/record-golden-transcript.mjs [groupUrl]
 * Default group: course_id=3, assignment_group_id=189 (readings 1021/1025,
 * quiz 1022, kettle 1023, blockpy 1024, subordinate 1026).
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const GROUP_URL =
  process.argv[2] ?? 'https://localhost:5000/assignments/load?&course_id=3&assignment_group_id=189';
const RAW_HAR = join(repoRoot, 'spikes', 'raw-transcript.har');
const OUT_DIR = join(repoRoot, 'docs', 'appendices', 'transcripts');
const OUT_HAR = join(OUT_DIR, 'group189-anonymous.har');

const STATIC_RE = /\/static\/|\.(js|css|map|png|jpg|gif|ico|svg|woff2?|ttf|wasm|aff|dic)(\?|$)/;
const HOST = new URL(GROUP_URL).host; // third-party traffic (YouTube embeds, ads) is dropped

async function step(name, fn) {
  process.stdout.write(`>> ${name} ... `);
  try {
    await fn();
    console.log('ok');
  } catch (err) {
    console.log(`SKIPPED (${String(err).split('\n')[0]})`);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  recordHar: { path: RAW_HAR, content: 'embed' },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);

// --- Scripted session: load group → reading → quiz → kettle → edit → run → reading
await step('load group (reading 1021 first)', async () => {
  await page.goto(GROUP_URL, { waitUntil: 'networkidle' });
});

await step('reading 1021: scroll to bottom (dwell pings)', async () => {
  await page.mouse.wheel(0, 20000);
  await page.waitForTimeout(4000);
});

async function navigateTo(assignmentId) {
  await page.selectOption('select.assignment-selector', { value: String(assignmentId) });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

await step('navigate to quiz 1022', () => navigateTo(1022));

await step('quiz 1022: start attempt', async () => {
  await page
    .getByRole('button', { name: /start quiz|try quiz again/i })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForTimeout(3000);
});

await step('quiz 1022: answer first question', async () => {
  await page.locator('input[type=radio]:visible, input[type=checkbox]:visible').first().click();
  await page.waitForTimeout(2000);
});

await step('quiz 1022: submit attempt', async () => {
  // "Submit answer" is disabled while isDirty (answers not yet autosaved) -
  // the click auto-waits for it to enable
  await page
    .getByRole('button', { name: /submit answer/i })
    .filter({ visible: true })
    .first()
    .click({ timeout: 30000 });
  await page.waitForTimeout(4000);
});

await step('navigate to kettle 1023 (load only)', () => navigateTo(1023));

await step('navigate to blockpy 1024', () => navigateTo(1024));

await step('blockpy 1024: type code into CodeMirror', async () => {
  // the CM element exists but is hidden when the assignment starts in blocks
  // mode, so wait for attached (not visible) and drive the CM instance
  await page.waitForSelector('.blockpy-python-blockmirror .CodeMirror', { state: 'attached' });
  await page.evaluate(() => {
    const cm = document.querySelector('.blockpy-python-blockmirror .CodeMirror').CodeMirror;
    cm.setValue('name = "golden transcript"\nprint("Hello,", name)\n');
  });
  // let the debounced autosave fire
  await page.waitForTimeout(4000);
});

await step('blockpy 1024: click Run and await grading traffic', async () => {
  const graded = page
    .waitForResponse((r) => /update_submission|log_event/.test(r.url()), { timeout: 20000 })
    .catch(() => null);
  await page.click('button.blockpy-run');
  await graded;
  await page.waitForTimeout(6000);
});

await step('navigate to reading 1025 (subordinate editor)', () => navigateTo(1025));

await step('reading 1025: dwell', async () => {
  await page.mouse.wheel(0, 20000);
  await page.waitForTimeout(4000);
});

await context.close(); // flushes the HAR
await browser.close();

// --- Scrub & filter -------------------------------------------------------
const har = JSON.parse(readFileSync(RAW_HAR, 'utf8'));
const before = har.log.entries.length;
har.log.entries = har.log.entries.filter(
  (e) => new URL(e.request.url).host === HOST && !STATIC_RE.test(e.request.url),
);

const SECRET_HEADERS = new Set(['cookie', 'set-cookie', 'authorization']);
for (const entry of har.log.entries) {
  for (const side of [entry.request, entry.response]) {
    side.headers = side.headers.map((h) =>
      SECRET_HEADERS.has(h.name.toLowerCase()) ? { ...h, value: '<REDACTED>' } : h,
    );
    if (side.cookies) side.cookies = [];
  }
  if (entry.request.postData?.text) {
    entry.request.postData.text = entry.request.postData.text.replace(
      /(access_token=)[^&]*/g,
      '$1<REDACTED>',
    );
    if (entry.request.postData.params) {
      entry.request.postData.params = entry.request.postData.params.map((p) =>
        p.name === 'access_token' ? { ...p, value: '<REDACTED>' } : p,
      );
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_HAR, JSON.stringify(har, null, 2));

// --- Summary ---------------------------------------------------------------
const counts = {};
for (const e of har.log.entries) {
  const path = new URL(e.request.url).pathname;
  const key = `${e.request.method} ${path}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
console.log(`\nKept ${har.log.entries.length}/${before} entries -> ${OUT_HAR}`);
console.log('\nEndpoint summary:');
for (const [key, n] of Object.entries(counts).sort()) {
  console.log(`  ${String(n).padStart(3)}  ${key}`);
}
