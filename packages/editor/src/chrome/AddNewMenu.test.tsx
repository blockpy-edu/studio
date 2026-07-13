// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Vfs } from '@blockpy/vfs';
import { AddNewMenu } from './AddNewMenu';
import { FileTabs } from './FileTabs';

function openMenu(container: HTMLElement) {
  fireEvent.click(screen.getByRole('button', { name: 'Add New' }));
  return container.querySelector('.dropdown-menu.show')!;
}

describe('AddNewMenu (files.js FILES_HTML + ui.files.add)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('instructor menu lists creatable files; existing ones hidden', () => {
    const vfs = new Vfs();
    vfs.write('?mock_urls.blockpy', '{"x": 1}'); // already has contents
    const added: string[] = [];
    const { container } = render(
      <ul>
        <AddNewMenu vfs={vfs} instructor onAdd={(name) => added.push(name)} />
      </ul>,
    );
    const menu = openMenu(container);
    const labels = Array.from(menu.querySelectorAll('.dropdown-item')).map(
      (item) => item.textContent,
    );
    expect(labels).not.toContain('URL Data'); // hidden: has contents
    expect(labels).toEqual([
      'Images',
      'Toolbox',
      'Tags',
      'Sample Submissions',
      'On Change',
      'On Eval',
      'Answer Prefix',
      'Answer Suffix',
      'Starting File',
      'Instructor File',
      'Student File',
    ]);
  });

  it('creates files with legacy default contents and opens them', () => {
    const vfs = new Vfs();
    const added: string[] = [];
    const { container } = render(
      <ul>
        <AddNewMenu vfs={vfs} instructor onAdd={(name) => added.push(name)} />
      </ul>,
    );
    fireEvent.click(
      Array.from(openMenu(container).querySelectorAll('a')).find(
        (a) => a.textContent === 'Images',
      )!,
    );
    expect(vfs.read('images.blockpy')).toBe('{}');
    fireEvent.click(
      Array.from(openMenu(container).querySelectorAll('a')).find(
        (a) => a.textContent === 'Toolbox',
      )!,
    );
    expect(JSON.parse(vfs.read('?toolbox.blockpy')!)).toBeTruthy();
    fireEvent.click(
      Array.from(openMenu(container).querySelectorAll('a')).find(
        (a) => a.textContent === 'On Change',
      )!,
    );
    expect(vfs.read('!on_change.py')).toBe('');
    expect(added).toEqual(['images.blockpy', '?toolbox.blockpy', '!on_change.py']);
    // Tags stays dead (legacy has no click binding): clicking is a no-op.
    fireEvent.click(
      Array.from(openMenu(container).querySelectorAll('a')).find((a) => a.textContent === 'Tags')!,
    );
    expect(vfs.read('!tags.blockpy')).toBeUndefined();
  });

  it('new-file dialog applies the namespace/starting prefixes', () => {
    const vfs = new Vfs();
    const added: string[] = [];
    const { container } = render(
      <ul>
        <AddNewMenu vfs={vfs} instructor onAdd={(name) => added.push(name)} />
      </ul>,
    );
    // Instructor file with the & namespace.
    fireEvent.click(
      Array.from(openMenu(container).querySelectorAll('a')).find(
        (a) => a.textContent === 'Instructor File',
      )!,
    );
    const dialog = container.querySelector('.blockpy-dialog')!;
    fireEvent.change(dialog.querySelector('.blockpy-instructor-file-dialog-filename')!, {
      target: { value: 'data.csv' },
    });
    // Filetype display derives from the extension.
    expect(dialog.querySelector('.blockpy-instructor-file-dialog-filetype')!.textContent).toBe(
      'csv',
    );
    fireEvent.change(dialog.querySelector('.blockpy-instructor-file-dialog-namespace')!, {
      target: { value: '&' },
    });
    fireEvent.click(dialog.querySelector('.modal-okay')!);
    expect(vfs.read('&data.csv')).toBe('');
    expect(added).toEqual(['&data.csv']);
  });

  it('students only get "Student File" (no prefix)', () => {
    const vfs = new Vfs();
    const added: string[] = [];
    const { container } = render(
      <ul>
        <AddNewMenu vfs={vfs} instructor={false} onAdd={(name) => added.push(name)} />
      </ul>,
    );
    const menu = openMenu(container);
    expect(
      Array.from(menu.querySelectorAll('.dropdown-item')).map((item) => item.textContent),
    ).toEqual(['Student File']);
    fireEvent.click(menu.querySelector('a')!);
    const dialog = container.querySelector('.blockpy-dialog')!;
    fireEvent.change(dialog.querySelector('.blockpy-instructor-file-dialog-filename')!, {
      target: { value: 'notes.txt' },
    });
    fireEvent.click(dialog.querySelector('.modal-okay')!);
    expect(vfs.read('notes.txt')).toBe('');
    expect(added).toEqual(['notes.txt']);
  });
});

describe('FileTabs Add New visibility (addIsVisible)', () => {
  it('renders the dropdown only when addVisible', () => {
    const vfs = new Vfs();
    vfs.write('answer.py', 'a = 0');
    const { container, rerender } = render(
      <FileTabs vfs={vfs} role="student" activeFile="answer.py" onSelect={() => {}} />,
    );
    expect(container.querySelector('.nav-item.dropdown')).toBeNull();
    rerender(
      <FileTabs
        vfs={vfs}
        role="instructor"
        activeFile="answer.py"
        onSelect={() => {}}
        addVisible
        instructor
      />,
    );
    expect(container.querySelector('.nav-item.dropdown')).not.toBeNull();
  });
});
