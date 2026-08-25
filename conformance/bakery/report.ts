/**
 * Problem collector + report writer shared by the conformance suite (Node)
 * and the Playwright UI walker. Every "doesn't work completely" finding
 * lands here with a category and enough context to investigate, then the
 * whole run is written as bakery-report.md / bakery-report.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Problem taxonomy — each category is one investigation queue. */
export type ProblemCategory =
  // blockpy
  | 'grader-crash' // grading pass threw at the environment level
  | 'grader-system-error' // Pedal fail-soft (system_error traceback)
  | 'empty-work-passes' // starting code graded success (broken grader)
  | 'broken-code-mishandled' // syntax-error variant did not yield syntax feedback
  | 'solution-missing' // no !correct.py and no corpus entry
  | 'solution-rejected' // known-good solution did not grade success
  | 'no-feedback' // grading returned no presentable feedback
  // quiz
  | 'quiz-underivable' // could not derive a correct answer from checks
  | 'quiz-correct-rejected' // derived-correct submission not 100%
  | 'quiz-wrong-accepted' // derived-wrong submission graded correct
  | 'quiz-invalid-json' // instructions or checks failed to parse
  | 'quiz-authoring-smell' // correct value not among options, etc.
  // reading
  | 'reading-invalid-settings' // settings JSON failed to parse
  | 'reading-empty' // no body/instructions to read
  // UI walker
  | 'ui-flow-failure'; // any step of mistake→feedback→fix→submit failed

export interface Problem {
  category: ProblemCategory;
  group: string;
  assignment: string;
  /** Assignment url slug — the stable investigation handle. */
  url: string;
  detail: string;
}

export class ProblemReport {
  readonly problems: Problem[] = [];
  private counts = { blockpy: 0, quiz: 0, reading: 0, other: 0 };

  add(problem: Problem): void {
    this.problems.push(problem);
  }

  covered(type: string): void {
    if (type === 'blockpy' || type === 'quiz' || type === 'reading') this.counts[type] += 1;
    else this.counts.other += 1;
  }

  write(basePath: string, meta: Record<string, unknown> = {}): void {
    mkdirSync(dirname(basePath), { recursive: true });
    const byCategory = new Map<ProblemCategory, Problem[]>();
    for (const problem of this.problems) {
      if (!byCategory.has(problem.category)) byCategory.set(problem.category, []);
      byCategory.get(problem.category)!.push(problem);
    }
    const json = {
      generated: new Date().toISOString(),
      meta,
      covered: this.counts,
      totalProblems: this.problems.length,
      problems: this.problems,
    };
    writeIfChanged(`${basePath}.json`, JSON.stringify(json, null, 2) + '\n');

    const lines: string[] = [];
    lines.push('# Bakery curriculum conformance report');
    lines.push('');
    lines.push(`Generated: ${json.generated}`);
    for (const [key, value] of Object.entries(meta)) lines.push(`- ${key}: ${String(value)}`);
    lines.push(
      `- Covered: ${this.counts.blockpy} blockpy, ${this.counts.quiz} quiz, ` +
        `${this.counts.reading} reading${this.counts.other ? `, ${this.counts.other} other` : ''}`,
    );
    lines.push(`- Problems: ${this.problems.length}`);
    lines.push('');
    const ranked = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [category, problems] of ranked) {
      lines.push(`## ${category} (${problems.length})`);
      lines.push('');
      for (const problem of problems) {
        lines.push(`- \`${problem.url}\` (${problem.group} — ${problem.assignment})`);
        const detail = problem.detail.trim();
        if (detail) {
          for (const detailLine of detail.split('\n').slice(0, 6)) {
            lines.push(`  ${detailLine}`);
          }
        }
      }
      lines.push('');
    }
    if (this.problems.length === 0) {
      lines.push('No problems found.');
      lines.push('');
    }
    writeIfChanged(`${basePath}.md`, lines.join('\n'));
  }
}

const GENERATED_LINE = /^\s*"?[Gg]enerated"?:.*$/m;

/**
 * Only rewrite the report when something OTHER than the `generated`
 * timestamp changed, so an unchanged run does not dirty git. Set
 * BAKERY_REPORT_FORCE=1 to always rewrite (fresh timestamp).
 */
function writeIfChanged(path: string, content: string): void {
  if (!process.env['BAKERY_REPORT_FORCE'] && existsSync(path)) {
    const previous = readFileSync(path, 'utf8');
    if (previous.replace(GENERATED_LINE, '') === content.replace(GENERATED_LINE, '')) return;
  }
  writeFileSync(path, content);
}
