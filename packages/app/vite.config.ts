import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-harness payload: what /api/load_assignment serves, shaped exactly
 * like a blockpy-server response (spec §14.5) so the harness exercises the
 * REAL load pipeline (fetch → decode → VFS → editor) instead of canned
 * in-app state. Contents match what the harness seeded before M1.6.
 */
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

/**
 * The harness group's reading (id 103): markdown body with a runnable
 * python fence (part id → Run button → minified editor), a plain fence,
 * a relative image (download_file rewrite), and reader settings.
 */
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

/**
 * The harness group's (subordinate) quiz, id 102: two fixed questions plus
 * a two-question pool showing one (seeded by submission id 5002). The
 * checks document stays server-side — the stub grades every submit as
 * fully correct.
 */
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

/**
 * The harness textbook (105): a chaptered composition over reading 103
 * (spec §11.4). NOTE the stub serves REHYDRATED object references — on the
 * wire the v1 document carries url strings and only the server's dedicated
 * textbook route rehydrates them (ledger LD-16 flags the JSON-endpoint
 * gap); the harness demonstrates the resolved shape plus the legacy
 * "Missing Reading" fallback.
 */
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

/** A second coding problem (107): different starter, gentle grader. */
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

/**
 * The showcase quiz (104): every question type -- the 10 rendered ones plus
 * an unsupported calculated_question demonstrating the pass-through
 * fallback -- with a 3-question pool showing 2, markdown/HTML choices,
 * blank-id bodies, and per-answer feedback. The stub grades it with a
 * MIXED feedbacks map so all feedback visuals (green/red/dark) appear.
 */
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
          answers: ['<code>int</code>', '<code>float</code>', '<code>str</code>', '<code>bool</code>'],
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
        essay1: { type: 'essay_question', body: 'Explain, in a sentence, why names matter.', points: 0 },
        note1: { type: 'text_only_question', body: '<em>The pool below shows 2 of 3 questions, seeded by your submission.</em>', points: 0 },
        legacy1: { type: 'calculated_question', body: 'A legacy Canvas import lands here.', points: 0 },
        pool_a: { type: 'short_answer_question', body: 'Name a **mutable** built-in type.', points: 1 },
        pool_b: { type: 'short_answer_question', body: 'Name an **immutable** built-in type.', points: 1 },
        pool_c: { type: 'short_answer_question', body: 'Name a type you can iterate over.', points: 1 },
      },
      settings: { attemptLimit: -1, feedbackType: 'IMMEDIATE', poolRandomness: 'ATTEMPT' },
      pools: [{ name: 'Types', amount: 2, questions: ['pool_a', 'pool_b', 'pool_c'] }],
    }),
    starting_code: '',
    on_run: JSON.stringify({
      questions: {
        tf1: { correct: true, wrong: 'Lists are heterogeneous in Python.' },
        mc1: { correct: '`print`', feedback: { '`echo`': 'That is shell, not Python.', '`console.log`': 'That is JavaScript.' } },
        ma1: { correct: ['<code>int</code>', '<code>float</code>'], wrong_any: 'bool is a number subtype; str is not a number.' },
        match1: { correct: ['int', 'str', 'float'] },
        drop1: { correct: { quotient: '2.5', floor: '2' }, wrong_any: 'True division vs floor division.' },
        sa1: { correct: ['def'], feedback: { lambda: 'lambda makes anonymous functions; we wanted def.' } },
        num1: { correct_regex: ['^32(\\.0)?$'], wrong_any: 'Two to the fifth power.' },
        fimb1: { correct: { container: ['list', 'tuple', 'dict'], brackets: ['brackets', 'square brackets', '[]'] }, wrong_any: 'Think of lists and [square] brackets.' },
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

/** Mixed grading echo for 104: every feedback visual state on display. */
const QUIZ_FULL_FEEDBACKS = {
  tf1: { message: 'Right -- lists hold anything.', correct: true, score: 1, status: 'graded' },
  mc1: { message: 'That is JavaScript.', correct: false, score: 0, status: 'graded' },
  ma1: { message: 'bool is a number subtype; str is not a number.', correct: false, score: 0.5, status: 'graded' },
  match1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  drop1: { message: 'True division vs floor division.', correct: false, score: 0.5, status: 'graded' },
  sa1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  num1: { message: 'Two to the fifth power.', correct: false, score: 0, status: 'graded' },
  fimb1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  essay1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  note1: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  legacy1: { message: 'Unknown Type: calculated_question', correct: null, score: 0, status: 'error' },
  pool_a: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  pool_b: { message: 'Correct', correct: true, score: 1, status: 'graded' },
  pool_c: { message: 'Correct', correct: true, score: 1, status: 'graded' },
};

const devHistory = () => {
  const hourAgo = Date.now() - 3_600_000;
  return {
    success: true,
    history: [
      { event_type: 'Session.Start', file_path: '', client_timestamp: String(hourAgo), message: '' },
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

/** Stub blockpy-server endpoints for the dev harness + smoke tests. */
function devApi(): Plugin {
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
  const routes: Record<string, (params: URLSearchParams) => unknown> = {
    '/api/load_assignment': (params) => {
      switch (params.get('assignment_id')) {
        case '103': return DEV_READING;
        case '102': return DEV_QUIZ;
        case '104': return DEV_QUIZ_FULL;
        case '105': return DEV_TEXTBOOK;
        case '107': return DEV_ASSIGNMENT_2;
        default: return DEV_ASSIGNMENT;
      }
    },
    '/api/load_history': devHistory,
    '/api/save_file': () => ({ success: true }),
    '/api/log_event': () => ({ success: true }),
    // markRead echoes correct/submission_status (reader.ts:399-413); quiz
    // submits get the server-graded feedbacks map (regrade_if_quiz).
    '/api/update_submission': (params) =>
      params.get('assignment_id') === '102'
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
          },
    '/api/update_submission_status': () => ({ success: true }),
    '/api/list_files': () => uploaded,
    '/api/upload_file': () => ({ success: true }),
    '/api/rename_file': () => ({ success: true }),
    '/api/start_assignment': () => ({ success: true }),
    // Clock "activity" mode total (spec §9.4): 25 minutes of prior sessions.
    '/api/estimate_group_duration': () => ({ success: true, duration: 1500 }),
  };
  return {
    name: 'blockpy-dev-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (req.method !== 'POST') return next();
        if (path === '/api/download_file') {
          // downloadFile answers raw text (legacy dataType: "text").
          res.setHeader('Content-Type', 'text/plain');
          res.end('France,Paris\nGreece,Athens\n');
          return;
        }
        const route = routes[path];
        if (!route) return next();
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let params: URLSearchParams;
          try {
            params = new URLSearchParams(body);
          } catch {
            params = new URLSearchParams();
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(route(params)));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
});
