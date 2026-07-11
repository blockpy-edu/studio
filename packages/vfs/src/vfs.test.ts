/**
 * Conformance suite: layered VFS behavior (spec §16.1.1).
 * Search orders, visibility, mutability, bundles per appendix A1.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { editableBy, visibleInUi } from './permissions';
import { Vfs } from './vfs';

let vfs: Vfs;
beforeEach(() => {
  vfs = new Vfs();
});

describe('search order (files.js:563-599, A1 §4a)', () => {
  it("student: '?' outranks '&', plain, and '*' — not shadowable", () => {
    vfs.write('data.txt', 'student');
    vfs.write('?data.txt', 'hidden');
    vfs.write('&data.txt', 'readonly');
    vfs.write('*data.txt', 'generated');
    expect(vfs.searchForFile('data.txt', 'student')).toMatchObject({
      kind: 'file',
      entry: { legacyName: '?data.txt', contents: 'hidden' },
    });
  });

  it("student: '&' outranks the student's own file", () => {
    vfs.write('data.txt', 'student');
    vfs.write('&data.txt', 'readonly');
    expect(vfs.searchForFile('data.txt', 'student')).toMatchObject({
      entry: { contents: 'readonly' },
    });
  });

  it("instructor EVERYWHERE order: '&' → plain → '*' → '!' → '?' → '^'", () => {
    vfs.write('!data.txt', 'bang');
    vfs.write('?data.txt', 'hidden');
    expect(vfs.searchForFile('data.txt', 'instructor')).toMatchObject({
      entry: { legacyName: '!data.txt' },
    });
    vfs.write('data.txt', 'plain');
    expect(vfs.searchForFile('data.txt', 'instructor')).toMatchObject({
      entry: { legacyName: 'data.txt' },
    });
    vfs.write('&data.txt', 'amp');
    expect(vfs.searchForFile('data.txt', 'instructor')).toMatchObject({
      entry: { legacyName: '&data.txt' },
    });
  });

  it("instructor _instructor/ path order: '!' wins", () => {
    vfs.write('&data.txt', 'amp');
    vfs.write('!data.txt', 'bang');
    expect(vfs.searchForFile('data.txt', 'instructor', { instructorPath: true })).toMatchObject({
      entry: { legacyName: '!data.txt' },
    });
  });

  it('stageFiles: student view resolves shadowing, strips prefixes, skips instructor spaces', () => {
    vfs.write('data.txt', 'student');
    vfs.write('?data.txt', 'hidden'); // wins for students
    vfs.write('&extra.csv', 'x,1');
    vfs.write('!secret.py', 'answer = 42'); // instructor-only: not staged
    vfs.write('^starting_code.py', 'a = 0');
    const staged = vfs.stageFiles('student');
    expect(staged).toEqual({
      'data.txt': 'hidden',
      'extra.csv': 'x,1',
    });
  });

  it('stageFiles: instructor view includes !/^ spaces with EVERYWHERE precedence', () => {
    vfs.write('!helper.py', 'def check(): pass');
    vfs.write('?data.txt', 'hidden');
    vfs.write('&data.txt', 'amp'); // & outranks ? for instructors
    const staged = vfs.stageFiles('instructor');
    expect(staged['helper.py']).toBe('def check(): pass');
    expect(staged['data.txt']).toBe('amp');
  });

  it('remote/uploaded files are consulted last for every role', () => {
    vfs.setRemoteFiles({ 'data.txt': 'https://example.com/data.txt' });
    expect(vfs.searchForFile('data.txt', 'student')).toEqual({
      kind: 'remote',
      basename: 'data.txt',
      url: 'https://example.com/data.txt',
    });
    vfs.write('?data.txt', 'hidden');
    expect(vfs.searchForFile('data.txt', 'student')?.kind).toBe('file');
  });

  it('stageFiles: fetched remote contents stage at the LOWEST priority', () => {
    vfs.setRemoteFiles({
      'capitals.txt': '/dl?filename=capitals.txt',
      'data.txt': '/dl?filename=data.txt',
    });
    vfs.setRemoteContents('capitals.txt', 'France,Paris');
    vfs.setRemoteContents('data.txt', 'remote');
    vfs.write('data.txt', 'student'); // any local space overrides
    const staged = vfs.stageFiles('student');
    expect(staged['capitals.txt']).toBe('France,Paris');
    expect(staged['data.txt']).toBe('student');
  });

  it('setRemoteFiles drops cached bodies for delisted files', () => {
    vfs.setRemoteFiles({ 'a.txt': '/dl?filename=a.txt' });
    vfs.setRemoteContents('a.txt', 'body');
    expect(vfs.hasRemoteContents('a.txt')).toBe(true);
    vfs.setRemoteFiles({});
    expect(vfs.hasRemoteContents('a.txt')).toBe(false);
    expect(vfs.stageFiles('student')['a.txt']).toBeUndefined();
  });
});

describe('visibility matrix (A1 §2)', () => {
  it("students see plain, '&', and '*' tabs only", () => {
    for (const [name, visible] of [
      ['answer.py', true],
      ['data.txt', true],
      ['&readme.md', true],
      ['*artifact.txt', true],
      ['!on_run.py', false],
      ['?mock_urls.blockpy', false],
      ['^starting_code.py', false],
      ['$settings.blockpy', false],
      ['#extra_student_files.blockpy', false],
    ] as const) {
      expect(visibleInUi(name, 'student'), name).toBe(visible);
    }
  });

  it("instructors additionally see '!', '?', '^' but never '$'/'#'", () => {
    expect(visibleInUi('!on_run.py', 'instructor')).toBe(true);
    expect(visibleInUi('?toolbox.blockpy', 'instructor')).toBe(true);
    expect(visibleInUi('^starting_code.py', 'instructor')).toBe(true);
    expect(visibleInUi('$settings.blockpy', 'instructor')).toBe(false);
    expect(visibleInUi('#extra_student_files.blockpy', 'instructor')).toBe(false);
  });
});

describe('mutability (D3-A, ledger LD-3)', () => {
  it("'&' files are read-only for students in EVERY editor context", () => {
    // Legacy enforced this in only 4 of 6 editors; Studio enforces uniformly.
    expect(editableBy('&data.py', 'student')).toBe(false);
    expect(editableBy('&notes.md', 'student')).toBe(false);
    expect(editableBy('&data.py', 'instructor')).toBe(true);
  });
  it('students edit only their own space', () => {
    expect(editableBy('answer.py', 'student')).toBe(true);
    expect(editableBy('data.txt', 'student')).toBe(true);
    expect(editableBy('!on_run.py', 'student')).toBe(false);
    expect(editableBy('?data.csv', 'student')).toBe(false);
  });
});

describe('deletion guards', () => {
  it('refuses to delete protected magic names', () => {
    vfs.write('answer.py', 'code');
    vfs.write('!assignment_settings.blockpy', '{}');
    expect(vfs.delete('answer.py')).toBe(false);
    expect(vfs.delete('!assignment_settings.blockpy')).toBe(false);
    expect(vfs.has('answer.py')).toBe(true);
  });
  it('allows deleting on_change/on_eval and generic extras', () => {
    vfs.write('!on_change.py', 'x');
    vfs.write('data.txt', 'y');
    expect(vfs.delete('!on_change.py')).toBe(true);
    expect(vfs.delete('data.txt')).toBe(true);
  });
});

describe('reset-to-start (blockpy.js:1045-1054)', () => {
  it('copies ^starting_code.py over answer.py and strips prefixes on extras', () => {
    vfs.write('^starting_code.py', 'start');
    vfs.write('^helper.py', 'helper-start');
    vfs.write('answer.py', 'student work');
    vfs.write('helper.py', 'student helper');
    vfs.resetToStart();
    expect(vfs.read('answer.py')).toBe('start');
    expect(vfs.read('helper.py')).toBe('helper-start');
  });
});

describe('wire bundles (files.js:283-299, server.js:131-133)', () => {
  it('encodes each space into its bundle, excluding individually-saved names', () => {
    vfs.write('answer.py', 'code'); // individual saveFile — not bundled
    vfs.write('data.txt', 'student extra');
    vfs.write('*plot.txt', 'artifact');
    vfs.write('!hidden_helper.py', 'inst extra');
    vfs.write('?dataset.csv', 'hidden');
    vfs.write('&readme.md', 'readonly');
    vfs.write('!on_run.py', 'grader'); // individual saveFile — not bundled
    vfs.write('^extra_start.py', 'start extra');

    expect(JSON.parse(vfs.encodeBundle('#extra_student_files.blockpy'))).toEqual({
      'data.txt': 'student extra',
      '*plot.txt': 'artifact',
    });
    expect(JSON.parse(vfs.encodeBundle('#extra_instructor_files.blockpy'))).toEqual({
      '!hidden_helper.py': 'inst extra',
      '?dataset.csv': 'hidden',
      '&readme.md': 'readonly',
    });
    expect(JSON.parse(vfs.encodeBundle('#extra_starting_files.blockpy'))).toEqual({
      '^extra_start.py': 'start extra',
    });
  });

  it('round-trips a bundle payload', () => {
    vfs.write('?a.csv', 'A');
    vfs.write('&b.md', 'B');
    const wire = vfs.encodeBundle('#extra_instructor_files.blockpy');
    const fresh = new Vfs();
    fresh.loadBundle(wire);
    expect(fresh.read('?a.csv')).toBe('A');
    expect(fresh.read('&b.md')).toBe('B');
  });
});

describe('dirty tracking & change events', () => {
  it('tracks dirty legacy names and supports markClean', () => {
    vfs.write('answer.py', 'v1');
    expect(vfs.isDirty('answer.py')).toBe(true);
    vfs.markClean('answer.py');
    expect(vfs.isDirty('answer.py')).toBe(false);
    vfs.write('answer.py', 'v1'); // identical write — no dirty, no event
    expect(vfs.isDirty('answer.py')).toBe(false);
  });

  it('emits change events with legacy names; unsubscribe works', () => {
    const seen: string[] = [];
    const off = vfs.onChange((c) => seen.push(`${c.type}:${c.legacyName}`));
    vfs.write('!on_change.py', 'x');
    vfs.delete('!on_change.py');
    off();
    vfs.write('data.txt', 'y');
    expect(seen).toEqual(['write:!on_change.py', 'delete:!on_change.py']);
  });
});
