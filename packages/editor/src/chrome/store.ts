/**
 * Editor chrome state (zustand). Mirrors the slice of legacy Knockout
 * observables the Python editor chrome binds to: `display.pythonMode`,
 * `display.historyMode`, `ui.execute.isRunning`, console output, and the
 * feedback pane (`ui.feedback.*`).
 */
import { create } from 'zustand';
import type { DualEditorMode } from '../dual/dual-editor';

export interface ConsoleEntry {
  /** 'eval' = a frozen (submitted) Evaluate line, legacy disabled-input look. */
  kind: 'stdout' | 'stderr' | 'input-prompt' | 'value' | 'image' | 'eval';
  text: string;
  /** For frozen 'input-prompt' lines: the value the user submitted. */
  value?: string;
}

export interface FeedbackState {
  /** Pedal category (lowercased legacy vocabulary; null = no feedback). */
  category: string | null;
  label: string;
  /** HTML body — rendered unsanitized, D4-A legacy parity. */
  message: string;
  /**
   * Pedal final.positives (on_run.js:78-88): green-star compliments shown
   * under the main message (legacy addPositiveFeedback).
   */
  positives?: { title: string; label: string; message: string }[];
}

export type RunState = 'idle' | 'running' | 'error';

/**
 * The console's Evaluate affordance (legacy console.js): hidden until a run
 * succeeds, then a `beginEval` button line (run.js:57-59, unless
 * `hide_evaluate`); clicking it swaps in an inline "Evaluate:" input line,
 * and every completed evaluation re-arms a fresh input (engine.js:136-156).
 */
export type EvalState = 'hidden' | 'button' | 'input';

/**
 * Color themes (M4.1; STUDIO EXTENSION, no legacy analog). `light` is the
 * B6 visual-parity default; `dark` and `win2000` are explicit user opt-ins.
 * `prefers-color-scheme` is deliberately ignored — the parity default wins
 * until the user chooses (plan M4.1 / ledger LD-23).
 */
export type ThemeName = 'light' | 'dark' | 'win2000';

/** Legacy `StatusState` enum (server.js:8-14). */
export type ServerStatusState = 'ready' | 'active' | 'retrying' | 'failed' | 'offline';

/** The endpoints the footer badges report on (footer.js:4-21). */
export const SERVER_ENDPOINTS = [
  'loadAssignment',
  'saveAssignment',
  'loadFile',
  'saveFile',
  'loadDataset',
  'logEvent',
  'updateSubmission',
  'onExecution',
] as const;
export type ServerEndpoint = (typeof SERVER_ENDPOINTS)[number];

/** One trace step as the chrome consumes it (engine E3 TraceStep shape). */
export interface TraceStepView {
  event: string;
  line: number;
  studentLine: number;
  locals?: Record<string, string>;
}

export interface EditorChromeState {
  pythonMode: DualEditorMode;
  historyMode: boolean;
  runState: RunState;
  console: ConsoleEntry[];
  feedback: FeedbackState;
  traceSteps: TraceStepView[];
  traceStep: number;
  /** Legacy `ui.secondRow.isTraceVisible` — trace replaces feedback. */
  traceVisible: boolean;
  /** Per-endpoint server state driving the footer badges (`model.status`). */
  serverStatus: Record<ServerEndpoint, ServerStatusState>;
  /** First non-empty status message, pre-capitalized (ui.server.messages). */
  serverMessage: string;
  /** Queued stdin lines replayed into runs (legacy `execution.input`). */
  queuedInputs: string[];
  /**
   * Interactive input() request (spec §6.5): the prompt whose console
   * input line is currently live, or null. One at a time — the engine is
   * single-job and Python is suspended while this is set.
   */
  pendingInput: string | null;
  /** Clear queued inputs after each run (legacy `display.clearInputs`). */
  clearInputs: boolean;
  /** Render console images vs raw text (legacy `display.renderImages`). */
  renderImages: boolean;
  /**
   * Text-editor autocomplete (M3.3; STUDIO EXTENSION — legacy CM5 had
   * none). Default OFF; persisted like the legacy localSettings keys.
   */
  autocomplete: boolean;
  /**
   * Filesystem tree rail (M3.7; STUDIO EXTENSION, no legacy analog).
   * Default OFF; persisted. In text-only mode the tree REPLACES the
   * horizontal tab strip.
   */
  fileTree: boolean;
  /** Active color theme (M4.1); persisted, applied via `[data-theme]`. */
  theme: ThemeName;
  /**
   * Focused editor mode (M4.2; STUDIO EXTENSION — exam-friendly). Hides
   * instructions/quick-menu/file-strip/group-nav and moves console +
   * feedback into a collapsible bottom drawer. Deliberately NOT persisted:
   * every page load starts in the normal chrome.
   */
  focusedMode: boolean;
  /**
   * Docs panel expansion (M4.3; STUDIO EXTENSION). Only meaningful when
   * the assignment carries a `docs_url`; persisted like fileTree.
   */
  docsPanel: boolean;
  /**
   * Blockly keyboard navigation (M6.2, LD-30; §16.3 best-effort). Arms the
   * @blockly/keyboard-navigation plugin on the block workspace. Default
   * OFF; persisted like the other display toggles.
   */
  blockKeyboardNav: boolean;
  /** User-supplied passcode sent with every server payload (A7 §1). */
  passcode: string;
  /**
   * Whether feedback/output is stale relative to the code (legacy
   * `display.dirtySubmission`): true until a run completes, and again after
   * any edit.
   */
  dirtySubmission: boolean;
  /** Where the console's Evaluate affordance is in its lifecycle. */
  evalState: EvalState;
  /**
   * Dev console (STUDIO EXTENSION, no legacy analog): a secondary,
   * instructor-only console for system messages (engine boot, grader
   * lifecycle) and instructor-code output, keeping the student console
   * clean. It shares the console slot — a toggle swaps between the two.
   */
  devConsole: ConsoleEntry[];
  /** Which console occupies the console slot. */
  activeConsole: 'student' | 'dev';
  /** Entries appended to the student console while the dev one is shown. */
  consoleUnseen: number;
  /** Entries appended to the dev console while the student one is shown. */
  devUnseen: number;
  /**
   * A feedback rating asked for the PROMPTED share dialog (legacy
   * rate → startShare(true), blockpy.js:797-813). QuickMenu owns the
   * dialog and clears the flag.
   */
  promptedShare: boolean;
  /**
   * Pedal questions support (on_run.js:74-76): a grader's
   * final.instructions REPLACES the instructions pane (legacy
   * set_instructions) until the next assignment load.
   */
  instructionsOverride: string | null;

  setPythonMode(mode: DualEditorMode): void;
  toggleHistoryMode(): void;
  setHistoryMode(on: boolean): void;
  setRunState(state: RunState): void;
  appendConsole(entry: ConsoleEntry): void;
  clearConsole(): void;
  setFeedback(feedback: FeedbackState): void;
  clearFeedback(): void;
  setTrace(steps: TraceStepView[]): void;
  setTraceStep(index: number): void;
  setTraceVisible(visible: boolean): void;
  setServerStatus(endpoint: ServerEndpoint, status: ServerStatusState, message?: string): void;
  setQueuedInputs(inputs: string[]): void;
  /** Show the console input line; resolves with the submitted value. */
  requestConsoleInput(prompt: string): Promise<string>;
  /** Freeze the live input line into history and resume the run. */
  submitConsoleInput(value: string): void;
  /** Drop a stale input line (run ended/interrupted); never resolves. */
  cancelConsoleInput(): void;
  setClearInputs(clear: boolean): void;
  toggleRenderImages(): void;
  toggleAutocomplete(): void;
  toggleFileTree(): void;
  setTheme(theme: ThemeName): void;
  setFocusedMode(on: boolean): void;
  toggleDocsPanel(): void;
  toggleBlockKeyboardNav(): void;
  setPasscode(passcode: string): void;
  setDirtySubmission(dirty: boolean): void;
  setEvalState(state: EvalState): void;
  appendDevConsole(entry: ConsoleEntry): void;
  clearDevConsole(): void;
  /** Swap the console slot; clears the shown console's unseen counter. */
  setActiveConsole(which: 'student' | 'dev'): void;
  requestPromptedShare(): void;
  clearPromptedShare(): void;
  setInstructionsOverride(instructions: string | null): void;
}

/**
 * Legacy `requestPasscode()` (blockpy.js:1308-1311): a synchronous browser
 * prompt whose answer rides along on every subsequent server payload. One
 * prompt covers the whole group; there is no retry loop (A7 §1). Boot glue
 * calls this before the first loadAssignment when the group is protected.
 */
export function requestPasscode(): void {
  const supplied = window.prompt('Please enter the passcode.');
  useEditorChromeStore.getState().setPasscode(supplied ?? '');
}

const EMPTY_FEEDBACK: FeedbackState = {
  category: null,
  label: '',
  message: 'Ready',
};

const INITIAL_SERVER_STATUS = Object.fromEntries(
  SERVER_ENDPOINTS.map((endpoint) => [endpoint, 'offline']),
) as Record<ServerEndpoint, ServerStatusState>;

/** localStorage key for the autocomplete preference (showRating pattern). */
const AUTOCOMPLETE_KEY = 'BLOCKPY_display.autocomplete';
/** localStorage key for the file-tree rail (M3.7). */
const FILE_TREE_KEY = 'BLOCKPY_display.fileTree';
/** localStorage key for the color theme (M4.1). */
const THEME_KEY = 'BLOCKPY_display.theme';
/** localStorage key for the docs panel (M4.3). */
const DOCS_PANEL_KEY = 'BLOCKPY_display.docsPanel';
/** localStorage key for Blockly keyboard navigation (M6.2). */
const KEYBOARD_NAV_KEY = 'BLOCKPY_display.blockKeyboardNav';

function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable (sandboxed iframe) — the toggle still works.
  }
}

export const THEME_NAMES: readonly ThemeName[] = ['light', 'dark', 'win2000'];

function readStoredTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEME_NAMES.includes(stored as ThemeName) ? (stored as ThemeName) : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Themes apply as a `data-theme` attribute on the root element — the
 * `[data-theme=…]` scopes in styles/themes.css override the tokens.css
 * values. Light removes the attribute so the unthemed (parity) values bind.
 */
function applyThemeAttribute(theme: ThemeName): void {
  try {
    if (theme === 'light') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // No DOM (SSR/tests without jsdom) — CSS theming simply doesn't bind.
  }
}

const INITIAL_THEME = readStoredTheme();
applyThemeAttribute(INITIAL_THEME);

/**
 * Resolver for the live console input line (spec §6.5). Held outside the
 * state (not serializable); one at a time — the engine is single-job.
 */
let consoleInputResolver: ((value: string) => void) | null = null;

export const useEditorChromeStore = create<EditorChromeState>((set) => ({
  pythonMode: 'split',
  historyMode: false,
  runState: 'idle',
  console: [],
  feedback: EMPTY_FEEDBACK,
  traceSteps: [],
  traceStep: 0,
  traceVisible: false,
  serverStatus: INITIAL_SERVER_STATUS,
  serverMessage: '',
  queuedInputs: [],
  pendingInput: null,
  clearInputs: true,
  renderImages: true,
  autocomplete: readStoredFlag(AUTOCOMPLETE_KEY),
  fileTree: readStoredFlag(FILE_TREE_KEY),
  theme: INITIAL_THEME,
  focusedMode: false,
  docsPanel: readStoredFlag(DOCS_PANEL_KEY),
  blockKeyboardNav: readStoredFlag(KEYBOARD_NAV_KEY),
  passcode: '',
  dirtySubmission: true,
  evalState: 'hidden',
  devConsole: [],
  activeConsole: 'student',
  consoleUnseen: 0,
  devUnseen: 0,
  promptedShare: false,
  instructionsOverride: null,

  setPythonMode: (mode) => set({ pythonMode: mode }),
  toggleHistoryMode: () => set((state) => ({ historyMode: !state.historyMode })),
  setHistoryMode: (on) => set({ historyMode: on }),
  setRunState: (runState) => set({ runState }),
  appendConsole: (entry) =>
    set((state) => ({
      console: [...state.console, entry],
      // Notify the badge when the other console is in the slot.
      consoleUnseen: state.activeConsole === 'dev' ? state.consoleUnseen + 1 : state.consoleUnseen,
    })),
  // Legacy clears the whole printer on each run — the beginEval button line
  // lives inside it, so it goes too (and there is nothing left unseen).
  clearConsole: () => set({ console: [], evalState: 'hidden', consoleUnseen: 0 }),
  setFeedback: (feedback) => set({ feedback }),
  clearFeedback: () => set({ feedback: EMPTY_FEEDBACK }),
  setTrace: (steps) => set({ traceSteps: steps, traceStep: 0 }),
  setTraceStep: (index) =>
    set((state) => ({
      traceStep: Math.max(0, Math.min(index, state.traceSteps.length - 1)),
    })),
  setTraceVisible: (visible) => set({ traceVisible: visible }),
  // Legacy setStatus(endpoint, state, message) — the messages line shows the
  // first non-empty message, capitalized (ui.server.messages, blockpy.js).
  setServerStatus: (endpoint, status, message) =>
    set((state) => ({
      serverStatus: { ...state.serverStatus, [endpoint]: status },
      serverMessage:
        message === undefined
          ? state.serverMessage
          : message.charAt(0).toUpperCase() + message.slice(1),
    })),
  setQueuedInputs: (inputs) => set({ queuedInputs: inputs }),
  requestConsoleInput: (prompt) =>
    new Promise<string>((resolve) => {
      consoleInputResolver = resolve;
      set({ pendingInput: prompt });
    }),
  submitConsoleInput: (value) => {
    const resolve = consoleInputResolver;
    consoleInputResolver = null;
    set((state) => {
      if (state.pendingInput === null) return state;
      return {
        pendingInput: null,
        // The live line freezes into history (legacy disables the box).
        console: [...state.console, { kind: 'input-prompt', text: state.pendingInput, value }],
      };
      // NB: the typed value is NOT pushed into queuedInputs. queuedInputs is
      // the pre-scripted Edit-Inputs dialog model; folding live answers into
      // it makes the NEXT run replay this answer instead of prompting again.
      // The grading pass gets the live answers separately (engine-adapter
      // collects them per run and appends them to the Pedal job's inputs).
    });
    resolve?.(value);
  },
  cancelConsoleInput: () => {
    consoleInputResolver = null;
    set({ pendingInput: null });
  },
  setClearInputs: (clear) => set({ clearInputs: clear }),
  toggleRenderImages: () => set((state) => ({ renderImages: !state.renderImages })),
  toggleAutocomplete: () =>
    set((state) => {
      const next = !state.autocomplete;
      writeStoredFlag(AUTOCOMPLETE_KEY, next);
      return { autocomplete: next };
    }),
  toggleFileTree: () =>
    set((state) => {
      const next = !state.fileTree;
      writeStoredFlag(FILE_TREE_KEY, next);
      return { fileTree: next };
    }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage unavailable — the theme still applies for this session.
    }
    applyThemeAttribute(theme);
    set({ theme });
  },
  setFocusedMode: (on) => set({ focusedMode: on }),
  toggleDocsPanel: () =>
    set((state) => {
      const next = !state.docsPanel;
      writeStoredFlag(DOCS_PANEL_KEY, next);
      return { docsPanel: next };
    }),
  toggleBlockKeyboardNav: () =>
    set((state) => {
      const next = !state.blockKeyboardNav;
      writeStoredFlag(KEYBOARD_NAV_KEY, next);
      return { blockKeyboardNav: next };
    }),
  setPasscode: (passcode) => set({ passcode }),
  setDirtySubmission: (dirty) => set({ dirtySubmission: dirty }),
  setEvalState: (evalState) => set({ evalState }),
  appendDevConsole: (entry) =>
    set((state) => ({
      devConsole: [...state.devConsole, entry],
      devUnseen: state.activeConsole === 'student' ? state.devUnseen + 1 : state.devUnseen,
    })),
  clearDevConsole: () => set({ devConsole: [], devUnseen: 0 }),
  setActiveConsole: (which) =>
    set(
      which === 'dev'
        ? { activeConsole: which, devUnseen: 0 }
        : { activeConsole: which, consoleUnseen: 0 },
    ),
  requestPromptedShare: () => set({ promptedShare: true }),
  setInstructionsOverride: (instructions) => set({ instructionsOverride: instructions }),
  clearPromptedShare: () => set({ promptedShare: false }),
}));
