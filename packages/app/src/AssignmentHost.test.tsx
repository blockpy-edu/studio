// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { AssignmentHost, classifyAssignment } from './AssignmentHost';
import type { AssignmentTypeIndex } from './boot-config';

afterEach(cleanup);

const TYPE_INDEX: AssignmentTypeIndex = {
  quiz: [102],
  reading: [103],
  textbook: [104],
  java: [105],
  typescript: [106],
  explain: [107],
  blockpy: [101],
};

describe('classifyAssignment (editor.html:305-320 priority order)', () => {
  it('classifies by membership', () => {
    expect(classifyAssignment(102, TYPE_INDEX)).toBe('quiz');
    expect(classifyAssignment(103, TYPE_INDEX)).toBe('reading');
    expect(classifyAssignment(105, TYPE_INDEX)).toBe('java');
    expect(classifyAssignment(106, TYPE_INDEX)).toBe('typescript');
    expect(classifyAssignment(101, TYPE_INDEX)).toBe('blockpy');
  });

  it('quiz outranks every other membership; unknown falls through to blockpy', () => {
    const overlapping: AssignmentTypeIndex = {
      ...TYPE_INDEX,
      quiz: [1],
      reading: [1],
      blockpy: [1],
    };
    expect(classifyAssignment(1, overlapping)).toBe('quiz');
    expect(classifyAssignment(999, TYPE_INDEX)).toBe('blockpy');
  });
});

function mountHost(loadEditorAssignment = vi.fn(() => Promise.resolve())) {
  let dispatch: ((id: number) => Promise<void>) | null = null;
  const view = render(
    <AssignmentHost
      typeIndex={TYPE_INDEX}
      loadEditorAssignment={loadEditorAssignment}
      onReady={(fn) => {
        dispatch = fn;
      }}
    >
      <div data-testid="editor">EDITOR</div>
    </AssignmentHost>,
  );
  return { view, loadEditorAssignment, dispatch: (id: number) => dispatch!(id) };
}

describe('AssignmentHost dispatch (loadAssignmentWrapper port)', () => {
  it('non-blockpy types hide (not unmount) the editor and mount the component', async () => {
    const { view, dispatch, loadEditorAssignment } = mountHost();
    await act(() => dispatch(102));
    const editorWrap = view.container.querySelector('.blockpy-host-editor') as HTMLElement;
    expect(editorWrap.style.display).toBe('none');
    expect(screen.getByTestId('editor')).toBeDefined(); // still mounted
    expect(view.container.querySelector('.blockpy-host-quiz')?.textContent).toContain(
      'quiz assignment 102',
    );
    expect(loadEditorAssignment).not.toHaveBeenCalled();
  });

  it('switching types swaps components (per-type id reset = remount)', async () => {
    const { view, dispatch } = mountHost();
    await act(() => dispatch(102));
    await act(() => dispatch(103));
    expect(view.container.querySelector('.blockpy-host-quiz')).toBeNull();
    expect(view.container.querySelector('.blockpy-host-reading')?.textContent).toContain(
      'reading assignment 103',
    );
  });

  it('java renders the tombstone verbatim (editor.html:159)', async () => {
    const { view, dispatch } = mountHost();
    await act(() => dispatch(105));
    expect(view.container.querySelector('.blockpy-host-java')?.textContent).toBe(
      'Java assignments are no longer supported in BlockPy.',
    );
  });

  it('blockpy and unknown ids show the editor and delegate the load', async () => {
    const { view, dispatch, loadEditorAssignment } = mountHost();
    await act(() => dispatch(102)); // hide first
    await act(() => dispatch(101));
    const editorWrap = view.container.querySelector('.blockpy-host-editor') as HTMLElement;
    expect(editorWrap.style.display).not.toBe('none');
    expect(loadEditorAssignment).toHaveBeenCalledWith(101);
    expect(view.container.querySelector('.blockpy-host-quiz')).toBeNull();
    await act(() => dispatch(999)); // unknown → editor fallback
    expect(loadEditorAssignment).toHaveBeenCalledWith(999);
  });

  it('updates assignment_id in the URL preserving other params (§5.3)', async () => {
    history.replaceState(null, '', '/?assignment_id=101&assignment_group_id=11&embed=false');
    const { dispatch } = mountHost();
    await act(() => dispatch(102));
    const params = new URLSearchParams(location.search);
    expect(params.get('assignment_id')).toBe('102');
    expect(params.get('assignment_group_id')).toBe('11'); // preserved
  });

  it('publishes altAssignmentChangingFunction and cleans it up (§15.3)', async () => {
    const { view } = mountHost();
    const globals = window as unknown as Record<string, unknown>;
    expect(typeof globals['altAssignmentChangingFunction']).toBe('function');
    await act(() =>
      (globals['altAssignmentChangingFunction'] as (id: number) => Promise<void>)(102),
    );
    expect(view.container.querySelector('.blockpy-host-quiz')).not.toBeNull();
    view.unmount();
    expect(globals['altAssignmentChangingFunction']).toBeUndefined();
  });
});
