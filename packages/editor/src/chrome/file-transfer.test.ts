/**
 * Local upload/download helpers (M7.4, LD-39) — conformance against the
 * legacy sources: convertIpynbToPython (python.js:161-181), sluggify
 * (abstract_editor.js:14-16), download naming (abstract_editor.js:18-22 +
 * python.js:466-471).
 */
import { describe, expect, it } from 'vitest';
import { convertIpynbToPython, downloadPlan, sluggify, splitFilename } from './file-transfer';

const ipynb = (cells: unknown[]) => JSON.stringify({ cells });

describe('convertIpynbToPython (python.js:161-181)', () => {
  it('joins code cells, wraps markdown/raw in triple-quotes', () => {
    const doc = ipynb([
      { cell_type: 'markdown', source: ['# Title', 'Intro'] },
      { cell_type: 'code', source: ['x = 1', 'print(x)'] },
      { cell_type: 'raw', source: ['raw text'] },
    ]);
    expect(convertIpynbToPython(doc)).toBe("'''# Title\nIntro'''\nx = 1\nprint(x)\n'''raw text'''");
  });

  it('drops empty code cells and %-magic cells (legacy isUsable)', () => {
    const doc = ipynb([
      { cell_type: 'code', source: [] },
      { cell_type: 'code', source: ['%matplotlib inline', 'x = 1'] },
      { cell_type: 'code', source: ['y = 2'] },
    ]);
    expect(convertIpynbToPython(doc)).toBe('y = 2');
  });

  it('throws on unparseable JSON (caller falls back to raw text)', () => {
    expect(() => convertIpynbToPython('not json')).toThrow();
  });
});

describe('download naming (abstract_editor.js + python.js:466-471)', () => {
  it('sluggify replaces non-alphanumerics and lowercases', () => {
    expect(sluggify('My File (v2)!')).toBe('my_file__v2__');
  });

  it('splitFilename keeps dotfiles and extension-less names whole', () => {
    expect(splitFilename('answer.py')).toEqual({ name: 'answer', extension: '.py' });
    expect(splitFilename('README')).toEqual({ name: 'README', extension: '' });
    expect(splitFilename('.hidden')).toEqual({ name: '.hidden', extension: '' });
  });

  it('answer.py downloads under the sluggified assignment name', () => {
    expect(downloadPlan('answer.py', 'Maze Game #3')).toEqual({
      downloadName: 'maze_game__3.py',
      mimetype: 'text/x-python',
    });
    // Other files keep their own (sluggified) name; non-.py is text/plain.
    expect(downloadPlan('data.txt', 'Maze Game #3')).toEqual({
      downloadName: 'data.txt',
      mimetype: 'text/plain',
    });
    // Without an assignment name, answer.py stays answer.py.
    expect(downloadPlan('answer.py')).toEqual({
      downloadName: 'answer.py',
      mimetype: 'text/x-python',
    });
  });
});
