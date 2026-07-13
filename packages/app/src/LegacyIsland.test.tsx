// @vitest-environment jsdom
/**
 * Kettle/Explain legacy island (§17/M2.5): ko binding with the
 * editor.html:242-257 model slice, the $MAIN_BLOCKPY_EDITOR bridge graft,
 * the degradation notice, and the server-bridge post semantics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LegacyIsland, createLegacyServerBridge, ensureEditorBridge } from './LegacyIsland';

afterEach(cleanup);

const makeKo = () => {
  const bindings: Array<{ model: Record<string, unknown>; node: HTMLElement }> = [];
  const cleaned: Node[] = [];
  const ko = {
    observable: (value: unknown) => {
      let current = value;
      const accessor = (next?: unknown) => {
        if (next !== undefined) current = next;
        return current;
      };
      return accessor;
    },
    applyBindings: (model: Record<string, unknown>, node: HTMLElement) =>
      bindings.push({ model, node }),
    cleanNode: (node: Node) => cleaned.push(node),
    components: { isRegistered: (name: string) => name === 'kettle' },
  };
  return { ko, bindings, cleaned };
};

class FakeServer {
  constructor(
    public courseId: number | null,
    public ids: unknown,
    public data: unknown,
  ) {}
}

describe('LegacyIsland', () => {
  it('binds the legacy custom element with the mainModel slice', () => {
    const { ko, bindings } = makeKo();
    const markCorrect = vi.fn();
    const globals: Record<string, unknown> = { ko, frontend: { Server: FakeServer } };
    render(
      <LegacyIsland
        component="kettle"
        assignmentId={108}
        courseId={1}
        assignmentGroupId={11}
        isInstructor={false}
        markCorrect={markCorrect}
        user={{ id: 1 }}
        globals={globals}
      />,
    );
    expect(bindings).toHaveLength(1);
    const { model, node } = bindings[0]!;
    expect(node.querySelector('kettle')).toBeTruthy();
    expect(node.querySelector('kettle')!.getAttribute('params')).toContain(
      'currentAssignmentId: currentAssignmentId',
    );
    expect(model['server']).toBeInstanceOf(FakeServer);
    expect((model['currentAssignmentId'] as () => unknown)()).toBe(108);
    expect(model['markCorrect']).toBe(markCorrect);
    expect(model['assignmentGroupId']).toBe(11);
  });

  it('cleans the ko node on unmount', () => {
    const { ko, cleaned } = makeKo();
    const globals: Record<string, unknown> = { ko, frontend: { Server: FakeServer } };
    const { unmount } = render(
      <LegacyIsland
        component="kettle"
        assignmentId={108}
        courseId={1}
        assignmentGroupId={null}
        isInstructor={false}
        markCorrect={() => undefined}
        user={{}}
        globals={globals}
      />,
    );
    unmount();
    expect(cleaned).toHaveLength(1);
  });

  it('degrades to a notice when the bundle is absent or unregistered', async () => {
    const { ko } = makeKo(); // registers kettle only
    render(
      <LegacyIsland
        component="explain"
        assignmentId={109}
        courseId={1}
        assignmentGroupId={null}
        isInstructor={false}
        markCorrect={() => undefined}
        user={{}}
        globals={{ ko, frontend: { Server: FakeServer } }}
      />,
    );
    expect(await screen.findByText(/needs the legacy BlockPy frontend bundle/)).toBeTruthy();
  });

  it('grafts the server bridge onto $MAIN_BLOCKPY_EDITOR before binding', () => {
    const { ko } = makeKo();
    const bridge = createLegacyServerBridge({
      buildPayload: () => ({ course_id: 1 }),
      post: async () => ({ success: true }),
    });
    const globals: Record<string, unknown> = {
      ko,
      frontend: { Server: FakeServer },
      $MAIN_BLOCKPY_EDITOR: {},
    };
    render(
      <LegacyIsland
        component="kettle"
        assignmentId={108}
        courseId={1}
        assignmentGroupId={null}
        isInstructor={false}
        markCorrect={() => undefined}
        user={{}}
        serverBridge={bridge}
        passcode={() => 'pass'}
        globals={globals}
      />,
    );
    const owner = globals['$MAIN_BLOCKPY_EDITOR'] as Record<string, Record<string, unknown>>;
    expect(owner['components']!['server']).toBe(bridge);
    expect((owner['model']!['display'] as { passcode: () => string }).passcode()).toBe('pass');
  });

  it('never clobbers a REAL editor surface', () => {
    const realComponents = { server: { real: true } };
    const globals: Record<string, unknown> = {
      $MAIN_BLOCKPY_EDITOR: { components: realComponents },
    };
    const bridge = createLegacyServerBridge({
      buildPayload: () => ({}),
      post: async () => ({}),
    });
    ensureEditorBridge(globals, bridge, () => '');
    const owner = globals['$MAIN_BLOCKPY_EDITOR'] as Record<string, unknown>;
    expect(owner['components']).toBe(realComponents);
    expect(owner['model']).toBeDefined();
  });
});

describe('createLegacyServerBridge', () => {
  it('createServerData returns a fresh base-context copy per call', () => {
    const bridge = createLegacyServerBridge({
      buildPayload: () => ({ course_id: 5, user_id: 2 }),
      post: async () => ({}),
    });
    const first = bridge.createServerData();
    expect(first).toEqual({ course_id: 5, user_id: 2 });
    first['assignment_id'] = 9;
    expect(bridge.createServerData()['assignment_id']).toBeUndefined();
  });

  it('_postBlocking delivers responses and retries failures up to attempts', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const post = vi.fn(async () => {
        calls += 1;
        if (calls < 3) throw new Error('down');
        return { success: true };
      });
      const bridge = createLegacyServerBridge({ buildPayload: () => ({}), post });
      const onSuccess = vi.fn();
      const onFailure = vi.fn();
      bridge._postBlocking('loadAssignment', { assignment_id: 1 }, 4, onSuccess, onFailure);
      await vi.advanceTimersByTimeAsync(5000);
      expect(post).toHaveBeenCalledTimes(3);
      expect(onSuccess).toHaveBeenCalledWith({ success: true });
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('_postBlocking exhausts attempts into onFailure', async () => {
    vi.useFakeTimers();
    try {
      const post = vi.fn(async () => {
        throw new Error('down');
      });
      const bridge = createLegacyServerBridge({ buildPayload: () => ({}), post });
      const onFailure = vi.fn();
      bridge._postBlocking('updateSubmission', {}, 2, undefined, onFailure);
      await vi.advanceTimersByTimeAsync(5000);
      expect(post).toHaveBeenCalledTimes(2);
      expect(onFailure).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('_postRetry posts once and swallows failures (fire-and-forget log path)', async () => {
    const post = vi.fn(async () => {
      throw new Error('down');
    });
    const bridge = createLegacyServerBridge({ buildPayload: () => ({}), post });
    const callback = vi.fn();
    bridge._postRetry({ event_type: 'Compile' }, 'logEvent', 0, callback);
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
  });
});
