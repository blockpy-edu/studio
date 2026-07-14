/**
 * Dev-harness server stub — the single source of truth for what the
 * `/api/*` endpoints answer. Two hosts consume it:
 *
 *  - the vite dev middleware (vite.config.ts) for `pnpm dev` + e2e, where
 *    tests observe REAL network requests;
 *  - the in-browser fetch stub (dev.ts) for the static GitHub Pages demo,
 *    where there is no server at all.
 *
 * Content: the original hand-written showcase fixtures (assignments
 * 101-108) plus the REAL bakery-curriculum groups (1A/6B) extracted into
 * demo/bakery-groups.json by tools/extract-demo-groups.mjs. Bakery quizzes
 * grade LOCALLY through the quizzer's own processQuiz — the same engine
 * the server runs — against the last-saved submission document.
 */
import type { AssignmentTypeIndex, GroupBootData } from './boot-config';
import bakeryGroups from './demo/bakery-groups.json';

/** One wire-shaped assignment record from the course export. */
interface DemoAssignmentRecord {
  id: number;
  name: string;
  url: string;
  type: string;
  instructions: string;
  starting_code: string | null;
  on_run: string | null;
  on_change: string | null;
  on_eval: string | null;
  extra_instructor_files: string | null;
  extra_starting_files: string | null;
  settings: string | null;
  hidden: boolean;
  reviewed: boolean;
  public: boolean;
  points: number;
  subordinate?: boolean;
  version?: number;
  [key: string]: unknown;
}

export interface DemoGroup {
  key: string;
  id: number;
  name: string;
  url: string;
  typeIndex: AssignmentTypeIndex;
  nav: GroupBootData['assignments'];
  assignments: DemoAssignmentRecord[];
}

export const DEMO_GROUPS: DemoGroup[] = (bakeryGroups as { groups: DemoGroup[] }).groups;

const DEMO_ASSIGNMENTS = new Map<number, DemoAssignmentRecord>();
for (const group of DEMO_GROUPS) {
  for (const assignment of group.assignments) {
    DEMO_ASSIGNMENTS.set(assignment.id, assignment);
  }
}

/**
 * Last-saved answer document per assignment (legacy save_file). The quiz
 * grading path needs it: submit sends only ids, the "server" grades the
 * stored submission.
 */
const savedAnswers = new Map<string, string>();

function demoLoadResponse(record: DemoAssignmentRecord): unknown {
  return {
    success: true,
    assignment: record,
    submission: {
      id: 9000 + record.id,
      code: record.type === 'blockpy' ? (record.starting_code ?? '') : '',
      extra_files: '',
      version: 1,
      correct: false,
      score: 0,
      submission_status: 'Started',
      grading_status: 'NotReady',
    },
  };
}

/** The slice of an assignment record quiz grading needs. */
export interface DemoQuizRecord {
  id: number;
  instructions: string;
  on_run: string | null;
}

export interface DemoQuizWireResult {
  success: boolean;
  correct: boolean;
  feedbacks: Record<string, unknown>;
  submission_status: string;
}

/**
 * Injected by the host (demo-quiz-grader.ts): the browser stub imports it
 * statically; the vite middleware ssr-loads it. This module stays free of
 * quizzer imports so the node-side config bundle can execute it.
 */
export type DemoQuizGrader = (record: DemoQuizRecord, savedAnswer: string) => DemoQuizWireResult;

/** Server-side quiz grading, stub edition: the quizzer's own engine. */
function gradeDemoQuiz(record: DemoAssignmentRecord, grader: DemoQuizGrader | undefined): unknown {
  try {
    if (!grader) throw new Error('no grader injected');
    return grader(record, savedAnswers.get(String(record.id)) ?? '');
  } catch {
    return { success: true, correct: false, feedbacks: {}, submission_status: 'inProgress' };
  }
}

// ---------------------------------------------------------------------------
// Showcase fixtures (assignments 101-108) — hand-written demo content that
// exercises every surface; moved verbatim from vite.config.ts.
// ---------------------------------------------------------------------------

const DEV_ASSIGNMENT = {
  success: true,
  assignment: {
    id: 101,
    name: 'Dev Harness Problem',
    url: 'dev_harness_problem',
    type: 'blockpy',
    version: 3,
    instructions:
      'Print the value of `a`.\n\nUse the **Run** button to execute:\n\n```python\na = 0\nprint(a)\n```',
    starting_code: 'a = 0\nprint(a)',
    on_run: [
      'from pedal import *',
      'if get_output() == ["0"]:',
      '    set_success()',
      'else:',
      '    gently("Try printing the value of a.", label="printing_a")',
      '',
    ].join('\n'),
    on_change: null,
    on_eval: null,
    extra_instructor_files: JSON.stringify({
      '&sample_data.txt': 'temperature,42\nhumidity,13\n',
    }),
    extra_starting_files: '',
    // preload_all_files exercises the remote-file pipeline (fetch the
    // uploaded listing at load, stage contents into runs).
    settings: '{"preload_all_files": true}',
    hidden: false,
    reviewed: false,
    public: true,
    points: 1,
  },
  submission: {
    id: 5001,
    code: 'a = 0\nprint(a)',
    extra_files: '',
    version: 7,
    correct: false,
    score: 0,
    submission_status: 'Started',
    grading_status: 'NotReady',
  },
};

const DEV_READING = {
  success: true,
  assignment: {
    id: 103,
    name: 'Reading: Variables',
    url: 'reading_variables',
    type: 'reading',
    version: 1,
    instructions: [
      '# Variables',
      '',
      'A **variable** holds a value. You can *reassign* it, `inspect` it, and',
      '[read more](https://en.wikipedia.org/wiki/Variable_(computer_science)) about it.',
      '',
      '> "Naming things is one of the two hard problems in computer science."',
      '',
      '## Try it yourself',
      '',
      'This block is **runnable** -- press Run to edit and execute it in place:',
      '',
      '```python part1',
      'age = 5',
      'print(age)',
      '```',
      '',
      'A second runnable part, sharing the same page engine:',
      '',
      '```python part2',
      'greeting = "Hello" + ", " + "world!"',
      'print(greeting)',
      'print(len(greeting))',
      '```',
      '',
      '## Reference material',
      '',
      'Plain fences render highlighted but inert (no part id):',
      '',
      '```python',
      'reference_only = True',
      '```',
      '',
      'Other languages highlight too:',
      '',
      '```javascript',
      'const answer = 6 * 7;',
      '```',
      '',
      'Unknown languages fall back to escaped text:',
      '',
      '```mystery',
      '<tags> & symbols stay literal',
      '```',
      '',
      '## Rich content',
      '',
      '| Name | Type | Example |',
      '|------|------|---------|',
      '| age | int | `5` |',
      '| greeting | str | `"hi"` |',
      '',
      '1. Ordered lists work',
      '2. So does <em>raw HTML</em> <span style="color: #b35900">(unsanitized, legacy parity)</span>',
      '',
      '- Relative images route through download_file:',
      '',
      '![diagram](variables.png)',
      '',
      '- Relative links too: [dataset](data.csv)',
    ].join('\n'),
    starting_code: '',
    on_run: '',
    on_change: null,
    on_eval: null,
    extra_instructor_files: '',
    extra_starting_files: '',
    settings: JSON.stringify({
      header: 'Chapter 1',
      summary: 'Variables hold values.',
      // Relative slides resolve through download_file (the Download button).
      slides: 'variables-slides.pdf',
    }),
    hidden: false,
    reviewed: false,
    public: true,
    points: 1,
  },
  submission: {
    id: 5003,
    code: '',
    extra_files: '',
    version: 1,
    correct: false,
    score: 0,
    submission_status: 'Started',
    grading_status: 'NotReady',
  },
};

const DEV_QUIZ = {
  success: true,
  assignment: {
    id: 102,
    name: 'Quiz: Variables',
    url: 'quiz_variables',
    type: 'quiz',
    version: 1,
    instructions: JSON.stringify({
      questions: {
        tf1: { type: 'true_false_question', body: 'Variables can change.', points: 1 },
        mcq1: {
          type: 'multiple_choice_question',
          body: 'Which keyword prints?',
          points: 2,
          answers: ['`print`', '`echo`', '`say`'],
        },
        pool_a: { type: 'short_answer_question', body: 'Name a variable.', points: 1 },
        pool_b: { type: 'short_answer_question', body: 'Name another variable.', points: 1 },
      },
      settings: { attemptLimit: 3, feedbackType: 'IMMEDIATE', poolRandomness: 'SEED' },
      pools: [{ name: 'Naming', amount: 1, questions: ['pool_a', 'pool_b'] }],
    }),
    starting_code: '',
    on_run: '',
    on_change: null,
    on_eval: null,
    extra_instructor_files: '',
    extra_starting_files: '',
    settings: '{}',
    hidden: false,
    reviewed: false,
    public: true,
    points: 1,
  },
  submission: {
    id: 5002,
    code: '',
    extra_files: '',
    version: 1,
    correct: false,
    score: 0,
    submission_status: 'Started',
    grading_status: 'NotReady',
  },
};

const QUIZ_FEEDBACKS = {
  tf1: { message: 'Right!', correct: true, score: 1, status: 'graded' },
  mcq1: { message: 'print it is.', correct: true, score: 1, status: 'graded' },
  pool_a: { message: 'Good name.', correct: true, score: 1, status: 'graded' },
  pool_b: { message: 'Good name.', correct: true, score: 1, status: 'graded' },
};

const DEV_TEXTBOOK = {
  success: true,
  assignment: {
    id: 105,
    name: 'Textbook: Chapter 1',
    url: 'textbook_chapter_1',
    type: 'textbook',
    version: 1,
    instructions: JSON.stringify({
      version: 1,
      settings: {},
      content: [
        {
          header: 'Chapter 1) Variables',
          content: [
            {
              reading: {
                id: 103,
                url: 'reading_variables',
                name: 'Reading: Variables',
                missing: false,
              },
            },
            {
              header: 'Part A',
              group: { id: 11, url: 'group_a', name: 'Group A', missing: false },
              content: [{ reading: { name: 'Missing Reading', missing: true } }],
            },
          ],
        },
      ],
    }),
    starting_code: '',
    on_run: '',
    on_change: null,
    on_eval: null,
    extra_instructor_files: '',
    extra_starting_files: '',
    settings: '{}',
    hidden: false,
    reviewed: false,
    public: true,
    points: 1,
  },
  submission: {
    id: 5005,
    code: '',
    extra_files: '',
    version: 1,
    correct: false,
    score: 0,
    submission_status: 'Started',
    grading_status: 'NotReady',
  },
};

const DEV_ASSIGNMENT_2 = {
  success: true,
  assignment: {
    ...DEV_ASSIGNMENT.assignment,
    id: 107,
    name: 'Plotting Temperatures',
    url: 'plotting_temperatures',
    instructions: [
      'Store three temperatures in a list and print the **maximum**.',
      '',
      'If matplotlib is available, try plotting them:',
      '',
      '```python',
      'import matplotlib.pyplot as plt',
      'plt.plot([31, 35, 40])',
      'plt.show()',
      '```',
    ].join('\n'),
    starting_code: 'temps = [31, 35, 40]\nprint(max(temps))',
    on_run: [
      'from pedal import *',
      'if get_output() == ["40"]:',
      '    set_success()',
      'else:',
      '    gently("Print the maximum temperature (40).", label="max_temp")',
      '',
    ].join('\n'),
    extra_instructor_files: '',
    settings: '{}',
  },
  submission: {
    ...DEV_ASSIGNMENT.submission,
    id: 5007,
    code: 'temps = [31, 35, 40]\nprint(max(temps))',
  },
};

const DEV_QUIZ_FULL = {
  success: true,
  assignment: {
    id: 104,
    name: 'Quiz: All Question Types',
    url: 'quiz_all_types',
    type: 'quiz',
    version: 1,
    instructions: JSON.stringify({
      questions: {
        tf1: { type: 'true_false_question', body: 'A `list` can hold **mixed** types.', points: 1 },
        mc1: {
          type: 'multiple_choice_question',
          body: 'Which function *prints* to the console?',
          points: 2,
          answers: ['`print`', '`echo`', '`console.log`', '`say`'],
        },
        ma1: {
          type: 'multiple_answers_question',
          body: 'Check every <strong>number</strong> type:',
          points: 2,
          answers: [
            '<code>int</code>',
            '<code>float</code>',
            '<code>str</code>',
            '<code>bool</code>',
          ],
        },
        match1: {
          type: 'matching_question',
          body: 'Match each value to its type:',
          points: 3,
          statements: ['`5`', '`"five"`', '`5.0`'],
          answers: ['int', 'str', 'float', 'complex'],
        },
        drop1: {
          type: 'multiple_dropdowns_question',
          body: 'The result of `10 / 4` is [quotient] and `10 // 4` is [floor].',
          points: 2,
          answers: { quotient: ['2.5', '2', '2.25'], floor: ['2', '2.5', '3'] },
        },
        sa1: { type: 'short_answer_question', body: 'What keyword defines a function?', points: 1 },
        num1: { type: 'numerical_question', body: 'What is `2 ** 5`?', points: 1 },
        fimb1: {
          type: 'fill_in_multiple_blanks_question',
          body: 'A [container] holds items; you index it with [brackets].',
          points: 2,
        },
        essay1: {
          type: 'essay_question',
          body: 'Explain, in a sentence, why names matter.',
          points: 0,
        },
        note1: {
          type: 'text_only_question',
          body: '<em>The pool below shows 2 of 3 questions, seeded by your submission.</em>',
          points: 0,
        },
        legacy1: {
          type: 'calculated_question',
          body: 'A legacy Canvas import lands here.',
          points: 0,
        },
        pool_a: {
          type: 'short_answer_question',
          body: 'Name a **mutable** built-in type.',
          points: 1,
        },
        pool_b: {
          type: 'short_answer_question',
          body: 'Name an **immutable** built-in type.',
          points: 1,
        },
        pool_c: {
          type: 'short_answer_question',
          body: 'Name a type you can iterate over.',
          points: 1,
        },
      },
      settings: { attemptLimit: -1, feedbackType: 'IMMEDIATE', poolRandomness: 'ATTEMPT' },
      pools: [{ name: 'Types', amount: 2, questions: ['pool_a', 'pool_b', 'pool_c'] }],
    }),
    starting_code: '',
    on_run: JSON.stringify({
      questions: {
        tf1: { correct: true, wrong: 'Lists are heterogeneous in Python.' },
        mc1: {
          correct: '`print`',
          feedback: {
            '`echo`': 'That is shell, not Python.',
            '`console.log`': 'That is JavaScript.',
          },
        },
        ma1: {
          correct: ['<code>int</code>', '<code>float</code>'],
          wrong_any: 'bool is a number subtype; str is not a number.',
        },
        match1: { correct: ['int', 'str', 'float'] },
        drop1: {
          correct: { quotient: '2.5', floor: '2' },
          wrong_any: 'True division vs floor division.',
        },
        sa1: {
          correct: ['def'],
          feedback: { lambda: 'lambda makes anonymous functions; we wanted def.' },
        },
        num1: { correct_regex: ['^32(\\.0)?$'], wrong_any: 'Two to the fifth power.' },
        fimb1: {
          correct: {
            container: ['list', 'tuple', 'dict'],
            brackets: ['brackets', 'square brackets', '[]'],
          },
          wrong_any: 'Think of lists and [square] brackets.',
        },
        pool_a: { correct: ['list', 'dict', 'set'] },
        pool_b: { correct: ['tuple', 'str', 'int', 'frozenset'] },
        pool_c: { correct_regex: ['^(list|tuple|str|dict|set|range)$'] },
      },
    }),
    on_change: null,
    on_eval: null,
    extra_instructor_files: '',
    extra_starting_files: '',
    settings: '{}',
    hidden: false,
    reviewed: false,
    public: true,
    points: 15,
  },
  submission: {
    id: 5004,
    code: '',
    extra_files: '',
    version: 1,
    correct: false,
    score: 0,
    submission_status: 'Started',
    grading_status: 'NotReady',
  },
};

const QUIZ_FULL_FEEDBACKS = {
  tf1: { message: 'Right -- lists hold anything.', correct: true, score: 1, status: 'graded' },
  mc1: { message: 'That is JavaScript.', correct: false, score: 0, status: 'graded' },
  ma1: {
    message: 'bool is a number subtype; str is not a number.',
    correct: false,
    score: 0.5,
    status: 'graded',
  },
  match1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  drop1: {
    message: 'True division vs floor division.',
    correct: false,
    score: 0.5,
    status: 'graded',
  },
  sa1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  num1: { message: 'Two to the fifth power.', correct: false, score: 0, status: 'graded' },
  fimb1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  essay1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  note1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  legacy1: {
    message: 'Unknown Type: calculated_question',
    correct: null,
    score: 0,
    status: 'error',
  },
  pool_a: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  pool_b: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  pool_c: { message: 'Correct', correct: true, score: 1, status: 'graded' },
};

const devHistory = () => {
  const hourAgo = Date.now() - 3_600_000;
  return {
    success: true,
    history: [
      {
        event_type: 'Session.Start',
        file_path: '',
        client_timestamp: String(hourAgo),
        message: '',
      },
      {
        event_type: 'File.Create',
        file_path: 'answer.py',
        client_timestamp: String(hourAgo + 1_000),
        message: 'a = 0\nprint(a)',
      },
      {
        event_type: 'File.Edit',
        file_path: 'answer.py',
        client_timestamp: String(hourAgo + 60_000),
        message: 'a = 0\nb = a + 1\nprint(a)',
      },
      {
        event_type: 'Run.Program',
        file_path: 'answer.py',
        client_timestamp: String(hourAgo + 61_000),
        message: '',
      },
      {
        event_type: 'File.Edit',
        file_path: 'answer.py',
        client_timestamp: String(hourAgo + 120_000),
        message: 'a = 0\nprint(a)',
      },
    ],
  };
};

// One canned uploaded file exercises the whole remote-file pipeline
// (list → filesToUrls → download → engine staging).
const uploaded = {
  success: true,
  files: {
    assignment: [
      [
        'capitals.txt',
        '/api/download_file?placement=assignment&directory=101&filename=capitals.txt',
      ],
    ],
  },
};

const routes: Record<string, (params: URLSearchParams, grader?: DemoQuizGrader) => unknown> = {
  '/api/load_assignment': (params) => {
    const id = Number(params.get('assignment_id'));
    const demo = DEMO_ASSIGNMENTS.get(id);
    if (demo) return demoLoadResponse(demo);
    switch (params.get('assignment_id')) {
      case '103':
        return DEV_READING;
      case '102':
        return DEV_QUIZ;
      case '104':
        return DEV_QUIZ_FULL;
      case '105':
        return DEV_TEXTBOOK;
      case '107':
        return DEV_ASSIGNMENT_2;
      default:
        return DEV_ASSIGNMENT;
    }
  },
  '/api/load_history': devHistory,
  '/api/save_file': (params) => {
    // Remember the answer document — quiz grading reads it back.
    const id = params.get('assignment_id');
    if (id && params.get('filename') === 'answer.py') {
      savedAnswers.set(id, params.get('code') ?? '');
    }
    return { success: true };
  },
  '/api/log_event': () => ({ success: true }),
  // markRead echoes correct/submission_status (reader.ts:399-413); quiz
  // submits get the server-graded feedbacks map (regrade_if_quiz).
  '/api/update_submission': (params, grader) => {
    const id = Number(params.get('assignment_id'));
    const demo = DEMO_ASSIGNMENTS.get(id);
    if (demo?.type === 'quiz') return gradeDemoQuiz(demo, grader);
    return params.get('assignment_id') === '102'
      ? {
          success: true,
          correct: true,
          feedbacks: QUIZ_FEEDBACKS,
          submission_status: 'Completed',
        }
      : params.get('assignment_id') === '104'
        ? {
            success: true,
            correct: false,
            feedbacks: QUIZ_FULL_FEEDBACKS,
            submission_status: 'inProgress',
          }
        : {
            success: true,
            correct: params.get('correct') === 'true',
            submission_status: 'Completed',
          };
  },
  '/api/update_submission_status': () => ({ success: true }),
  // GET-only by_url resolution (assignments.py:341-353) — quizzes resolve
  // their subordinate-reading url slugs through this before rendering the
  // preamble. Demo records only; the showcase fixtures use numeric ids.
  '/api/assignments/by_url': (params) => {
    const url = params.get('url');
    const match = url
      ? [...DEMO_ASSIGNMENTS.values()].find((record) => record.url === url)
      : undefined;
    return match
      ? { success: true, assignment: match }
      : { success: false, message: `Assignment ${url ?? ''} does not exist` };
  },
  '/api/list_files': () => uploaded,
  '/api/upload_file': () => ({ success: true }),
  '/api/rename_file': () => ({ success: true }),
  '/api/start_assignment': () => ({ success: true }),
  // Clock "activity" mode total (spec §9.4): 25 minutes of prior sessions.
  '/api/estimate_group_duration': () => ({ success: true, duration: 1500 }),
};

export interface DevStubResponse {
  json?: unknown;
  /** downloadFile answers raw text (legacy dataType: "text"). */
  text?: string;
}

/** Route one stubbed POST; null = not an API route (let the host 404). */
export function routeDevRequest(
  path: string,
  params: URLSearchParams,
  grader?: DemoQuizGrader,
): DevStubResponse | null {
  if (path === '/api/download_file') {
    return { text: 'France,Paris\nGreece,Athens\n' };
  }
  const route = routes[path];
  if (!route) return null;
  return { json: route(params, grader) };
}
