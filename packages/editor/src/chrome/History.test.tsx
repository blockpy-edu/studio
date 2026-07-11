// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  editEvents,
  filterHistory,
  HistoryToolbar,
  prettyPrintDateTime,
  type HistoryEntry,
} from './History';
import { CodingEditor } from './CodingEditor';
import { useEditorChromeStore } from './store';

const NOW = new Date(2026, 6, 10, 12, 0, 0);

function ts(date: Date): string {
  return String(date.getTime());
}

const LOG: HistoryEntry[] = [
  { event_type: 'Session.Start', file_path: '', message: '' },
  {
    event_type: 'File.Create',
    file_path: 'answer.py',
    message: 'a = 0',
  },
  { event_type: 'Compile', file_path: 'answer.py', message: '' },
  {
    event_type: 'File.Edit',
    file_path: 'answer.py',
    message: 'a = 1',
  },
  { event_type: 'Intervention', file_path: 'answer.py', message: '' },
  {
    event_type: 'File.Edit',
    file_path: '_instructor.on_run.py',
    message: 'hidden',
  },
  { event_type: 'X-Submission.LMS', file_path: 'answer.py', message: '' },
  {
    event_type: 'File.Edit',
    file_path: 'answer.py',
    message: 'a = 2',
  },
];

describe('prettyPrintDateTime (history.js port)', () => {
  it('renders today / same-year / other-year forms', () => {
    const today = new Date(2026, 6, 10, 9, 30, 5);
    expect(prettyPrintDateTime(ts(today), NOW)).toBe(
      'Today at ' + today.toLocaleTimeString(),
    );
    const sameYear = new Date(2026, 2, 4, 9, 30, 5);
    expect(prettyPrintDateTime(ts(sameYear), NOW)).toBe(
      'Wed, Mar 4 at ' + sameYear.toLocaleTimeString(),
    );
    const otherYear = new Date(2025, 11, 25, 9, 30, 5);
    expect(prettyPrintDateTime(ts(otherYear), NOW)).toBe(
      'Thu, Dec 25, 2025 at ' + otherYear.toLocaleTimeString(),
    );
    expect(prettyPrintDateTime(undefined, NOW)).toBe('Undefined Time');
  });
});

describe('history filtering (history.js load())', () => {
  it('drops _instructor./Compile/Intervention rows; LMS rows only when hidden', () => {
    const visible = filterHistory(LOG);
    expect(visible.map((e) => e.event_type)).toEqual([
      'Session.Start',
      'File.Create',
      'File.Edit',
      'X-Submission.LMS',
      'File.Edit',
    ]);
    expect(
      filterHistory(LOG, true).map((e) => e.event_type),
    ).not.toContain('X-Submission.LMS');
  });

  it('edit events are File.Edit/File.Create rows for the current file', () => {
    expect(editEvents(LOG, 'answer.py').map((e) => e.message)).toEqual([
      'a = 0',
      'a = 1',
      'a = 2',
    ]);
    expect(editEvents(LOG, 'other.py')).toEqual([]);
  });
});

describe('HistoryToolbar', () => {
  it('renders legacy controls; navigation clamps; Use fires', () => {
    const selections: number[] = [];
    let used = 0;
    const { container, rerender } = render(
      <HistoryToolbar
        entries={LOG}
        filename="answer.py"
        index={2}
        onSelect={(i) => selections.push(i)}
        onUse={() => used++}
      />,
    );
    expect(container.querySelector('.blockpy-history-toolbar')).not.toBeNull();
    const options = container.querySelectorAll('option');
    expect(options).toHaveLength(5);
    // Only File.Edit options are enabled (File.Create is disabled — legacy
    // quirk: it is navigable via the buttons but not the dropdown).
    expect(
      Array.from(options).map((option) => option.disabled),
    ).toEqual([true, true, false, true, false]);
    fireEvent.click(screen.getByRole('button', { name: /Next/ })); // clamps at last
    expect(selections.at(-1)).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    expect(selections.at(-1)).toBe(0);
    rerender(
      <HistoryToolbar
        entries={LOG}
        filename="answer.py"
        index={0}
        onSelect={(i) => selections.push(i)}
        onUse={() => used++}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Previous/ })); // clamps at 0
    expect(selections.at(-1)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Most Recent/ }));
    expect(selections.at(-1)).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Use/ }));
    expect(used).toBe(1);
  });
});

describe('CodingEditor history mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    useEditorChromeStore.getState().setHistoryMode(false);
  });

  it('History button is disabled without loadHistory (isHistoryAvailable)', () => {
    render(<CodingEditor startingCode="a = 0" />);
    const button = screen.getByRole('button', { name: /History/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('toggle loads the log, shows the merge diff, Use adopts the version', async () => {
    const { container } = render(
      <CodingEditor
        startingCode="a = 9"
        loadHistory={() => Promise.resolve(LOG)}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /History/ }).click();
    });
    // History toolbar + merge view replace the dual editor; most recent
    // edit selected by default.
    expect(container.querySelector('.blockpy-history-toolbar')).not.toBeNull();
    await waitFor(() => {
      expect(container.querySelector('.cm-mergeView')).not.toBeNull();
    });
    expect(container.querySelector('.blockpy-python-blockmirror')).toBeNull();
    expect(useEditorChromeStore.getState().historyMode).toBe(true);
    const select = container.querySelector(
      '.blockpy-history-selector',
    ) as HTMLSelectElement;
    expect(select.value).toBe('2'); // a = 2, the most recent edit
    // Use → exits history mode, editor returns with the old version.
    await act(async () => {
      screen.getByRole('button', { name: /Use/ }).click();
    });
    expect(useEditorChromeStore.getState().historyMode).toBe(false);
    expect(container.querySelector('.cm-mergeView')).toBeNull();
    expect(container.querySelector('.blockpy-python-blockmirror')).not.toBeNull();
    expect(container.textContent).toContain('a = 2');
  });

  it('failed load shows the legacy error dialog', async () => {
    const { container } = render(
      <CodingEditor
        startingCode="a = 0"
        loadHistory={() => Promise.reject(new Error('nope'))}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /History/ }).click();
    });
    expect(container.textContent).toContain('Error Loading History');
    expect(useEditorChromeStore.getState().historyMode).toBe(false);
  });
});
