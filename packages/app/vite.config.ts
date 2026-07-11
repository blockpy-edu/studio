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
      'A **variable** holds a value.',
      '',
      '```python part1',
      'age = 5',
      'print(age)',
      '```',
      '',
      '```python',
      'reference_only = True',
      '```',
      '',
      '![diagram](variables.png)',
      '',
      '[dataset](data.csv)',
    ].join('\n'),
    starting_code: '',
    on_run: '',
    on_change: null,
    on_eval: null,
    extra_instructor_files: '',
    extra_starting_files: '',
    settings: JSON.stringify({ header: 'Chapter 1', summary: 'Variables hold values.' }),
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
    '/api/load_assignment': (params) =>
      params.get('assignment_id') === '103'
        ? DEV_READING
        : params.get('assignment_id') === '102'
          ? DEV_QUIZ
          : DEV_ASSIGNMENT,
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
