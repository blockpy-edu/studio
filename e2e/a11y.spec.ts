/**
 * WCAG 2.1 A/AA automated audit (Phase 6, §16.3) — axe-core over the four
 * student-facing surfaces the acceptance criteria name: navigation + coding
 * editor, quiz, reading, textbook.
 *
 * Scope notes:
 *  - Tags limit to wcag2a/wcag2aa/wcag21a/wcag21aa — axe's automatable
 *    subset; the manual checklist (focus order, screen-reader passes) stays
 *    in the Phase 6 audit doc.
 *  - The Blockly workspace SVG is excluded: block a11y is the keyboard-nav
 *    plugin's territory (its own §16.3 line) and axe has no meaningful
 *    rules for the canvas-like SVG surface.
 *  - color-contrast on the LEGACY-normative chrome colors is asserted, not
 *    waived — B6 visual parity covers layout/metrics/hues, and the B6
 *    mandate never required shipping inaccessible contrast; failures here
 *    get ledger-reviewed fixes instead of exclusions.
 */
import { appendFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page, name: string, exclude: string[] = []) {
  let builder = new AxeBuilder({ page }).withTags(TAGS).exclude('.blocklySvg');
  for (const selector of exclude) {
    builder = builder.exclude(selector);
  }
  const results = await builder.analyze();
  // Readable failure output: rule id, impact, and the offending targets.
  const formatted = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
  }));
  // A11Y_REPORT=<file>: dump full details for fixing instead of asserting.
  if (process.env['A11Y_REPORT']) {
    appendFileSync(
      process.env['A11Y_REPORT'],
      JSON.stringify({ name, violations: results.violations }, null, 1) + '\n',
    );
    return;
  }
  expect(formatted).toEqual([]);
}

test('coding editor + group navigation meet WCAG A/AA (axe)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  await audit(page, test.info().title);
});

test('quiz surface meets WCAG A/AA (axe)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  await page.evaluate(() =>
    (
      window as never as {
        altAssignmentChangingFunction(id: number): Promise<void>;
      }
    ).altAssignmentChangingFunction(104),
  );
  await page.locator('.blockpy-host-quiz').waitFor();
  await page.getByRole('button', { name: 'Start Quiz' }).first().click();
  await page.locator('.quizzer-question-card').first().waitFor();
  await audit(page, test.info().title);
});

test('reading surface meets WCAG A/AA (axe)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  await page
    .locator('.assignment-selector-div')
    .first()
    .locator('select.assignment-selector')
    .selectOption('103');
  await page.locator('.blockpy-host-reading').waitFor();
  await audit(page, test.info().title);
});

test('textbook surface meets WCAG A/AA (axe)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.blocklySvg').first().waitFor();
  await page
    .locator('.assignment-selector-div')
    .first()
    .locator('select.assignment-selector')
    .selectOption('105');
  await page.locator('.blockpy-host-textbook').waitFor();
  await page.locator('.blockpy-reader').waitFor();
  await audit(page, test.info().title);
});
