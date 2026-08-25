/**
 * Bakery curriculum conformance walk (Node layer): every assignment in
 * courses/bakery_course.json is exercised through the PRODUCTION grading
 * paths — blockpy via the real JobRunner/PedalEnvironment under Pyodide,
 * quizzes via @blockpy/quizzer processQuiz with answers DERIVED from the
 * checks, readings via static validation. The point is the mistake →
 * feedback → fix → success contract:
 *
 *   blockpy: starting code grades to presentable non-success feedback
 *            (the "mistake"), a syntax-broken variant grades without
 *            crashing, and the known-good solution grades success.
 *   quiz:    the derived-wrong submission is not correct, the
 *            derived-correct submission scores 100%.
 *   reading: settings parse and there is something to read.
 *
 * Everything that doesn't hold becomes a categorized entry in
 * conformance/bakery/bakery-report.{md,json} — the investigation queue.
 *
 * Gated (network + minutes of Pyodide grading):
 *   BAKERY_CONFORMANCE=1 npx vitest run conformance/bakery
 * Optional filters: BAKERY_GROUPS=6B,10A (name substrings),
 *                   BAKERY_TYPES=blockpy,quiz,reading
 * The whole suite skips silently when the course export is absent.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobRunner } from '../../packages/engine/src/runner';
import type { PedalFeedback } from '../../packages/engine/src/pedal';
import { processQuiz, type QuizChecksDocument } from '../../packages/quizzer/src/grading';
import { selectVisibleQuestions } from '../../packages/quizzer/src/documents';
import type { QuizInstructions } from '../../packages/quizzer/src/types';
import {
  BAKERY_DIR,
  loadCourse,
  courseAvailable,
  instructorFiles,
  bundledSolution,
  type CourseAssignment,
  type CourseGroup,
} from './load-course';
import { deriveQuiz } from './derive-quiz-answers';
import { ProblemReport, type ProblemCategory } from './report';

const gate = process.env.BAKERY_CONFORMANCE === '1' && courseAvailable();

// cisc108 rides along: the shipped !correct.py solutions import it, and the
// production deployment bundles it with the curriculum wheels (§10.1).
const PACKAGES = ['pedal', 'curriculum-sneks', 'bakery', 'cisc108'];

const groupFilter = (process.env.BAKERY_GROUPS ?? '')
  .split(',')
  .map((part) => part.trim().toLowerCase())
  .filter(Boolean);
const typeFilter = new Set(
  (process.env.BAKERY_TYPES ?? 'blockpy,quiz,reading')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean),
);

const groups: CourseGroup[] = gate
  ? loadCourse().filter(
      (group) =>
        groupFilter.length === 0 ||
        groupFilter.some((needle) => group.name.toLowerCase().includes(needle)),
    )
  : [];

const corpus = JSON.parse(readFileSync(join(BAKERY_DIR, 'solutions.json'), 'utf8')) as {
  solutions: Record<string, string>;
  /** Hand-authored answers for questions the deriver can't solve (regex). */
  quizAnswers?: Record<string, Record<string, unknown>>;
};
// Corpus-building workflow: an extra overlay file (same shape) merges over
// the committed corpus, and the report basename is overridable, so several
// solution-authoring sessions can validate concurrently without clobbering
// each other's reports.
if (process.env.BAKERY_SOLUTIONS_EXTRA) {
  const extra = JSON.parse(readFileSync(process.env.BAKERY_SOLUTIONS_EXTRA, 'utf8')) as {
    solutions?: Record<string, string>;
  };
  Object.assign(corpus.solutions, extra.solutions ?? {});
}
const REPORT_BASENAME = process.env.BAKERY_REPORT ?? 'bakery-report';

const report = new ProblemReport();
let runner: JobRunner | null = null;

/** One production-path grading pass; throws only on environment crashes. */
async function grade(
  assignment: CourseAssignment,
  studentCode: string,
): Promise<{ feedback?: PedalFeedback; crash?: string }> {
  const files: Record<string, string> = {};
  // Student-owned starting files stage unprefixed; instructor extras keep
  // their prefixes (pedal-env stages by prefix, A1 §3).
  const startingRaw = (assignment.extra_starting_files ?? '').trim();
  if (startingRaw.startsWith('{')) {
    try {
      for (const [name, contents] of Object.entries(JSON.parse(startingRaw) as object)) {
        if (typeof contents === 'string') files[name.replace(/^[!^?&$*#]/, '')] = contents;
      }
    } catch {
      /* unparseable starting files surface via grading itself */
    }
  }
  Object.assign(files, instructorFiles(assignment));
  // Honor the assignment's grading settings like the app does (App.tsx →
  // RunOptions): mutation-testing lectures set disable_tifa (the student
  // submission calls a grader-supplied function TIFA would flag) and
  // disable_instructor_run.
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(assignment.settings ?? '{}') as Record<string, unknown>;
  } catch {
    /* unparseable settings surface elsewhere */
  }
  const result = await runner!.execute({
    id: `conformance-${assignment.url}-${Math.random().toString(36).slice(2)}`,
    phase: 'instructor.on_run',
    files,
    code: studentCode,
    pedal: {
      onRun: assignment.on_run,
      // Canned stdin: input()-using assignments consume these instead of
      // dying on an empty queue (the UI walker answers '42' live, too).
      inputs: ['42', '42', '42', '42', '42', '42'],
      packages: PACKAGES,
      studentFiles: {},
      seed: String(assignment.id),
      skipTifa: settings['disable_tifa'] === true,
      skipRun: settings['disable_instructor_run'] === true,
    },
  });
  if (!result.success || !result.feedback) {
    return { crash: result.error?.traceback ?? result.error?.message ?? 'no feedback returned' };
  }
  return { feedback: result.feedback };
}

function problem(
  category: ProblemCategory,
  group: CourseGroup,
  assignment: CourseAssignment,
  detail: string,
): void {
  report.add({
    category,
    group: group.name,
    assignment: assignment.name,
    url: assignment.url,
    detail,
  });
}

const label = (feedback: PedalFeedback): string =>
  `${feedback.category}/${feedback.label}: ${String(feedback.message).slice(0, 160)}`;

describe.skipIf(!gate)('bakery curriculum conformance', () => {
  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const { loadPyodide } = await import('pyodide');
    const pyodide = await loadPyodide({ indexURL: dirname(require.resolve('pyodide')) });
    runner = JobRunner.create(pyodide as never);
  }, 300_000);

  afterAll(() => {
    report.write(join(BAKERY_DIR, REPORT_BASENAME), {
      groups: groups.length,
      packages: PACKAGES.join(', '),
      filters: groupFilter.join(',') || '(all groups)',
    });
    // The report is the deliverable; a summary also lands in the log.
    console.log(
      `\nbakery conformance: ${report.problems.length} problem(s) — see conformance/bakery/${REPORT_BASENAME}.md`,
    );
  });

  for (const group of groups) {
    describe(group.name, () => {
      for (const assignment of group.assignments) {
        if (!typeFilter.has(assignment.type)) continue;

        if (assignment.type === 'reading') {
          it(`reading ${assignment.url}`, () => {
            report.covered('reading');
            const settings = (assignment.settings ?? '').trim();
            if (settings) {
              try {
                JSON.parse(settings);
              } catch (error) {
                problem('reading-invalid-settings', group, assignment, String(error));
              }
            }
            if (!(assignment.instructions ?? '').trim()) {
              problem('reading-empty', group, assignment, 'no instructions body');
            }
          });
          continue;
        }

        if (assignment.type === 'quiz') {
          it(`quiz ${assignment.url}`, () => {
            report.covered('quiz');
            let instructions: QuizInstructions;
            let checks: QuizChecksDocument;
            // Distinguish unauthored (empty) documents from real JSON rot.
            if (!(assignment.instructions ?? '').trim() || !(assignment.on_run ?? '').trim()) {
              problem(
                'quiz-invalid-json',
                group,
                assignment,
                'UNAUTHORED: instructions and/or checks document is empty',
              );
              return;
            }
            try {
              instructions = JSON.parse(assignment.instructions) as QuizInstructions;
            } catch (error) {
              problem('quiz-invalid-json', group, assignment, `instructions: ${String(error)}`);
              return;
            }
            try {
              checks = JSON.parse(assignment.on_run) as QuizChecksDocument;
            } catch (error) {
              problem('quiz-invalid-json', group, assignment, `checks (on_run): ${String(error)}`);
              return;
            }
            const visible = selectVisibleQuestions(instructions, assignment.id, 0);
            const derived = deriveQuiz(instructions, checks, visible);
            // Hand-authored answers rescue underivable questions (regex-only
            // checks). They join both passes: a guaranteed-wrong answer is
            // not derivable for a regex either, so the wrong pass reuses the
            // correct value (LD-35 needs the question answered).
            const manual = corpus.quizAnswers?.[assignment.url];
            if (manual) {
              for (const [questionId, answer] of Object.entries(manual)) {
                if (derived.underivable[questionId] === undefined) continue;
                delete derived.underivable[questionId];
                derived.correctAnswers[questionId] = answer as never;
                derived.wrongAnswers[questionId] = answer as never;
              }
            }
            for (const note of derived.notes) {
              problem('quiz-authoring-smell', group, assignment, note);
            }
            const underivable = Object.entries(derived.underivable);
            if (underivable.length > 0) {
              problem(
                'quiz-underivable',
                group,
                assignment,
                underivable.map(([id, reason]) => `${id}: ${reason}`).join('\n'),
              );
            }
            // Mistake pass: the wrong submission must not be correct.
            if (derived.anyWrongPossible && underivable.length === 0) {
              const wrong = processQuiz(
                instructions,
                checks,
                { studentAnswers: derived.wrongAnswers, attempt: { count: 0 } },
                { visible },
              );
              if (wrong.correct) {
                problem(
                  'quiz-wrong-accepted',
                  group,
                  assignment,
                  'derived-wrong submission graded correct',
                );
              }
            }
            // Fix pass: the correct submission must score 100%.
            if (underivable.length === 0) {
              const correct = processQuiz(
                instructions,
                checks,
                { studentAnswers: derived.correctAnswers, attempt: { count: 0 } },
                { visible },
              );
              if (!correct.correct || correct.score < 1) {
                const misses = Object.entries(correct.feedbacks)
                  .filter(([, feedback]) => feedback.correct !== true)
                  .map(([id, feedback]) => `${id}: ${feedback.message.slice(0, 120)}`);
                problem(
                  'quiz-correct-rejected',
                  group,
                  assignment,
                  `score ${correct.score.toFixed(2)} of 1\n${misses.join('\n')}`,
                );
              }
            }
          });
          continue;
        }

        // blockpy — the important one. 90s: first grading pass in a fresh
        // interpreter includes wheel installation.
        it(`blockpy ${assignment.url}`, { timeout: 120_000 }, async () => {
          report.covered('blockpy');
          const starting = assignment.starting_code ?? '';

          // 1) Mistake pass: run the starting code as a student would.
          const mistake = await grade(assignment, starting);
          if (mistake.crash) {
            problem('grader-crash', group, assignment, mistake.crash);
            return; // interpreter state suspect — skip the other passes
          }
          const mistakeFeedback = mistake.feedback!;
          if (mistakeFeedback.system_error) {
            problem('grader-system-error', group, assignment, mistakeFeedback.system_error);
          }
          if (!String(mistakeFeedback.message ?? '').trim()) {
            problem('no-feedback', group, assignment, `label ${mistakeFeedback.label}`);
          }
          const startingPasses = mistakeFeedback.success === true;
          if (startingPasses && !starting.trim()) {
            problem('empty-work-passes', group, assignment, label(mistakeFeedback));
          }

          // 2) Broken pass: a syntax error must degrade to feedback, not a
          // crash or grader-internal error.
          const broken = await grade(assignment, starting + '\ndef broken(:\n');
          if (broken.crash) {
            problem('broken-code-mishandled', group, assignment, `crash: ${broken.crash}`);
          } else if (broken.feedback!.system_error) {
            problem('broken-code-mishandled', group, assignment, broken.feedback!.system_error);
          } else if (broken.feedback!.success === true) {
            problem(
              'broken-code-mishandled',
              group,
              assignment,
              `graded success: ${label(broken.feedback!)}`,
            );
          }

          // 3) Fix pass: the known-good solution must grade success. The
          // CURATED corpus beats the bundled !correct.py — corpus entries
          // exist precisely where the shipped solution is wrong/incomplete
          // (e.g. coverage lectures shipping only the test delta).
          const solution = corpus.solutions[assignment.url] ?? bundledSolution(assignment) ?? null;
          if (solution === null) {
            if (!startingPasses) {
              problem('solution-missing', group, assignment, 'no !correct.py and no corpus entry');
            }
            // startingPasses without a solution: the assignment is
            // self-solving ("run this program") — the mistake pass already
            // proved the success path.
            return;
          }
          const fixed = await grade(assignment, solution);
          if (fixed.crash) {
            problem('grader-crash', group, assignment, `solution pass: ${fixed.crash}`);
          } else if (fixed.feedback!.success !== true) {
            problem(
              'solution-rejected',
              group,
              assignment,
              `${fixed.feedback!.system_error ? 'system_error\n' + fixed.feedback!.system_error.slice(-400) + '\n' : ''}${label(fixed.feedback!)}`,
            );
          }
        });
      }
    });
  }

  it('walked at least one assignment', () => {
    expect(groups.some((group) => group.assignments.length > 0)).toBe(true);
  });
});
