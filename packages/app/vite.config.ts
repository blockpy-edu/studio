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
    settings: '{}',
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
  const routes: Record<string, () => unknown> = {
    '/api/load_assignment': () => DEV_ASSIGNMENT,
    '/api/load_history': devHistory,
    '/api/save_file': () => ({ success: true }),
    '/api/log_event': () => ({ success: true }),
    '/api/update_submission': () => ({ success: true }),
    '/api/update_submission_status': () => ({ success: true }),
  };
  return {
    name: 'blockpy-dev-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const route = routes[path];
        if (!route || req.method !== 'POST') return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(route()));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
});
