// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Vfs } from '@blockpy/vfs';
import { CsvEditor } from './CsvEditor';
import { JsonEditor } from './JsonEditor';
import { CodingEditor } from './CodingEditor';

describe('CsvEditor (M4.4, LD-26)', () => {
  afterEach(cleanup);

  it('renders the grid with a header row; cell edits serialize back', () => {
    const changes: string[] = [];
    const { container } = render(
      <CsvEditor
        value={'name,age\nAda,36'}
        onChange={(next) => changes.push(next)}
        onRawView={() => {}}
      />,
    );
    // Header row renders as <th> inputs, data as <td>.
    const header = container.querySelectorAll('thead input');
    expect([...header].map((i) => (i as HTMLInputElement).value)).toEqual(['name', 'age']);
    const cell = container.querySelector<HTMLInputElement>('tbody input')!;
    expect(cell.value).toBe('Ada');
    fireEvent.change(cell, { target: { value: 'Grace' } });
    expect(changes).toEqual(['name,age\nGrace,36']);
  });

  it('adds/removes rows and columns through the toolbar', () => {
    const changes: string[] = [];
    const { container } = render(
      <CsvEditor value={'a,b\n1,2'} onChange={(next) => changes.push(next)} onRawView={() => {}} />,
    );
    fireEvent.click(container.querySelector('.blockpy-csv-add-row')!);
    expect(changes.at(-1)).toBe('a,b\n1,2\n,');
    fireEvent.click(container.querySelector('.blockpy-csv-add-column')!);
    expect(changes.at(-1)).toBe('a,b,\n1,2,');
    fireEvent.click(container.querySelector('.blockpy-csv-delete-row')!);
    expect(changes.at(-1)).toBe('a,b');
    fireEvent.click(container.querySelector('.blockpy-csv-delete-column')!);
    expect(changes.at(-1)).toBe('a\n1');
  });

  it('read-only disables cells and hides mutation controls (D3-A)', () => {
    const { container } = render(
      <CsvEditor value={'a,b\n1,2'} readOnly onChange={() => {}} onRawView={() => {}} />,
    );
    expect(container.querySelector<HTMLInputElement>('tbody input')!.disabled).toBe(true);
    expect(container.querySelector('.blockpy-csv-add-row')).toBeNull();
    expect(container.querySelector('.blockpy-csv-delete-row')).toBeNull();
    // The raw-text escape stays available for viewing.
    expect(container.querySelector('.blockpy-csv-raw')).not.toBeNull();
  });

  it('header toggle moves row 1 between thead and tbody', () => {
    const { container } = render(
      <CsvEditor value={'x,y\n1,2'} onChange={() => {}} onRawView={() => {}} />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    fireEvent.click(container.querySelector('.blockpy-csv-header-toggle input')!);
    expect(container.querySelector('thead')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});

describe('JsonEditor (M4.4, LD-26)', () => {
  afterEach(cleanup);

  it('shows the CM6 editor with a live validity badge', () => {
    const { container } = render(
      <JsonEditor value={'{"a": 1}'} onChange={() => {}} onRawView={() => {}} />,
    );
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelector('.blockpy-json-status')!.textContent).toBe('Valid JSON');
    expect(container.querySelector('.blockpy-json-status-detail')).toBeNull();
  });

  it('flags invalid JSON and disables the tree view', () => {
    const { container } = render(
      <JsonEditor value={'{"a": '} onChange={() => {}} onRawView={() => {}} />,
    );
    expect(container.querySelector('.blockpy-json-status')!.textContent).toBe('Invalid JSON');
    expect(container.querySelector('.blockpy-json-status-detail')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.blockpy-json-tree-toggle')!.disabled).toBe(
      true,
    );
  });

  it('tree view renders the collapsible structure', () => {
    const { container } = render(
      <JsonEditor
        value={'{"names": ["Ada", "Alan"], "count": 2}'}
        onChange={() => {}}
        onRawView={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('.blockpy-json-tree-toggle')!);
    const tree = container.querySelector('.blockpy-json-tree')!;
    expect(tree.textContent).toContain('names: [2]');
    expect(tree.textContent).toContain('"Ada"');
    expect(tree.textContent).toContain('count: ');
  });
});

describe('CodingEditor extension dispatch (M4.4)', () => {
  afterEach(cleanup);

  it('csv/json tabs open structured editors; raw escape returns to text', async () => {
    const vfs = new Vfs();
    vfs.write('answer.py', 'a = 0');
    vfs.write('data.csv', 'a,b\n1,2');
    vfs.write('config.json', '{"k": true}');
    const { container } = render(
      <CodingEditor startingCode="a = 0" vfs={vfs} instructor hideFiles={false} />,
    );
    const tab = (label: string) =>
      [...container.querySelectorAll('.nav-link')].find((link) => link.textContent === label)!;
    await act(async () => void fireEvent.click(tab('data.csv')));
    expect(container.querySelector('.blockpy-csv-editor')).not.toBeNull();
    // Raw escape → text editor + a way back.
    await act(async () => void fireEvent.click(container.querySelector('.blockpy-csv-raw')!));
    expect(container.querySelector('.blockpy-csv-editor')).toBeNull();
    expect(container.querySelector('.blockpy-structured-return')).not.toBeNull();
    await act(
      async () => void fireEvent.click(container.querySelector('.blockpy-structured-return')!),
    );
    expect(container.querySelector('.blockpy-csv-editor')).not.toBeNull();
    // JSON tab.
    await act(async () => void fireEvent.click(tab('config.json')));
    expect(container.querySelector('.blockpy-json-editor')).not.toBeNull();
    // Grid edits persist into the VFS through the normal write path.
    await act(async () => void fireEvent.click(tab('data.csv')));
    const cell = container.querySelector<HTMLInputElement>('.blockpy-csv-grid tbody input')!;
    await act(async () => void fireEvent.change(cell, { target: { value: '9' } }));
    expect(vfs.read('data.csv')).toBe('a,b\n9,2');
  });

  it('unparseable csv degrades to the plain text editor', async () => {
    const vfs = new Vfs();
    vfs.write('answer.py', 'a = 0');
    vfs.write('broken.csv', 'a,"unclosed\n1,2');
    const { container } = render(
      <CodingEditor startingCode="a = 0" vfs={vfs} instructor hideFiles={false} />,
    );
    const tab = [...container.querySelectorAll('.nav-link')].find(
      (link) => link.textContent === 'broken.csv',
    )!;
    await act(async () => void fireEvent.click(tab));
    expect(container.querySelector('.blockpy-csv-editor')).toBeNull();
    expect(container.querySelector('.blockpy-python-blockmirror')).not.toBeNull();
  });
});
