import { describe, expect, it } from 'vitest';
import { decodeAssignment, decodeSubmission } from '@blockpy/api';
import {
  parseAssignmentSettings,
  parseConcatenatedFiles,
  vfsFromAssignment,
} from './assignment-loader';

const RAW_ASSIGNMENT = {
  id: 101,
  name: 'Problem',
  url: 'problem',
  type: 'blockpy',
  version: 3,
  instructions: 'Do the thing.',
  starting_code: 'a = 0',
  on_run: 'from pedal import *',
  on_change: null,
  on_eval: null,
  extra_instructor_files: JSON.stringify({
    '&data.csv': 'x,y\n1,2\n',
    '?mock_urls.blockpy': '{}',
  }),
  extra_starting_files: JSON.stringify({ '^helper.py': 'HELP = 1' }),
  settings: '{"toolbox": "ct2", "hide_files": false}',
};

describe('parseConcatenatedFiles (files.js:259 wire format)', () => {
  it('parses the {filename: contents} object', () => {
    expect(parseConcatenatedFiles('{"a.txt": "hi"}')).toEqual({ 'a.txt': 'hi' });
  });

  it('fails soft on empty/malformed/array blobs', () => {
    expect(parseConcatenatedFiles('')).toEqual({});
    expect(parseConcatenatedFiles('not json')).toEqual({});
    expect(parseConcatenatedFiles('[1,2]')).toEqual({});
  });
});

describe('vfsFromAssignment (blockpy.js:491 loadAssignmentData_)', () => {
  it('maps model-bound files and extra file bundles (A1)', () => {
    const assignment = decodeAssignment(RAW_ASSIGNMENT);
    const submission = decodeSubmission({
      id: 5001,
      code: 'a = 7',
      extra_files: JSON.stringify({ 'notes.txt': 'mine' }),
      version: 2,
      correct: false,
      score: 0,
    });
    const vfs = vfsFromAssignment(assignment, submission);
    expect(vfs.read('answer.py')).toBe('a = 7'); // submission wins
    expect(vfs.read('^starting_code.py')).toBe('a = 0');
    expect(vfs.read('!instructions.md')).toBe('Do the thing.');
    expect(vfs.read('!on_run.py')).toBe('from pedal import *');
    expect(vfs.read('!assignment_settings.blockpy')).toBe(RAW_ASSIGNMENT.settings);
    expect(vfs.read('&data.csv')).toBe('x,y\n1,2\n');
    expect(vfs.read('?mock_urls.blockpy')).toBe('{}');
    expect(vfs.read('^helper.py')).toBe('HELP = 1');
    expect(vfs.read('notes.txt')).toBe('mine');
    // on_change/on_eval are unconfigured (null) → files must NOT exist,
    // since tab visibility keys off existence (files.js:36-39).
    expect(vfs.read('!on_change.py')).toBeUndefined();
    expect(vfs.read('!on_eval.py')).toBeUndefined();
  });

  it('falls back to starting code without a submission (loadNoSubmission)', () => {
    const vfs = vfsFromAssignment(decodeAssignment(RAW_ASSIGNMENT));
    expect(vfs.read('answer.py')).toBe('a = 0');
  });

  it('creates on_change/on_eval files when configured', () => {
    const vfs = vfsFromAssignment(
      decodeAssignment({ ...RAW_ASSIGNMENT, on_change: 'log()', on_eval: 'check()' }),
    );
    expect(vfs.read('!on_change.py')).toBe('log()');
    expect(vfs.read('!on_eval.py')).toBe('check()');
  });
});

describe('parseAssignmentSettings (A4 blob)', () => {
  it('parses the settings JSON', () => {
    expect(parseAssignmentSettings(RAW_ASSIGNMENT.settings)).toEqual({
      toolbox: 'ct2',
      hide_files: false,
    });
  });

  it('fails soft on malformed blobs', () => {
    expect(parseAssignmentSettings('')).toEqual({});
    expect(parseAssignmentSettings('nope')).toEqual({});
  });
});
