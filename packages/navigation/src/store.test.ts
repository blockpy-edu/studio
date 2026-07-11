// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupNavStore, type GroupNavBootData, type GroupNavOptions } from './store';

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

function makeStore(
  boot: Partial<GroupNavBootData> = {},
  options: GroupNavOptions = {},
): GroupNavStore {
  return new GroupNavStore({ ...BOOT, ...boot }, options);
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['altAssignmentChangingFunction'];
  delete (globalThis as Record<string, unknown>)['$TIME_CHECKER_ID'];
  vi.useRealTimers();
});

describe('navigation (assignment_groups.html:62-92)', () => {
  it('filters subordinates from the ordered list (Jinja rejectattr)', () => {
    const store = makeStore();
    expect(store.getSnapshot().entries.map((entry) => entry.id)).toEqual([101, 103, 104]);
    expect(store.firstId).toBe(101);
    expect(store.lastId).toBe(104);
  });

  it('next/back clamp at the ends (INDICES[i+1] || LAST_ID semantics)', () => {
    const loads: number[] = [];
    const store = makeStore({}, { loadAssignment: (id) => void loads.push(id) });
    store.next(); // 101 → 103
    store.next(); // 103 → 104
    store.next(); // next of last = last
    expect(loads).toEqual([103, 104, 104]);
    store.back(); // 104 → 103
    store.back(); // 103 → 101
    store.back(); // back of first = first
    expect(loads.slice(3)).toEqual([103, 101, 101]);
    expect(store.getSnapshot().currentId).toBe(101);
  });

  it('the UI reflects the target before the load resolves (loadNewAssignment order)', () => {
    let idAtLoadTime: number | null = null;
    const store = makeStore(
      {},
      {
        loadAssignment: (id) => {
          idAtLoadTime = store.getSnapshot().currentId;
          void id;
        },
      },
    );
    store.navigateTo(104);
    expect(idAtLoadTime).toBe(104);
  });

  it('falls back to window.altAssignmentChangingFunction when no dispatch is injected', () => {
    const alt = vi.fn();
    (globalThis as Record<string, unknown>)['altAssignmentChangingFunction'] = alt;
    const store = makeStore();
    store.navigateTo(103);
    expect(alt).toHaveBeenCalledWith(103);
    expect(store.getSnapshot().notice).toBeNull();
  });

  it('full-page URL fallback shows the legacy loading notice (§9.3, closes M2.1)', () => {
    const navigate = vi.fn();
    const store = makeStore({}, { navigate });
    store.navigateTo(103);
    expect(navigate).toHaveBeenCalledWith('/a/103');
    expect(store.getSnapshot().notice).toBe('~~~ The next problem is loading! Please wait');
  });
});

describe('markCorrect (assignment_groups.html:124-142, A7 §2)', () => {
  it('marks, counts, and restyles Next — idempotently', () => {
    const store = makeStore();
    expect(store.getSnapshot().numerator).toBe(1); // 103 seeded correct
    store.markCorrect(101);
    let snap = store.getSnapshot();
    expect(snap.correct.has(101)).toBe(true);
    expect(snap.numerator).toBe(2);
    expect(snap.nextSuccess).toBe(true);
    store.markCorrect(101); // guarded: option already correct-submission
    expect(store.getSnapshot().numerator).toBe(2);
  });

  it('initially-correct assignments are guarded too', () => {
    const store = makeStore();
    store.markCorrect(103);
    expect(store.getSnapshot().numerator).toBe(1);
    expect(store.getSnapshot().nextSuccess).toBe(false);
  });

  it('unknown/subordinate ids still bump the numerator — every call (legacy quirk)', () => {
    const store = makeStore();
    store.markCorrect(102); // subordinate: no option in the header
    store.markCorrect(102); // hasClass guard never matches an empty set
    const snap = store.getSnapshot();
    expect(snap.numerator).toBe(3);
    expect(snap.correct.has(102)).toBe(false);
    expect(snap.nextSuccess).toBe(true);
  });

  it('secretive groups mask everything: no ✔, no count, no Next restyle', () => {
    const store = makeStore({ anySecretive: true });
    store.markCorrect(101);
    const snap = store.getSnapshot();
    expect(snap.correct.has(101)).toBe(false);
    expect(snap.numerator).toBe(1); // untouched — render masks it as "??"
    expect(snap.nextSuccess).toBe(false);
  });
});

describe('selector expansion (assignment_groups.html:94-120)', () => {
  it('persists under the exact localStorage key as "true"/"false"', () => {
    const store = makeStore();
    expect(store.getSnapshot().expanded).toBe(false);
    store.toggleExpansion();
    expect(store.getSnapshot().expanded).toBe(true);
    expect(localStorage.getItem('blockpy_assignmentSelectorExpanded')).toBe('true');
    store.toggleExpansion();
    expect(localStorage.getItem('blockpy_assignmentSelectorExpanded')).toBe('false');
  });

  it('re-reads storage on every toggle rather than trusting memory (:117)', () => {
    const store = makeStore();
    localStorage.setItem('blockpy_assignmentSelectorExpanded', 'true');
    store.toggleExpansion(); // !(stored true) → collapses
    expect(store.getSnapshot().expanded).toBe(false);
  });

  it('boots expanded when a previous session left it so', () => {
    localStorage.setItem('blockpy_assignmentSelectorExpanded', 'true');
    expect(makeStore().getSnapshot().expanded).toBe(true);
  });
});

describe('time-spent clock (editor.html:393-451)', () => {
  it('session_start_time of 0/null falls back to now (A7 §5 item 8)', () => {
    const store = makeStore({}, { sessionStartTime: 0 });
    store.refreshClock();
    expect(store.getSnapshot().clockText).toBe('(Just started)');
  });

  it('ticks from the server session start when provided', () => {
    const store = makeStore({}, { sessionStartTime: Date.now() - 5 * 60 * 1000 });
    store.refreshClock();
    expect(store.getSnapshot().clockText).toBe('~5 minutes spent');
  });

  it('click: session → (Getting Total) → activity = fetched total + session elapsed', async () => {
    const store = makeStore(
      {},
      {
        sessionStartTime: Date.now() - 30 * 1000,
        getGroupDuration: () => Promise.resolve(3660),
      },
    );
    store.clockClicked();
    expect(store.getSnapshot().clockText).toBe('(Getting Total)');
    await vi.waitFor(() => {
      // 30 s session + 3660 s activity → 1:01.
      expect(store.getSnapshot().clockText).toBe('~1:01 hours spent');
    });
    // Any non-session click resets to session and zeroes the total.
    store.clockClicked();
    expect(store.getSnapshot().clockText).toBe('(Just started)');
  });

  it('fetch errors fall back to session mode with the total zeroed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = makeStore(
      {},
      {
        sessionStartTime: Date.now() - 2 * 60 * 1000,
        getGroupDuration: () => Promise.reject(new Error('offline')),
      },
    );
    store.clockClicked();
    await vi.waitFor(() => {
      expect(store.getSnapshot().clockText).toBe('~2 minutes spent');
    });
    store.clockClicked(); // session-mode click retries the fetch
    expect(store.getSnapshot().clockText).toBe('(Getting Total)');
    await vi.waitFor(() => {
      expect(store.getSnapshot().clockText).toBe('~2 minutes spent');
    });
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('a session-mode click with no fetcher anywhere does nothing but refresh', () => {
    const store = makeStore({}, { sessionStartTime: Date.now() });
    store.clockClicked();
    expect(store.getSnapshot().clockText).toBe('(Just started)');
  });
});

describe('countdown / time-limit checker (assignment_interface.ts:160-256)', () => {
  const started = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();

  // The legacy checker only ever runs from its own registered interval, so
  // the $TIME_CHECKER_ID guard must see the store attached.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders "X elapsed; Y left" and hides the clock once a limit is active', () => {
    const store = makeStore();
    const detach = store.attach();
    store.setTimeLimit({
      timeLimit: '10min',
      studentTimeLimit: null,
      dateStarted: started(2 * 60),
    });
    store.handleTimeCheck();
    const snap = store.getSnapshot();
    expect(snap.countdownText).toBe('2 minutes elapsed; 8 minutes left');
    expect(snap.clockVisible).toBe(false);
    detach();
  });

  it('does nothing without a time limit or a start time', () => {
    const store = makeStore();
    const detach = store.attach();
    store.handleTimeCheck();
    store.setTimeLimit({ timeLimit: '10min', studentTimeLimit: null, dateStarted: null });
    store.handleTimeCheck();
    expect(store.getSnapshot().countdownText).toBe('');
    expect(store.getSnapshot().clockVisible).toBe(true);
    detach();
  });

  it('expiry overlays the page once and logs timer_expired (non-instructors)', () => {
    const events: string[] = [];
    const store = makeStore(
      {},
      { logEvent: (eventType) => void events.push(eventType), isInstructor: () => false },
    );
    const detach = store.attach();
    store.setTimeLimit({
      timeLimit: '1min',
      studentTimeLimit: null,
      dateStarted: started(5 * 60),
    });
    store.handleTimeCheck();
    const box = document.querySelector('.end-assignment-timer-box');
    expect(box?.textContent).toContain('Time is up!');
    expect(events).toEqual(['timer_expired']);
    // The countdown text updated on the tick that created the overlay…
    expect(store.getSnapshot().countdownText).toBe('5 minutes elapsed; Time past!');
    // …and freezes afterwards: the overlay-exists early return skips it.
    store.handleTimeCheck();
    expect(document.querySelectorAll('.end-assignment-timer-box')).toHaveLength(1);
    expect(events).toEqual(['timer_expired']);
    detach();
  });

  it('instructors never get the overlay — and the early return freezes the span', () => {
    const store = makeStore({}, { isInstructor: () => true });
    const detach = store.attach();
    store.setTimeLimit({
      timeLimit: '1min',
      studentTimeLimit: null,
      dateStarted: started(10 * 60),
    });
    store.handleTimeCheck();
    expect(document.querySelector('.end-assignment-timer-box')).toBeNull();
    expect(store.getSnapshot().countdownText).toBe('');
    detach();
  });

  it('a superseding checker kills the old one via $TIME_CHECKER_ID (timer_cleared)', () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const first = makeStore({}, { logEvent: (eventType) => void events.push(eventType) });
    const detachFirst = first.attach();
    const second = makeStore();
    const detachSecond = second.attach(); // clears + replaces the global id
    first.handleTimeCheck();
    expect(events).toEqual(['timer_cleared']);
    detachFirst();
    detachSecond();
  });

  it('checker exceptions log timer_error and surface "Error with timer"', () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: string[] = [];
    const store = makeStore({}, { logEvent: (eventType) => void events.push(eventType) });
    const detach = store.attach();
    // A numeric time_limit crashes parseTimeLimit — legacy hits the same
    // catch every 5 s (assignment_interface.ts:92-110).
    store.setTimeLimit({
      timeLimit: 45 as unknown as string,
      studentTimeLimit: null,
      dateStarted: started(60),
    });
    vi.advanceTimersByTime(5000);
    expect(events).toEqual(['timer_error']);
    expect(store.getSnapshot().countdownText).toBe('Error with timer');
    detach();
    errorSpy.mockRestore();
  });
});

describe('lifecycle', () => {
  it('attach is ref-counted: timers survive one header unmounting', () => {
    vi.useFakeTimers();
    const store = makeStore({}, { sessionStartTime: Date.now() });
    const detachTop = store.attach();
    const detachBottom = store.attach();
    detachTop();
    vi.advanceTimersByTime(61_000);
    expect(store.getSnapshot().clockText).toBe('~1 minute spent');
    detachBottom();
    const frozen = store.getSnapshot().clockText;
    vi.advanceTimersByTime(600_000);
    expect(store.getSnapshot().clockText).toBe(frozen);
    expect((globalThis as Record<string, unknown>)['$TIME_CHECKER_ID']).toBeUndefined();
  });
});
