/**
 * Assignment-group navigation store (spec §9) — the single source both
 * header instances render from (the legacy macro is included twice and
 * kept in sync only because its jQuery selectors are document-wide).
 *
 * Ports, quirk for quirk:
 *   - loadNavigation()/loadNewAssignment/updateUI —
 *     blockpy-server templates/helpers/assignment_groups.html:40-121
 *   - markCorrect — assignment_groups.html:124-142
 *   - the time-spent clock — templates/blockpy/editor.html:393-451
 *   - the countdown / time-limit checker —
 *     frontend/components/assignment_interface.ts:20-45, 88-115, 160-256
 */
import { formatAmount, formatClockDuration, parseTimeLimit } from './format';

export interface GroupNavAssignment {
  id: number;
  name: string;
  /** Legacy URL_MAP[id]; full-page navigation fallback (spec §9.3). */
  url: string;
  subordinate: boolean;
  hidden: boolean;
  /** From the paired submission. */
  correct: boolean;
}

/** Structurally identical to the app's GroupBootData (spec §9.2). */
export interface GroupNavBootData {
  assignments: GroupNavAssignment[];
  /** OR of hidden — masks all statuses (legacy ns.any_secretive). */
  anySecretive: boolean;
  currentAssignmentId: number;
}

/**
 * assignment settings.time_limit + the per-submission override/start —
 * legacy reads these live from the loaded pair (assignment_interface.ts:
 * 186-193); the app feeds them on every assignment adoption.
 */
export interface TimeLimitInfo {
  /** settings.time_limit ("Nmin" or plain minutes); absent = no limit. */
  timeLimit: string | null;
  /** submission.timeLimit() — per-student "Nmin" absolute or "Nx" multiplier. */
  studentTimeLimit: string | null;
  /** submission.dateStarted() — countdown renders only once this is set. */
  dateStarted: string | null;
}

export interface GroupNavOptions {
  /**
   * SPA dispatch (AssignmentHost.loadAssignment). When absent the store
   * falls back to window.altAssignmentChangingFunction and then to the
   * legacy full-page navigation via the per-assignment URL
   * (assignment_groups.html:62-71).
   */
  loadAssignment?: (assignmentId: number) => void | Promise<void>;
  /**
   * Total-duration fetcher (legacy window.ACTIVITY_GET_DURATION,
   * editor.html:395-399). Falls back to the global at click time so shim
   * pages that define it keep working.
   */
  getGroupDuration?: () => Promise<number>;
  /** Timer telemetry (timer_expired/timer_cleared/timer_error, A2 §4). */
  logEvent?: (eventType: string, category: string, label: string, message: string) => void;
  /** Live instructor check — instructors never get the expiry overlay. */
  isInstructor?: () => boolean;
  /** Server session start (epoch ms); 0/null falls back to now (A7 §5). */
  sessionStartTime?: number | null;
  /** Full-page navigation, injectable for tests. */
  navigate?: (url: string) => void;
}

export interface GroupNavSnapshot {
  /** Non-subordinate assignments in group order (the legacy INDICES). */
  entries: readonly GroupNavAssignment[];
  anySecretive: boolean;
  currentId: number;
  /** Ids rendering the ✔ prefix / correct-submission class. */
  correct: ReadonlySet<number>;
  /**
   * Completion-box numerator. Tracked separately from `correct` because
   * legacy increments the DOM counter even for ids with no option in the
   * header (e.g. a subordinate quiz reporting through markCorrect).
   */
  numerator: number;
  /** Any markCorrect happened → Next restyles btn-success, never reverts. */
  nextSuccess: boolean;
  /** Selector list-box expansion (completion-box click). */
  expanded: boolean;
  clockText: string;
  /** Countdown hides the clock while a time limit is active (:253). */
  clockVisible: boolean;
  countdownText: string;
  /** "~~~ The next problem is loading! Please wait" during URL fallback. */
  notice: string | null;
}

const EXPANSION_KEY = 'blockpy_assignmentSelectorExpanded';
const NOTICE_TEXT = '~~~ The next problem is loading! Please wait';
const TIME_CHECKER_GLOBAL = '$TIME_CHECKER_ID';

/** Storage-denied contexts throw on any localStorage touch (:106-112). */
function readExpansion(): boolean {
  try {
    return localStorage.getItem(EXPANSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export class GroupNavStore {
  private snapshot: GroupNavSnapshot;
  private listeners = new Set<() => void>();
  private options: GroupNavOptions;

  // -- clock state (editor.html:400-402) ------------------------------------
  private pageStartTime: number;
  private activityDuration = 0;
  private clockMode: 'session' | 'loading' | 'activity' = 'session';

  // -- timers ----------------------------------------------------------------
  private attachCount = 0;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private timeChecker: ReturnType<typeof setInterval> | null = null;
  private timeLimitInfo: TimeLimitInfo | null = null;

  constructor(boot: GroupNavBootData, options: GroupNavOptions = {}) {
    this.options = options;
    // Jinja: group|rejectattr('0.subordinate') (assignment_groups.html:2).
    const entries = boot.assignments.filter((entry) => !entry.subordinate);
    const correct = new Set(entries.filter((entry) => entry.correct).map((entry) => entry.id));
    this.snapshot = {
      entries,
      anySecretive: boot.anySecretive,
      currentId: boot.currentAssignmentId,
      correct,
      numerator: correct.size,
      nextSuccess: false,
      expanded: readExpansion(),
      // Server-rendered placeholder until the first refreshClock tick
      // (assignment_groups.html:196).
      clockText: '0:00',
      clockVisible: true,
      countdownText: '',
      notice: null,
    };
    // `{{ (session_start_time or 0)|tojson }} || Date.now()` — 0 and null
    // both fall back (editor.html:400, A7 §5 item 8).
    this.pageStartTime = options.sessionStartTime || Date.now();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GroupNavSnapshot => this.snapshot;

  private setState(partial: Partial<GroupNavSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }

  // -- navigation (assignment_groups.html:62-92) ------------------------------

  get firstId(): number {
    return this.snapshot.entries[0]?.id ?? this.snapshot.currentId;
  }

  get lastId(): number {
    const { entries } = this.snapshot;
    return entries[entries.length - 1]?.id ?? this.snapshot.currentId;
  }

  /** loadNewAssignment: the UI reflects the target before the load runs. */
  navigateTo(assignmentId: number): void {
    this.setState({ currentId: assignmentId });
    if (this.options.loadAssignment) {
      void this.options.loadAssignment(assignmentId);
      return;
    }
    const alt = (globalThis as Record<string, unknown>)['altAssignmentChangingFunction'];
    if (typeof alt === 'function') {
      (alt as (id: number) => void)(assignmentId);
      return;
    }
    // Full-page fallback (:65-67): navigate, then show the loading notice
    // in the header rows while the browser tears the page down.
    const entry = this.snapshot.entries.find((candidate) => candidate.id === assignmentId);
    if (entry) {
      (this.options.navigate ?? ((url: string) => {
        document.location.href = url;
      }))(entry.url);
    }
    this.setState({ notice: NOTICE_TEXT });
  }

  first(): void {
    this.navigateTo(this.firstId);
  }

  last(): void {
    this.navigateTo(this.lastId);
  }

  /** `INDICES[index+1] || LAST_ID` — next of last stays last (:83-87). */
  next(): void {
    const indices = this.snapshot.entries.map((entry) => entry.id);
    const index = indices.indexOf(this.snapshot.currentId);
    this.navigateTo(indices[index + 1] || this.lastId);
  }

  /** `INDICES[index-1] || FIRST_ID` — back of first stays first (:88-92). */
  back(): void {
    const indices = this.snapshot.entries.map((entry) => entry.id);
    const index = indices.indexOf(this.snapshot.currentId);
    this.navigateTo(indices[index - 1] || this.firstId);
  }

  /** Host-driven sync (the select stays honest when dispatch is external). */
  setCurrentId(assignmentId: number): void {
    if (assignmentId !== this.snapshot.currentId) {
      this.setState({ currentId: assignmentId });
    }
  }

  // -- markCorrect (assignment_groups.html:124-142) ----------------------------

  /**
   * Exact port, including the quirks A7 §2 pins: the idempotence guard is
   * "option already has correct-submission" (so in secretive groups it never
   * blocks, and unknown/subordinate ids re-run every call); Next restyles on
   * ANY correct id, not just the current one; the numerator increments even
   * when no option matched.
   */
  markCorrect(assignmentId: number): void {
    const { anySecretive, correct, entries } = this.snapshot;
    const known = entries.some((entry) => entry.id === assignmentId);
    const alreadyCorrect = !anySecretive && known && correct.has(assignmentId);
    if (alreadyCorrect) return;
    if (!anySecretive) {
      const updated = new Set(correct);
      if (known) updated.add(assignmentId);
      this.setState({
        correct: updated,
        numerator: this.snapshot.numerator + 1,
        nextSuccess: true,
      });
    }
    // Secretive groups: the only legacy action is re-writing "??" into the
    // numerator (:138-140) — our render masks it whenever anySecretive.
  }

  // -- selector expansion (assignment_groups.html:94-120) ----------------------

  /**
   * Legacy re-reads localStorage on every click rather than trusting its
   * in-memory state (:117), so a value changed in another tab wins.
   */
  toggleExpansion(): void {
    const next = !readExpansion();
    this.setState({ expanded: next });
    try {
      localStorage.setItem(EXPANSION_KEY, String(next));
    } catch {
      // Storage denied — the toggle still applies for this page.
    }
  }

  // -- time-spent clock (editor.html:393-451) ----------------------------------

  refreshClock(): void {
    if (this.clockMode !== 'loading') {
      const duration = Math.floor(
        (Date.now() - this.pageStartTime) / 1000 + this.activityDuration,
      );
      this.setState({ clockText: formatClockDuration(duration) });
    } else {
      this.setState({ clockText: '(Getting Total)' });
    }
  }

  /**
   * session → loading → activity; errors and any non-session click reset to
   * session with activityDuration zeroed (editor.html:429-449). In activity
   * mode the display is fetched total + still-ticking session elapsed.
   */
  clockClicked(): void {
    if (this.clockMode === 'session') {
      const fetcher =
        this.options.getGroupDuration ??
        ((globalThis as Record<string, unknown>)['ACTIVITY_GET_DURATION'] as
          | (() => Promise<number>)
          | undefined);
      if (typeof fetcher === 'function') {
        this.clockMode = 'loading';
        void Promise.resolve(fetcher())
          .then((result) => {
            this.activityDuration = result;
            this.clockMode = 'activity';
          })
          .catch((error) => {
            console.error(error);
            this.clockMode = 'session';
            this.activityDuration = 0;
          })
          .finally(() => {
            this.refreshClock();
          });
      }
    } else {
      this.activityDuration = 0;
      this.clockMode = 'session';
    }
    this.refreshClock();
  }

  // -- countdown / time-limit checker (assignment_interface.ts) ----------------

  /** Fed by the app whenever the loaded assignment/submission pair changes. */
  setTimeLimit(info: TimeLimitInfo | null): void {
    this.timeLimitInfo = info;
  }

  /**
   * The legacy checker is a page-wide singleton handed off through
   * window.$TIME_CHECKER_ID (assignment_interface.ts:88-91, 160-178) so a
   * legacy island (kettle/explain) taking over kills ours cleanly.
   */
  private startTimeChecker(): void {
    const globals = globalThis as Record<string, unknown>;
    if (globals[TIME_CHECKER_GLOBAL]) {
      clearInterval(globals[TIME_CHECKER_GLOBAL] as ReturnType<typeof setInterval>);
    }
    this.timeChecker = setInterval(() => {
      try {
        this.handleTimeCheck();
      } catch (error) {
        console.error('Failed to handle time check', error);
        this.options.logEvent?.(
          'timer_error',
          'timer',
          'time_error',
          JSON.stringify({
            error: String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }),
        );
        this.setState({ countdownText: 'Error with timer' });
      }
    }, 5000);
    globals[TIME_CHECKER_GLOBAL] = this.timeChecker;
  }

  /** Exposed for tests; the 5 s interval drives it in production. */
  handleTimeCheck(): void {
    const globals = globalThis as Record<string, unknown>;
    if (this.timeChecker !== globals[TIME_CHECKER_GLOBAL]) {
      // Superseded by another checker — stop and report (ts:160-178).
      if (this.timeChecker != null) {
        clearInterval(this.timeChecker);
        this.timeChecker = null;
        this.options.logEvent?.('timer_cleared', 'timer', 'time_clear', '');
      }
      return;
    }
    const info = this.timeLimitInfo;
    if (!info || !info.timeLimit) return;
    const timeLimit = parseTimeLimit(info.timeLimit, info.studentTimeLimit);
    const startTime = info.dateStarted;
    if (!startTime) return;
    const startDate = new Date(startTime);
    const elapsed = Math.floor((Date.now() - startDate.getTime()) / 1000);
    const remaining = timeLimit - elapsed;
    if (remaining <= 0) {
      // Both early returns skip the countdown update below, freezing the
      // span at its last pre-expiry value (ts:201-246 — legacy-exact).
      if (document.querySelector('.end-assignment-timer-box')) return;
      if (this.options.isInstructor?.()) return;
      const box = document.createElement('div');
      box.className = 'end-assignment-timer-box';
      box.textContent =
        'Time is up! Your assignment will be automatically submitted now. ' +
        'You may not continue working on it. Please log out. ' +
        'Thanks for taking the exam, and best of luck!';
      Object.assign(box.style, {
        position: 'fixed',
        width: '100%',
        height: '100%',
        top: '0',
        left: '0',
        padding: '20px',
        backgroundColor: 'white',
        border: '1px solid black',
        borderRadius: '10px',
        textAlign: 'center',
        zIndex: '1000',
      });
      document.body.appendChild(box);
      this.options.logEvent?.(
        'timer_expired',
        'timer',
        'time_up',
        JSON.stringify({
          elapsed,
          remaining,
          time_limit: timeLimit,
          start_time: startTime,
        }),
      );
    }
    this.setState({
      countdownText:
        formatAmount(elapsed, ' elapsed', true) + '; ' + formatAmount(remaining, ' left', true),
      clockVisible: false,
    });
  }

  // -- lifecycle ----------------------------------------------------------------

  /**
   * Ref-counted by the header instances: timers start with the first mount
   * and stop with the last unmount. Returns the matching detach.
   */
  attach = (): (() => void) => {
    this.attachCount += 1;
    if (this.attachCount === 1) {
      this.refreshClock();
      this.clockTimer = setInterval(() => this.refreshClock(), 10000);
      this.startTimeChecker();
    }
    return () => {
      this.attachCount -= 1;
      if (this.attachCount === 0) this.dispose();
    };
  };

  dispose(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.timeChecker) {
      clearInterval(this.timeChecker);
      const globals = globalThis as Record<string, unknown>;
      if (globals[TIME_CHECKER_GLOBAL] === this.timeChecker) {
        delete globals[TIME_CHECKER_GLOBAL];
      }
      this.timeChecker = null;
    }
  }
}

export function createGroupNavStore(
  boot: GroupNavBootData,
  options: GroupNavOptions = {},
): GroupNavStore {
  return new GroupNavStore(boot, options);
}
