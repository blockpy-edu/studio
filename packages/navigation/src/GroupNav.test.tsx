// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { GroupNav } from './GroupNav';
import { GroupNavStore, type GroupNavBootData } from './store';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
});

const BOOT: GroupNavBootData = {
  assignments: [
    { id: 101, name: 'Hello World', url: '/a/101', subordinate: false, hidden: false, correct: false },
    { id: 102, name: 'Quiz: Vars', url: '/a/102', subordinate: true, hidden: false, correct: false },
    { id: 103, name: 'Reading', url: '/a/103', subordinate: false, hidden: false, correct: true },
    { id: 104, name: 'Finale', url: '/a/104', subordinate: false, hidden: false, correct: false },
  ],
  anySecretive: false,
  currentAssignmentId: 101,
};

function mountDual(boot: Partial<GroupNavBootData> = {}, options = {}) {
  const store = new GroupNavStore({ ...BOOT, ...boot }, options);
  const view = render(
    <>
      <GroupNav store={store} />
      <GroupNav store={store} />
    </>,
  );
  return { store, view };
}

describe('GroupNav (assignment_group_header macro, §9.1/§9.6)', () => {
  it('renders the legacy structure and CSS hooks, subordinates filtered', () => {
    const { view } = mountDual();
    const header = view.container.querySelector('.assignment-selector-div');
    expect(header).not.toBeNull();
    const select = header!.querySelector('select.assignment-selector')!;
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((option) => option.textContent)).toEqual([
      'Hello World',
      '✔ Reading',
      'Finale',
    ]);
    expect(options.map((option) => option.className)).toEqual([
      'incorrect-submission',
      'correct-submission',
      'incorrect-submission',
    ]);
    expect(header!.querySelector('.completion-rate')!.textContent).toBe('1');
    expect(header!.querySelector('.completion-box')!.textContent).toBe('(1/3 completed)');
    for (const hook of [
      '.assignment-selector-first',
      '.assignment-selector-back',
      '.assignment-selector-next',
      '.assignment-selector-last',
      '.assignment-selector-clock',
      '.assignment-selector-countdown',
    ]) {
      expect(header!.querySelector(hook)).not.toBeNull();
    }
  });

  it('disables First/Back at the start and Next/Last at the end (updateUI)', () => {
    const { store, view } = mountDual({}, { loadAssignment: () => undefined });
    const header = view.container.querySelector('.assignment-selector-div')!;
    const button = (hook: string) => header.querySelector<HTMLButtonElement>(hook)!;
    expect(button('.assignment-selector-first').disabled).toBe(true);
    expect(button('.assignment-selector-back').disabled).toBe(true);
    expect(button('.assignment-selector-next').disabled).toBe(false);
    act(() => store.navigateTo(104));
    expect(button('.assignment-selector-next').disabled).toBe(true);
    expect(button('.assignment-selector-last').disabled).toBe(true);
    expect(button('.assignment-selector-first').disabled).toBe(false);
  });

  it('markCorrect updates BOTH header instances: ✔, count, green Next', () => {
    const { store, view } = mountDual();
    act(() => store.markCorrect(101));
    const headers = view.container.querySelectorAll('.assignment-selector-div');
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header.querySelector('option[value="101"]')!.textContent).toBe('✔ Hello World');
      expect(header.querySelector('option[value="101"]')!.className).toBe('correct-submission');
      expect(header.querySelector('.completion-rate')!.textContent).toBe('2');
      const next = header.querySelector('.assignment-selector-next')!;
      expect(next.className).toContain('btn-success');
      expect(next.className).not.toContain('btn-outline-secondary');
    }
  });

  it('secretive groups: ?? numerator, secret-submission classes, no ✔ ever', () => {
    const { store, view } = mountDual({ anySecretive: true });
    const header = view.container.querySelector('.assignment-selector-div')!;
    expect(header.querySelector('.completion-rate')!.textContent).toBe('??');
    act(() => store.markCorrect(101));
    expect(header.querySelector('.completion-rate')!.textContent).toBe('??');
    for (const option of header.querySelectorAll('option')) {
      expect(option.className).toBe('secret-submission');
      expect(option.textContent).not.toContain('✔');
    }
    expect(header.querySelector('.assignment-selector-next')!.className).toContain(
      'btn-outline-secondary',
    );
  });

  it('completion-box click toggles list-box expansion: size=min(5,N) vs 1', () => {
    const { view } = mountDual();
    const header = view.container.querySelector('.assignment-selector-div')!;
    const select = header.querySelector<HTMLSelectElement>('.assignment-selector')!;
    expect(select.size).toBe(1);
    fireEvent.click(header.querySelector('.completion-box')!);
    expect(select.size).toBe(3); // min(5, 3 non-subordinate entries)
    // The OTHER instance expands too (shared store).
    const bottom = view.container.querySelectorAll<HTMLSelectElement>('.assignment-selector')[1]!;
    expect(bottom.size).toBe(3);
    expect(localStorage.getItem('blockpy_assignmentSelectorExpanded')).toBe('true');
  });

  it('selecting an assignment dispatches through the store', () => {
    const loads: number[] = [];
    const { view } = mountDual({}, { loadAssignment: (id: number) => void loads.push(id) });
    const select = view.container.querySelector<HTMLSelectElement>('.assignment-selector')!;
    fireEvent.change(select, { target: { value: '103' } });
    expect(loads).toEqual([103]);
    // Both selects now show the new current assignment.
    for (const instance of view.container.querySelectorAll<HTMLSelectElement>(
      '.assignment-selector',
    )) {
      expect(instance.value).toBe('103');
    }
  });

  it('buttons drive first/back/next/last', () => {
    const loads: number[] = [];
    const { view } = mountDual(
      { currentAssignmentId: 103 },
      { loadAssignment: (id: number) => void loads.push(id) },
    );
    const header = view.container.querySelector('.assignment-selector-div')!;
    fireEvent.click(header.querySelector('.assignment-selector-next')!);
    fireEvent.click(header.querySelector('.assignment-selector-first')!);
    fireEvent.click(header.querySelector('.assignment-selector-last')!);
    expect(loads).toEqual([104, 101, 104]);
  });

  it('clock span shows the tier text and hides while a countdown is active', () => {
    vi.useFakeTimers();
    try {
      const { store, view } = mountDual({}, { sessionStartTime: Date.now() });
      const header = view.container.querySelector('.assignment-selector-div')!;
      const clock = header.querySelector<HTMLElement>('.assignment-selector-clock')!;
      expect(clock.textContent).toBe('(Just started)');
      expect(clock.title).toBe(
        'Estimate time spent (click to get total time spent across all sessions)',
      );
      act(() => {
        store.setTimeLimit({
          timeLimit: '10min',
          studentTimeLimit: null,
          dateStarted: new Date(Date.now() - 60_000).toISOString(),
        });
        store.handleTimeCheck();
      });
      expect(clock.style.display).toBe('none');
      expect(header.querySelector('.assignment-selector-countdown')!.textContent).toBe(
        '1 minute elapsed; 9 minutes left',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
