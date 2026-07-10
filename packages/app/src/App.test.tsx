// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

it('renders the shell from a minimal BootConfig', () => {
  render(<App config={minimalConfig} />);
  expect(screen.getByRole('heading', { name: 'BlockPy Studio' })).toBeDefined();
});
