/**
 * §16.3 non-functional canaries (M6.2). Not benchmarks — regression
 * tripwires with generous budgets, run on the same Chromium the suite
 * already uses.
 *
 * The §16.3 memory line has three legs:
 *  1. one ENGINE per page — by construction (the App's single
 *     RunController is handed to every editor; the PYODIDE_E2E smoke test
 *     exercises the shared engine for the minified swap);
 *  2. editors release resources on unmount — MinifiedEditor unit test
 *     (Blockly workspace registry returns to baseline; incl. the upstream
 *     trashcan-flyout leak we dispose manually);
 *  3. absolute heap stays sane pre-engine — this canary.
 */
import { expect, test, type Page } from '@playwright/test';

async function usedHeapMb(page: Page): Promise<number> {
  // Chromium-only API; the suite runs Chromium.
  const bytes = await page.evaluate(
    () =>
      (
        performance as unknown as {
          memory?: { usedJSHeapSize: number };
        }
      ).memory?.usedJSHeapSize ?? 0,
  );
  return bytes / (1024 * 1024);
}

test('editor page + hydrated reading stay under the pre-engine heap budget', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  const editorHeap = await usedHeapMb(page);
  test.skip(editorHeap === 0, 'performance.memory unavailable');

  // Reading with its runnable blocks hydrated (each is a minified editor).
  await page
    .locator('.assignment-selector-div')
    .first()
    .locator('select.assignment-selector')
    .selectOption('103');
  await page.locator('.blockpy-host-reading').waitFor();
  // Hydrate every runnable block; re-query per click — each hydration
  // removes its launch button, so a snapshotted list goes stale under
  // parallel-suite timing.
  const launchButtons = page.locator('.blockpy-host-reading .reader-run-button');
  let hydrated = 0;
  while ((await launchButtons.count()) > 0) {
    await launchButtons.first().click();
    hydrated += 1;
    await expect(page.locator('.blockpy-minified')).toHaveCount(hydrated);
  }
  expect(hydrated).toBeGreaterThan(0);

  const readingHeap = await usedHeapMb(page);
  console.log(
    `[perf] heap: editor ${editorHeap.toFixed(1)} MB, reading+minified ${readingHeap.toFixed(1)} MB`,
  );
  // Agreed §16.3 pre-engine budget: the whole UI (editor + navigation +
  // hydrated reading) must stay far below the Pyodide-era hundreds of MB.
  expect(readingHeap).toBeLessThan(150);
});
