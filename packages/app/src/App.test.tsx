// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import type { BootConfig } from './boot-config';

const minimalConfig: BootConfig = {
  urls: {},
  user: { id: null, role: 'anonymous', courseId: null },
  assignment: {
    currentAssignmentId: null,
    assignmentGroupId: null,
    typeIndex: {
      quiz: [],
      reading: [],
      textbook: [],
      java: [],
      typescript: [],
      explain: [],
      blockpy: [],
    },
  },
  display: { instructor: false, readOnly: false, embed: false },
  passcodeProtected: false,
  sessionStartTime: null,
  paths: { blocklyMedia: '', emojiProxy: '', pyodideIndexURL: '' },
  settings: {},
  corgisUrl: '',
};

const RAW_PAYLOAD = {
  assignment: {
    id: 101,
    name: 'Server Problem',
    url: 'server_problem',
    type: 'blockpy',
    version: 3,
    instructions: 'Fetched instructions.',
    starting_code: 'x = 1',
    on_run: '',
    on_change: null,
    on_eval: null,
    extra_instructor_files: '',
    extra_starting_files: '',
    settings: '{}',
  },
  submission: {
    id: 5001,
    code: 'x = 2',
    extra_files: '',
    version: 7,
    correct: false,
    score: 0,
  },
};

it('renders the shell from a minimal BootConfig', () => {
  render(<App config={minimalConfig} />);
  expect(screen.getByRole('heading', { name: 'BlockPy Studio' })).toBeDefined();
});

it('adopts inline assignment_data at boot (editor.html:341-342 path)', async () => {
  render(
    <App
      config={{
        ...minimalConfig,
        assignment: { ...minimalConfig.assignment, assignmentData: RAW_PAYLOAD },
      }}
    />,
  );
  await waitFor(() => {
    expect(screen.getAllByText(/Server Problem/).length).toBeGreaterThan(0);
  });
  expect(screen.getByText('Fetched instructions.')).toBeDefined();
});

it('fetches the boot assignment through the ApiClient (§14.2)', async () => {
  const fetchStub = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('load_assignment') ? { success: true, ...RAW_PAYLOAD } : { success: true },
  })) as unknown as typeof fetch;
  render(
    <App
      config={{
        ...minimalConfig,
        urls: { loadAssignment: '/api/load_assignment' },
        assignment: { ...minimalConfig.assignment, currentAssignmentId: 101 },
      }}
      extras={{ fetch: fetchStub }}
    />,
  );
  await waitFor(() => {
    expect(screen.getAllByText(/Server Problem/).length).toBeGreaterThan(0);
  });
  // The wire call carried the assignment id (createServerData base fields).
  const [, init] = (fetchStub as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [
    string,
    { body: string },
  ];
  expect(init.body).toContain('assignment_id=101');
});

it('dual-renders the group nav and publishes the markCorrect global (§9, §15.3)', async () => {
  const globals = window as unknown as Record<string, unknown>;
  const view = render(
    <App
      config={{
        ...minimalConfig,
        assignment: { ...minimalConfig.assignment, assignmentData: RAW_PAYLOAD },
        group: {
          assignments: [
            { id: 101, name: 'Server Problem', url: '#101', subordinate: false, hidden: false, correct: false },
            { id: 103, name: 'Reading', url: '#103', subordinate: false, hidden: false, correct: false },
          ],
          anySecretive: false,
          currentAssignmentId: 101,
        },
      }}
    />,
  );
  await waitFor(() => {
    // Top AND bottom instances (editor.html:102-103, 188-190).
    expect(view.container.querySelectorAll('.assignment-selector-div')).toHaveLength(2);
  });
  expect(typeof globals['markCorrect']).toBe('function');
  (globals['markCorrect'] as (id: number) => void)(103);
  await waitFor(() => {
    for (const header of view.container.querySelectorAll('.assignment-selector-div')) {
      expect(header.querySelector('.completion-rate')!.textContent).toBe('1');
    }
  });
  view.unmount();
  expect(globals['markCorrect']).toBeUndefined();
});

it('never clobbers a legacy-template markCorrect on group-less pages (shim mode)', () => {
  const globals = window as unknown as Record<string, unknown>;
  const legacyMarkCorrect = () => undefined;
  globals['markCorrect'] = legacyMarkCorrect;
  const view = render(<App config={minimalConfig} />);
  expect(globals['markCorrect']).toBe(legacyMarkCorrect);
  view.unmount();
  expect(globals['markCorrect']).toBe(legacyMarkCorrect);
  delete globals['markCorrect'];
});

it('surfaces a load failure without crashing (legacy fallback renderer)', async () => {
  const fetchStub = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: false }),
  })) as unknown as typeof fetch;
  render(
    <App
      config={{
        ...minimalConfig,
        urls: { loadAssignment: '/api/load_assignment' },
        assignment: { ...minimalConfig.assignment, currentAssignmentId: 999 },
      }}
      extras={{ fetch: fetchStub }}
    />,
  );
  await waitFor(() => {
    expect(screen.getByText(/failed to load/)).toBeDefined();
  });
});
