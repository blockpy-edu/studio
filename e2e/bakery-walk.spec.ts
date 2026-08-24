/**
 * Bakery curriculum UI walker (browser layer of the conformance pair —
 * conformance/bakery has the fast Node layer). Walks real course groups in
 * the dev harness (?group=full_<url>, served by the vite middleware from
 * the untracked courses/bakery_course.json) and exercises the student
 * journey per assignment type:
 *
 *   reading: renders and marks itself read (load ⇒ correct, A7 §4);
 *   quiz:    Start → wrong answers → Submit → not correct → Try Again →
 *            derived-correct answers → Submit → correct;
 *   blockpy: Run the starting code (the mistake) → feedback appears →
 *            paste the known-good solution → Run → Complete +
 *            update_submission correct=true.
 *
 * Soft-collecting: every assignment failure becomes a ui-flow-failure entry in
 * conformance/bakery/ui-report.{md,json} and the walk continues. The test
 * fails at the end if any problem was recorded.
 *
 * Gated: PYODIDE_E2E=1 (real Pyodide in the browser) + the course export
 * on disk. Group selection: BAKERY_E2E_GROUPS=1a),6b) (name substrings,
 * default) or 'all'.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  BAKERY_DIR,
  courseAvailable,
  loadCourse,
  bundledSolution,
  type CourseAssignment,
  type CourseGroup,
} from '../conformance/bakery/load-course';
import { deriveQuestion } from '../conformance/bakery/derive-quiz-answers';
import { ProblemReport } from '../conformance/bakery/report';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QuizInstructions, StudentAnswer } from '../packages/quizzer/src/types';

const gate = process.env.PYODIDE_E2E === '1' && courseAvailable();

const groupSpec = (process.env.BAKERY_E2E_GROUPS ?? '1a),6b)').toLowerCase();
const wanted = groupSpec === 'all' ? [] : groupSpec.split(',').map((part) => part.trim());

const groups: CourseGroup[] = gate
  ? loadCourse().filter(
      (group) =>
        wanted.length === 0 || wanted.some((needle) => group.name.toLowerCase().startsWith(needle)),
    )
  : [];

const corpus = JSON.parse(readFileSync(join(BAKERY_DIR, 'solutions.json'), 'utf8')) as {
  solutions: Record<string, string>;
  /** Hand-authored answers for questions the deriver can't solve (regex). */
  quizAnswers?: Record<string, Record<string, unknown>>;
};

const report = new ProblemReport();

/** update_submission responses observed on the page, newest last. */
interface SubmissionEcho {
  assignmentId: number;
  correct: boolean | null;
}

function watchSubmissions(page: Page): SubmissionEcho[] {
  const seen: SubmissionEcho[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/api/update_submission')) return;
    if (response.url().includes('update_submission_status')) return;
    const request = response.request();
    const body = request.postData() ?? '';
    const assignmentId = Number(new URLSearchParams(body).get('assignment_id'));
    void response
      .json()
      .then((data: { correct?: boolean }) => {
        seen.push({ assignmentId, correct: data.correct ?? null });
      })
      .catch(() => {
        seen.push({ assignmentId, correct: null });
      });
  });
  return seen;
}

async function waitForEcho(
  seen: SubmissionEcho[],
  from: number,
  assignmentId: number,
  predicate: (echo: SubmissionEcho) => boolean,
  timeoutMs: number,
): Promise<SubmissionEcho | null> {
  // `seen` keeps growing (page.on listener) — poll the LIVE array from the
  // caller's cursor; a slice would freeze and miss late echoes.
  const deadline = Date.now() + timeoutMs;
  let cursor = from;
  while (Date.now() < deadline) {
    for (; cursor < seen.length; cursor += 1) {
      const echo = seen[cursor]!;
      if (echo.assignmentId === assignmentId && predicate(echo)) return echo;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

/** Answer any live interactive input() prompts while a run settles. */
async function settleRun(page: Page, timeoutMs: number): Promise<void> {
  const run = page.locator('button.blockpy-run').first();
  const live = page.locator('.blockpy-console-input-live input');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error('run did not settle in time');
    const running = (await run.getAttribute('class'))?.includes('blockpy-run-running') ?? false;
    if (!running) return;
    if (await live.isVisible().catch(() => false)) {
      await live.fill('42');
      await live.press('Enter');
    }
    await page.waitForTimeout(250);
  }
}

/** Fill one question card with the given answer, by question type. */
async function fillQuestion(
  card: Locator,
  assignment: CourseAssignment,
  questionId: string,
  answer: StudentAnswer,
): Promise<void> {
  const instructions = JSON.parse(assignment.instructions) as QuizInstructions;
  const question = instructions.questions?.[questionId];
  if (!question) throw new Error(`question ${questionId} not in instructions`);
  switch (question.type) {
    case 'true_false_question': {
      await card.locator(`input[type=radio][value="${answer as string}"]`).check();
      return;
    }
    case 'multiple_choice_question': {
      const options = (question.answers ?? []) as string[];
      const index = options.indexOf(answer as string);
      if (index === -1) throw new Error(`option ${String(answer)} not in ${questionId}`);
      // Options render in authored order, never shuffled (A3 §1.2).
      await card.locator('.form-check input[type=radio]').nth(index).check();
      return;
    }
    case 'multiple_answers_question': {
      const options = (question.answers ?? []) as string[];
      const chosen = new Set(answer as string[]);
      const boxes = card.locator('.form-check input[type=checkbox]');
      for (let index = 0; index < options.length; index += 1) {
        const box = boxes.nth(index);
        if (chosen.has(options[index]!)) await box.check();
        else await box.uncheck();
      }
      return;
    }
    case 'matching_question': {
      const values = answer as Array<string | undefined | null>;
      for (let index = 0; index < values.length; index += 1) {
        await card
          .locator('select.custom-select')
          .nth(index)
          .selectOption(values[index] ?? '');
      }
      return;
    }
    case 'multiple_dropdowns_question': {
      for (const [blank, value] of Object.entries(answer as Record<string, string>)) {
        await card.locator(`select.quizzer-inline-select[id$="-${blank}"]`).selectOption(value);
      }
      return;
    }
    case 'fill_in_multiple_blanks_question': {
      for (const [blank, value] of Object.entries(answer as Record<string, string>)) {
        await card.locator(`input.quizzer-inline-blank[id$="-${blank}"]`).fill(value);
      }
      return;
    }
    case 'short_answer_question':
    case 'numerical_question': {
      await card.locator('input.form-control[id^="question-sa-"]').fill(answer as string);
      return;
    }
    case 'essay_question': {
      await card.locator('textarea[id^="question-es-"]').fill(answer as string);
      return;
    }
    case 'text_only_question':
      return;
    default:
      throw new Error(`unsupported type ${question.type}`);
  }
}

async function walkQuiz(
  page: Page,
  group: CourseGroup,
  assignment: CourseAssignment,
  seen: SubmissionEcho[],
): Promise<void> {
  const start = page
    .locator('.quizzer-attempt-bar button', { hasText: /Start Quiz|Try Quiz Again/ })
    .first();
  await start.click();
  // The DOM is the source of truth for which questions this attempt shows
  // (pools resolve browser-side) — fill exactly the presented cards.
  await expect(page.locator('.quizzer-question-card').first()).toBeVisible({ timeout: 15_000 });
  const cards = page.locator('.quizzer-question-card');
  const checkMap =
    (
      JSON.parse(assignment.on_run ?? '{}') as {
        questions?: Record<string, Record<string, unknown>>;
      }
    ).questions ?? {};
  const instructions = JSON.parse(assignment.instructions) as QuizInstructions;
  const presented: string[] = [];
  for (let index = 0; index < (await cards.count()); index += 1) {
    const id = await cards.nth(index).getAttribute('data-question-id');
    if (id) presented.push(id);
  }
  const derived = new Map(
    presented.map((id) => [
      id,
      deriveQuestion(instructions.questions![id]!, (checkMap[id] ?? {}) as Record<string, unknown>),
    ]),
  );
  // Hand-authored corpus answers rescue underivable (regex-only) questions.
  for (const [id, answer] of Object.entries(corpus.quizAnswers?.[assignment.url] ?? {})) {
    const entry = derived.get(id);
    if (entry?.underivable !== undefined) {
      derived.set(id, { correct: answer as never, notes: entry.notes });
    }
  }
  const underivable = presented.filter((id) => derived.get(id)!.underivable !== undefined);
  if (underivable.length > 0) {
    report.add({
      category: 'quiz-underivable',
      group: group.name,
      assignment: assignment.name,
      url: assignment.url,
      detail: underivable.map((id) => `${id}: ${derived.get(id)!.underivable}`).join('\n'),
    });
    return; // cannot complete the fix pass without full answers
  }

  // Mistake pass: wrong where possible, correct elsewhere (LD-35 grades
  // absent presented answers, so every card gets SOME answer).
  let anyWrong = false;
  for (const id of presented) {
    const d = derived.get(id)!;
    const wrong = d.wrong !== undefined && !d.alwaysCorrect ? d.wrong : d.correct!;
    if (d.wrong !== undefined && !d.alwaysCorrect) anyWrong = true;
    await fillQuestion(
      page.locator(`.quizzer-question-card[data-question-id="${id}"]`),
      assignment,
      id,
      wrong,
    );
  }
  const submit = page.locator('.quizzer-attempt-bar button', { hasText: 'Submit answer' }).first();
  await expect(submit).toBeEnabled({ timeout: 15_000 }); // isDirty save debounce
  const before = seen.length;
  await submit.click();
  const wrongEcho = await waitForEcho(seen, before, assignment.id, () => true, 20_000);
  if (anyWrong && wrongEcho?.correct === true) {
    report.add({
      category: 'quiz-wrong-accepted',
      group: group.name,
      assignment: assignment.name,
      url: assignment.url,
      detail: 'wrong-answer submission graded correct',
    });
  }

  // Fix pass.
  const again = page.locator('.quizzer-attempt-bar button', { hasText: 'Try Quiz Again' }).first();
  await again.click();
  await expect(page.locator('.quizzer-question-card').first()).toBeVisible({ timeout: 15_000 });
  // A new attempt may present a different pool subset — re-scan.
  const cards2 = page.locator('.quizzer-question-card');
  const presented2: string[] = [];
  for (let index = 0; index < (await cards2.count()); index += 1) {
    const id = await cards2.nth(index).getAttribute('data-question-id');
    if (id) presented2.push(id);
  }
  for (const id of presented2) {
    const d =
      derived.get(id) ??
      deriveQuestion(instructions.questions![id]!, (checkMap[id] ?? {}) as Record<string, unknown>);
    if (d.underivable !== undefined || d.correct === undefined) {
      report.add({
        category: 'quiz-underivable',
        group: group.name,
        assignment: assignment.name,
        url: assignment.url,
        detail: `${id}: ${d.underivable ?? 'no correct answer derived'}`,
      });
      return;
    }
    await fillQuestion(
      page.locator(`.quizzer-question-card[data-question-id="${id}"]`),
      assignment,
      id,
      d.correct,
    );
  }
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  const beforeFix = seen.length;
  await submit.click();
  const fixEcho = await waitForEcho(seen, beforeFix, assignment.id, () => true, 20_000);
  if (fixEcho?.correct !== true) {
    report.add({
      category: 'quiz-correct-rejected',
      group: group.name,
      assignment: assignment.name,
      url: assignment.url,
      detail: `correct-answer submission graded ${String(fixEcho?.correct ?? 'no response')}`,
    });
  }
}

async function walkBlockpy(
  page: Page,
  group: CourseGroup,
  assignment: CourseAssignment,
  seen: SubmissionEcho[],
): Promise<void> {
  const run = page.locator('button.blockpy-run').first();
  await expect(run).toBeVisible({ timeout: 15_000 });
  // Mistake pass: the starting code as-is.
  await run.click();
  await settleRun(page, 240_000); // first click may boot Pyodide + wheels
  const feedback = page.locator('.blockpy-feedback').first();
  const mistakeText = ((await feedback.textContent()) ?? '').trim();
  if (!mistakeText) {
    report.add({
      category: 'ui-flow-failure',
      group: group.name,
      assignment: assignment.name,
      url: assignment.url,
      detail: 'no feedback rendered after running starting code',
    });
  }
  if (
    await page
      .locator('.blockpy-quick-menu .blockpy-student-error')
      .isVisible()
      .catch(() => false)
  ) {
    report.add({
      category: 'grader-system-error',
      group: group.name,
      assignment: assignment.name,
      url: assignment.url,
      detail: 'internal grading error (bug icon) on the mistake pass',
    });
  }

  const solution = corpus.solutions[assignment.url] ?? bundledSolution(assignment) ?? null;
  if (solution === null) return; // Node layer reports solution-missing

  // Fix pass: replace the editor content with the solution.
  const content = page.locator('.cm-editor .cm-content').first();
  await content.click();
  await page.keyboard.press('Control+a');
  // insertText: single input event — CM6 auto-indent must not mangle the
  // pasted solution the way per-key typing would.
  await page.keyboard.insertText(solution);
  const before = seen.length;
  await run.click();
  await settleRun(page, 120_000);
  const echo = await waitForEcho(
    seen,
    before,
    assignment.id,
    (entry) => entry.correct === true,
    30_000,
  );
  if (!echo) {
    const label = ((await feedback.textContent()) ?? '').trim().slice(0, 200);
    report.add({
      category: 'ui-flow-failure',
      group: group.name,
      assignment: assignment.name,
      url: assignment.url,
      detail: `solution did not submit correct=true; feedback: ${label}`,
    });
  }
}

async function walkReading(
  page: Page,
  group: CourseGroup,
  assignment: CourseAssignment,
  seen: SubmissionEcho[],
): Promise<void> {
  const reader = page.locator('.blockpy-reader').first();
  await expect(reader).toBeVisible({ timeout: 15_000 });
  const text = ((await reader.textContent()) ?? '').trim();
  if (!text) {
    report.add({
      category: 'reading-empty',
      group: group.name,
      assignment: assignment.name,
      url: assignment.url,
      detail: 'reader rendered no content',
    });
  }
  // load ⇒ correct (A7 §4): the markRead update_submission echo.
  const echo = await waitForEcho(seen, 0, assignment.id, (entry) => entry.correct === true, 15_000);
  if (!echo) {
    report.add({
      category: 'ui-flow-failure',
      group: group.name,
      assignment: assignment.name,
      url: assignment.url,
      detail: 'reading was not marked read (no correct=true update_submission)',
    });
  }
}

test.describe('bakery curriculum UI walk', () => {
  test.skip(!gate, 'set PYODIDE_E2E=1 (and provide courses/bakery_course.json) to run');

  test.afterAll(() => {
    report.write(join(BAKERY_DIR, 'ui-report'), {
      layer: 'playwright-ui',
      groups: groups.map((group) => group.name).join('; '),
    });
  });

  for (const group of groups) {
    test(`walk ${group.name}`, async ({ page }) => {
      test.setTimeout(Math.max(600_000, group.assignments.length * 90_000));
      const seen = watchSubmissions(page);
      await page.goto(`/?group=full_${group.url}`);
      const selector = page.locator('select.assignment-selector').first();
      await expect(selector).toBeVisible({ timeout: 30_000 });
      // The nav select is the walk order — it already excludes subordinate
      // readings (they render inline under their quiz).
      const ids = await selector
        .locator('option')
        .evaluateAll((options) =>
          options.map((option) => Number((option as HTMLOptionElement).value)),
        );
      const byId = new Map(group.assignments.map((assignment) => [assignment.id, assignment]));
      for (const id of ids) {
        const assignment = byId.get(id);
        if (!assignment) continue;
        report.covered(assignment.type);
        try {
          await selector.selectOption(String(id));
          if (assignment.type === 'reading') await walkReading(page, group, assignment, seen);
          else if (assignment.type === 'quiz') await walkQuiz(page, group, assignment, seen);
          else if (assignment.type === 'blockpy') await walkBlockpy(page, group, assignment, seen);
        } catch (error) {
          report.add({
            category: 'ui-flow-failure',
            group: group.name,
            assignment: assignment.name,
            url: assignment.url,
            detail: String(error).slice(0, 400),
          });
        }
      }
      // The report is the deliverable; the test itself fails on problems so
      // CI notices, AFTER the whole group walked.
      expect(
        report.problems.filter((problem) => problem.group === group.name),
        'see conformance/bakery/ui-report.md',
      ).toEqual([]);
    });
  }
});
