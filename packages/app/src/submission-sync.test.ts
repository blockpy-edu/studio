import { describe, expect, it, vi } from 'vitest';
import { ApiClient, MemoryStorage, Transport, type ApiContext } from '@blockpy/api';
import { SubmissionSync, type SubmissionSyncOptions } from './submission-sync';

interface Posted {
  url: string;
  body: URLSearchParams;
  keepalive?: boolean;
}

type FetchStub = (
  url: string,
  init: { body?: string | FormData; keepalive?: boolean },
) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

function harness(
  overrides: Partial<SubmissionSyncOptions> = {},
  urls?: Record<string, string>,
  transportOverrides: { fetch?: (inner: FetchStub) => FetchStub; maxRetries?: number } = {},
) {
  const posted: Posted[] = [];
  let respondWith: Record<string, unknown> = { success: true };
  const baseFetch: FetchStub = async (url, init) => {
    posted.push({
      url,
      body: new URLSearchParams(String(init.body)),
      ...(init.keepalive !== undefined ? { keepalive: init.keepalive } : {}),
    });
    return { ok: true, json: async () => respondWith };
  };
  const fetchStub = transportOverrides.fetch ? transportOverrides.fetch(baseFetch) : baseFetch;
  const context: ApiContext = {
    assignmentId: 101,
    assignmentGroupId: 11,
    courseId: 1,
    submissionId: 5001,
    userId: 1,
    submissionVersion: 7,
    assignmentVersion: 3,
    passcode: '',
    partId: '',
  };
  const api = new ApiClient({
    urls: urls ?? {
      saveFile: '/api/save_file',
      updateSubmission: '/api/update_submission',
    },
    context,
    transport: new Transport({
      fetch: fetchStub,
      storage: new MemoryStorage(),
      maxRetries: transportOverrides.maxRetries ?? 0,
      // Real macrotask ordering, no real backoff waits.
      schedule: (fn) => setTimeout(fn, 0),
    }),
  });
  const setStatus = vi.fn();
  const markCorrect = vi.fn();
  // Manual scheduler: collect debounced thunks, fire on demand.
  const scheduled: Array<{ id: number; fn: () => void }> = [];
  let nextId = 1;
  const sync = new SubmissionSync({
    api,
    setStatus,
    readOnly: () => false,
    markCorrect,
    schedule: (fn) => {
      const id = nextId++;
      scheduled.push({ id, fn });
      return id;
    },
    cancel: (timer) => {
      const index = scheduled.findIndex((entry) => entry.id === timer);
      if (index !== -1) scheduled.splice(index, 1);
    },
    ...overrides,
  });
  const flushTimers = async () => {
    while (scheduled.length) {
      scheduled.shift()!.fn();
      // The POST rides Transport's own setTimeout(0) - yield a macrotask.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return {
    sync,
    api,
    context,
    posted,
    scheduled,
    setStatus,
    markCorrect,
    flushTimers,
    setResponse: (r: Record<string, unknown>) => (respondWith = r),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fetch wrapper that holds the FIRST request until `release()` runs. */
function gateFirst(): {
  wrap: (inner: FetchStub) => FetchStub;
  release: () => void;
  started: () => number;
} {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  return {
    wrap: (inner) => async (url, init) => {
      started += 1;
      if (started === 1) await gate;
      return inner(url, init);
    },
    release: () => release(),
    started: () => started,
  };
}

describe('saveFile autosave (server.js:114-134, 637-655)', () => {
  it('debounces per filename, latest edit wins', async () => {
    const { sync, posted, flushTimers } = harness();
    sync.saveFileDebounced('answer.py', 'v1');
    sync.saveFileDebounced('answer.py', 'v2');
    sync.saveFileDebounced('!on_run.py', 'grader');
    await flushTimers();
    expect(posted).toHaveLength(2);
    expect(posted[0]!.body.get('filename')).toBe('answer.py');
    expect(posted[0]!.body.get('code')).toBe('v2'); // v1 was cancelled
    expect(posted[1]!.body.get('filename')).toBe('!on_run.py');
  });

  it('immediate save cancels a pending debounce for the same file', async () => {
    const { sync, posted, flushTimers } = harness();
    sync.saveFileDebounced('answer.py', 'old');
    await sync.saveFileNow('answer.py', 'run-snapshot');
    await flushTimers();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body.get('code')).toBe('run-snapshot');
  });

  it('read-only mode goes offline without posting (server.js:642-644)', async () => {
    const { sync, posted, setStatus } = harness({ readOnly: () => true });
    await sync.saveFileNow('answer.py', 'code');
    expect(posted).toHaveLength(0);
    expect(setStatus).toHaveBeenCalledWith('saveFile', 'offline');
  });

  it('badge lifecycle: active then ready / failed-with-message', async () => {
    const { sync, setStatus, setResponse } = harness();
    await sync.saveFileNow('answer.py', 'code');
    expect(setStatus.mock.calls).toEqual([
      ['saveFile', 'active'],
      ['saveFile', 'ready'],
    ]);
    setStatus.mockClear();
    setResponse({ success: false, message: 'version conflict' });
    await sync.saveFileNow('answer.py', 'code');
    expect(setStatus.mock.calls[1]).toEqual(['saveFile', 'failed', 'version conflict']);
  });
});

describe('cross-assignment autosave (ids frozen at edit time)', () => {
  it('a debounced save that fires after a switch still carries the OLD ids', async () => {
    const { sync, context, posted, flushTimers } = harness();
    sync.saveFileDebounced('answer.py', 'old problem code');
    // The user navigates before the 1 s debounce fires.
    context.assignmentId = 202;
    context.submissionId = 6002;
    context.assignmentVersion = 9;
    context.submissionVersion = 1;
    await flushTimers();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body.get('assignment_id')).toBe('101');
    expect(posted[0]!.body.get('submission_id')).toBe('5001');
    expect(posted[0]!.body.get('assignment_version')).toBe('3');
    expect(posted[0]!.body.get('version')).toBe('7');
    // A fresh edit uses the NEW ids.
    sync.saveFileDebounced('answer.py', 'new problem code');
    await flushTimers();
    expect(posted[1]!.body.get('assignment_id')).toBe('202');
    expect(posted[1]!.body.get('submission_id')).toBe('6002');
  });

  it('flushPending sends every waiting save immediately with its frozen ids', async () => {
    const { sync, context, posted, scheduled } = harness();
    sync.saveFileDebounced('answer.py', 'a');
    sync.saveFileDebounced('!on_run.py', 'b');
    context.assignmentId = 202;
    await sync.flushPending();
    await tick();
    expect(scheduled).toHaveLength(0); // timers cancelled, not fired later
    expect(sync.pendingFiles).toEqual([]);
    expect(posted.map((p) => [p.body.get('filename'), p.body.get('assignment_id')])).toEqual([
      ['answer.py', '101'],
      ['!on_run.py', '101'],
    ]);
  });

  it('flushPending({keepalive}) is the unload path: one keepalive POST per file', async () => {
    const { sync, posted, scheduled } = harness();
    sync.saveFileDebounced('answer.py', 'unsaved');
    void sync.flushPending({ keepalive: true });
    await tick();
    expect(scheduled).toHaveLength(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.keepalive).toBe(true);
    expect(posted[0]!.body.get('code')).toBe('unsaved');
  });
});

describe('save ordering (serialized per filename)', () => {
  it('a newer save waits for the in-flight older one - never overtakes it', async () => {
    const gate = gateFirst();
    const { sync, posted } = harness({}, undefined, { fetch: gate.wrap });
    const first = sync.saveFileNow('answer.py', 'v1');
    await tick();
    const second = sync.saveFileNow('answer.py', 'v2');
    await tick();
    expect(gate.started()).toBe(1); // v2 is queued behind v1, not racing it
    gate.release();
    await Promise.all([first, second]);
    expect(posted.map((p) => p.body.get('code'))).toEqual(['v1', 'v2']);
  });

  it('a save superseded while queued is skipped (latest content wins)', async () => {
    const gate = gateFirst();
    const { sync, posted } = harness({}, undefined, { fetch: gate.wrap });
    const first = sync.saveFileNow('answer.py', 'v1');
    await tick();
    const second = sync.saveFileNow('answer.py', 'v2');
    const third = sync.saveFileNow('answer.py', 'v3');
    gate.release();
    await Promise.all([first, second, third]);
    expect(posted.map((p) => p.body.get('code'))).toEqual(['v1', 'v3']);
  });

  it('different files save concurrently', async () => {
    const gate = gateFirst();
    const { sync } = harness({}, undefined, { fetch: gate.wrap });
    const first = sync.saveFileNow('answer.py', 'v1');
    await tick();
    const other = sync.saveFileNow('!on_run.py', 'grader');
    await tick();
    expect(gate.started()).toBe(2);
    gate.release();
    await Promise.all([first, other]);
  });
});

describe('retry badge lifecycle (bounded retry)', () => {
  it('shows RETRYING while the transport retries, then READY', async () => {
    let failures = 1;
    const { sync, setStatus } = harness({}, undefined, {
      maxRetries: 3,
      fetch: (inner) => async (url, init) => {
        if (failures-- > 0) throw new Error('offline');
        return inner(url, init);
      },
    });
    await sync.saveFileNow('answer.py', 'code');
    expect(setStatus.mock.calls.map((call) => call[1])).toEqual(['active', 'retrying', 'ready']);
  });

  it('shows FAILED once retries are exhausted (no eternal "active")', async () => {
    const { sync, setStatus } = harness({}, undefined, {
      maxRetries: 1,
      fetch: () => async () => {
        throw new Error('offline');
      },
    });
    await sync.saveFileNow('answer.py', 'code');
    expect(setStatus.mock.calls.map((call) => call[1])).toEqual(['active', 'retrying', 'failed']);
  });

  it('a 4xx fails immediately without retrying', async () => {
    const attempts = vi.fn();
    const { sync, setStatus } = harness({}, undefined, {
      maxRetries: 5,
      fetch: () => async () => {
        attempts();
        return { ok: false, status: 403, json: async () => ({}) };
      },
    });
    await sync.saveFileNow('answer.py', 'code');
    expect(attempts).toHaveBeenCalledTimes(1);
    expect(setStatus.mock.calls.map((call) => call[1])).toEqual(['active', 'failed']);
  });
});

describe('version_change banner (LD-11, spec §7.4)', () => {
  it('fires onVersionChange when saveFile reports a stale version', async () => {
    const onVersionChange = vi.fn();
    const { sync, setResponse } = harness({ onVersionChange });
    setResponse({ success: true, version_change: false });
    await sync.saveFileNow('answer.py', 'v1');
    expect(onVersionChange).not.toHaveBeenCalled();
    setResponse({ success: true, version_change: true });
    await sync.saveFileNow('answer.py', 'v2');
    expect(onVersionChange).toHaveBeenCalledTimes(1);
  });

  it("swallows the one version_change caused by this client's own instructor-file save", async () => {
    const onVersionChange = vi.fn();
    const { sync, setResponse } = harness({ onVersionChange });
    setResponse({ success: true });
    await sync.saveFileNow('!on_run.py', 'give_partial(0.5)');
    // The next student save reports the bump the instructor just made.
    setResponse({ success: true, version_change: true });
    await sync.saveFileNow('answer.py', 'v1');
    expect(onVersionChange).not.toHaveBeenCalled();
    // A later, unrelated change still surfaces.
    await sync.saveFileNow('answer.py', 'v2');
    expect(onVersionChange).toHaveBeenCalledTimes(1);
  });

  it('a FAILED instructor-file save bumps nothing - the next version_change is real', async () => {
    const onVersionChange = vi.fn();
    const { sync, setResponse } = harness({ onVersionChange });
    setResponse({ success: false, message: 'rejected' });
    await sync.saveFileNow('!on_run.py', 'give_partial(0.5)');
    setResponse({ success: true, version_change: true });
    await sync.saveFileNow('answer.py', 'v1');
    expect(onVersionChange).toHaveBeenCalledTimes(1);
  });

  it('a read-only instructor-file save bumps nothing either', async () => {
    const onVersionChange = vi.fn();
    let readOnly = true;
    const { sync, setResponse } = harness({ onVersionChange, readOnly: () => readOnly });
    await sync.saveFileNow('!on_run.py', 'x'); // never left the client
    readOnly = false;
    setResponse({ success: true, version_change: true });
    await sync.saveFileNow('answer.py', 'v1');
    expect(onVersionChange).toHaveBeenCalledTimes(1);
  });
});

describe('force update (blockpy.js:1202-1208)', () => {
  it('re-POSTs the current display state with force_update=true', async () => {
    const { sync, posted } = harness();
    sync.seed(0.5, true);
    await sync.forceUpdate();
    expect(posted[0]!.body.get('score')).toBe('0.5');
    expect(posted[0]!.body.get('correct')).toBe('true');
    expect(posted[0]!.body.get('force_update')).toBe('true');
    expect(posted[0]!.body.get('hidden_override')).toBe('false');
  });
});

describe('instructor reset (blockpy.js:784-788)', () => {
  it('zeroes the display state and POSTs hidden+forced', async () => {
    const { sync, posted } = harness();
    sync.seed(0.8, true);
    await sync.resetScore();
    expect(sync.displayScore).toBe(0);
    expect(sync.displayCorrect).toBe(false);
    expect(posted[0]!.body.get('score')).toBe('0');
    expect(posted[0]!.body.get('correct')).toBe('false');
    expect(posted[0]!.body.get('hidden_override')).toBe('true');
    expect(posted[0]!.body.get('force_update')).toBe('true');
  });
});

describe('§14.3 grading sequence (on_run.js:164-175, server.js:663-693)', () => {
  it('POSTs monotonic-max score with the RAW success as correct', async () => {
    const { sync, posted } = harness();
    sync.seed(0.6, false); // stored submission: 60%, not yet correct
    await sync.handleGraded({ success: false, score: 0.4, hideCorrectness: false });
    // clamp(0.4) < seeded 0.6 → monotonic keeps 0.6; correct = raw false.
    expect(posted[0]!.body.get('score')).toBe('0.6');
    expect(posted[0]!.body.get('correct')).toBe('false');
    expect(posted[0]!.body.get('hidden_override')).toBe('false');
    expect(posted[0]!.body.get('force_update')).toBe('false');
    // Second run succeeds with a wild score → clamped to 1, maxed.
    await sync.handleGraded({ success: true, score: 5, hideCorrectness: false });
    expect(posted[1]!.body.get('score')).toBe('1');
    expect(posted[1]!.body.get('correct')).toBe('true');
    expect(sync.displayScore).toBe(1);
    expect(sync.displayCorrect).toBe(true);
  });

  it('always carries the image field: capture, empty, and fail-soft (server.js:675)', async () => {
    const withImage = harness({ getImage: async () => 'data:image/png;base64,PNG' });
    await withImage.sync.handleGraded({ success: true, score: 1, hideCorrectness: false });
    expect(withImage.posted[0]!.body.get('image')).toBe('data:image/png;base64,PNG');
    const withoutImage = harness();
    await withoutImage.sync.handleGraded({ success: true, score: 1, hideCorrectness: false });
    expect(withoutImage.posted[0]!.body.get('image')).toBe('');
    const broken = harness({
      getImage: () => Promise.reject(new Error('no canvas')),
    });
    await broken.sync.handleGraded({ success: true, score: 1, hideCorrectness: false });
    expect(broken.posted[0]!.body.get('image')).toBe(''); // never blocks the POST
    await broken.sync.forceUpdate();
    expect(broken.posted[1]!.body.get('force_update')).toBe('true');
    expect(broken.posted[1]!.body.get('image')).toBe('');
  });

  it('display correct is a monotonic OR; the wire stays raw', async () => {
    const { sync, posted } = harness();
    await sync.handleGraded({ success: true, score: 1, hideCorrectness: false });
    await sync.handleGraded({ success: false, score: 0, hideCorrectness: false });
    expect(sync.displayCorrect).toBe(true); // OR-chain (on_run.js:165)
    expect(posted[1]!.body.get('correct')).toBe('false'); // raw this-run
  });

  it('markCorrect fires when correct && !hide - EVEN on server failure', async () => {
    const { sync, markCorrect, setResponse } = harness();
    setResponse({ success: false, message: 'nope' });
    await sync.handleGraded({ success: true, score: 1, hideCorrectness: false });
    // Legacy quirk (server.js:687-689): the callback ignores response.success.
    expect(markCorrect).toHaveBeenCalledWith(101);
  });

  it('marks the assignment that was GRADED, even if the user switched mid-POST', async () => {
    let releaseImage!: (value: string) => void;
    const { sync, context, markCorrect, posted } = harness({
      getImage: () =>
        new Promise<string>((resolve) => {
          releaseImage = resolve;
        }),
    });
    const graded = sync.handleGraded({ success: true, score: 1, hideCorrectness: false });
    await tick();
    context.assignmentId = 202; // navigation happened while the image captured
    context.submissionId = 6002;
    releaseImage('');
    await graded;
    expect(markCorrect).toHaveBeenCalledWith(101);
    expect(markCorrect).not.toHaveBeenCalledWith(202);
    expect(posted[0]!.body.get('assignment_id')).toBe('101');
    expect(posted[0]!.body.get('submission_id')).toBe('5001');
  });

  it('hide/incorrect block markCorrect', async () => {
    const { sync, markCorrect } = harness();
    await sync.handleGraded({ success: true, score: 1, hideCorrectness: true });
    await sync.handleGraded({ success: false, score: 0, hideCorrectness: false });
    expect(markCorrect).not.toHaveBeenCalled();
  });

  it('read-only skips the POST with an offline badge', async () => {
    const { sync, posted, setStatus } = harness({ readOnly: () => true });
    await sync.handleGraded({ success: true, score: 1, hideCorrectness: false });
    expect(posted).toHaveLength(0);
    expect(setStatus).toHaveBeenCalledWith('updateSubmission', 'offline');
  });

  it('silently no-ops when the endpoint is unconfigured (server.js:669)', async () => {
    const { sync, posted, setStatus } = harness({}, {});
    await sync.handleGraded({ success: true, score: 1, hideCorrectness: false });
    expect(posted).toHaveLength(0);
    expect(setStatus).not.toHaveBeenCalled();
  });
});
