/**
 * Editor chrome state (zustand). Mirrors the slice of legacy Knockout
 * observables the Python editor chrome binds to: `display.pythonMode`,
 * `display.historyMode`, `ui.execute.isRunning`, console output, and the
 * feedback pane (`ui.feedback.*`).
 */
import { create } from 'zustand';
import type { DualEditorMode } from '../dual/dual-editor';

export interface ConsoleEntry {
  kind: 'stdout' | 'stderr' | 'input-prompt' | 'value' | 'image';
  text: string;
}

export interface FeedbackState {
  /** Pedal category (lowercased legacy vocabulary; null = no feedback). */
  category: string | null;
  label: string;
  /** HTML body — rendered unsanitized, D4-A legacy parity. */
  message: string;
}

export type RunState = 'idle' | 'running' | 'error';

/** Legacy `StatusState` enum (server.js:8-14). */
export type ServerStatusState =
  | 'ready'
  | 'active'
  | 'retrying'
  | 'failed'
  | 'offline';

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
  /** Clear queued inputs after each run (legacy `display.clearInputs`). */
  clearInputs: boolean;
  /** Render console images vs raw text (legacy `display.renderImages`). */
  renderImages: boolean;
  /** User-supplied passcode sent with every server payload (A7 §1). */
  passcode: string;
  /**
   * Whether feedback/output is stale relative to the code (legacy
   * `display.dirtySubmission`): true until a run completes, and again after
   * any edit.
   */
  dirtySubmission: boolean;

  setPythonMode(mode: DualEditorMode): void;
  toggleHistoryMode(): void;
  setRunState(state: RunState): void;
  appendConsole(entry: ConsoleEntry): void;
  clearConsole(): void;
  setFeedback(feedback: FeedbackState): void;
  clearFeedback(): void;
  setTrace(steps: TraceStepView[]): void;
  setTraceStep(index: number): void;
  setTraceVisible(visible: boolean): void;
  setServerStatus(
    endpoint: ServerEndpoint,
    status: ServerStatusState,
    message?: string,
  ): void;
  setQueuedInputs(inputs: string[]): void;
  setClearInputs(clear: boolean): void;
  toggleRenderImages(): void;
  setPasscode(passcode: string): void;
  setDirtySubmission(dirty: boolean): void;
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
  clearInputs: true,
  renderImages: true,
  passcode: '',
  dirtySubmission: true,

  setPythonMode: (mode) => set({ pythonMode: mode }),
  toggleHistoryMode: () =>
    set((state) => ({ historyMode: !state.historyMode })),
  setRunState: (runState) => set({ runState }),
  appendConsole: (entry) =>
    set((state) => ({ console: [...state.console, entry] })),
  clearConsole: () => set({ console: [] }),
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
  setClearInputs: (clear) => set({ clearInputs: clear }),
  toggleRenderImages: () =>
    set((state) => ({ renderImages: !state.renderImages })),
  setPasscode: (passcode) => set({ passcode }),
  setDirtySubmission: (dirty) => set({ dirtySubmission: dirty }),
}));
