// @vitest-environment jsdom
/**
 * M3.7: the filesystem tree rail — namespace buckets, role visibility,
 * instructor prefixes, and the LD-21 action gating (magic names immovable).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Vfs } from '@blockpy/vfs';
import { FileTree } from './FileTree';

afterEach(cleanup);

function seededVfs(): Vfs {
  const vfs = new Vfs();
  vfs.write('answer.py', 'x = 1');
  vfs.write('notes.txt', 'student notes');
  vfs.write('&data.csv', 'a,b\n1,2');
  vfs.write('!on_run.py', 'from pedal import *');
  vfs.write('?secret.txt', 'hidden');
  return vfs;
}

describe('FileTree (M3.7)', () => {
  it('buckets by namespace with role visibility', () => {
    const { container } = render(
      <FileTree
        vfs={seededVfs()}
        role="student"
        activeFile="answer.py"
        onSelect={() => undefined}
      />,
    );
    const headers = [...container.querySelectorAll('.blockpy-file-tree-header')].map(
      (el) => el.textContent,
    );
    // Students see student + readonly buckets only (permissions matrix).
    expect(headers).toEqual(['Student Files', 'Read-Only Files']);
    const names = [...container.querySelectorAll('.blockpy-file-tree-name')].map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['answer.py', 'notes.txt', 'data.csv']);
  });

  it('instructor view shows prefixes and full legacy names', () => {
    const { container } = render(
      <FileTree
        vfs={seededVfs()}
        role="instructor"
        instructor
        activeFile="answer.py"
        onSelect={() => undefined}
      />,
    );
    const prefixes = [...container.querySelectorAll('.blockpy-file-tree-prefix')].map(
      (el) => el.textContent,
    );
    expect(prefixes).toEqual(['!', '?', '&']);
    const names = [...container.querySelectorAll('.blockpy-file-tree-name')].map(
      (el) => el.textContent,
    );
    expect(names).toContain('!on_run.py');
    expect(names).toContain('?secret.txt');
  });

  it('selects on row click and gates LD-21 actions by capability', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const onRename = vi.fn();
    const { container } = render(
      <FileTree
        vfs={seededVfs()}
        role="instructor"
        instructor
        activeFile="answer.py"
        onSelect={onSelect}
        onDelete={onDelete}
        onRename={onRename}
        onMove={() => undefined}
      />,
    );
    const rows = [...container.querySelectorAll('.blockpy-file-tree-row')];
    const answerRow = rows.find(
      (row) => row.querySelector('.blockpy-file-tree-name')?.textContent === 'answer.py',
    )!;
    const notesRow = rows.find(
      (row) => row.querySelector('.blockpy-file-tree-name')?.textContent === 'notes.txt',
    )!;
    // answer.py is magic: no rename/delete buttons at all.
    expect(answerRow.querySelectorAll('.blockpy-file-tree-action').length).toBe(0);
    // A plain file gets rename + move + delete.
    expect(notesRow.querySelectorAll('.blockpy-file-tree-action').length).toBe(3);
    fireEvent.click(notesRow);
    expect(onSelect).toHaveBeenCalledWith('notes.txt');
    // Action clicks do NOT select the row (stopPropagation).
    onSelect.mockClear();
    fireEvent.click(notesRow.querySelector('.blockpy-file-tree-delete')!);
    expect(onDelete).toHaveBeenCalledWith('notes.txt');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('re-renders live on VFS changes', () => {
    const vfs = seededVfs();
    const { container } = render(
      <FileTree vfs={vfs} role="student" activeFile="answer.py" onSelect={() => undefined} />,
    );
    expect(container.textContent).not.toContain('fresh.txt');
    act(() => vfs.write('fresh.txt', 'new'));
    expect(container.textContent).toContain('fresh.txt');
  });
});
