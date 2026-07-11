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

export interface EditorChromeState {
  pythonMode: DualEditorMode;
  historyMode: boolean;
  runState: RunState;
  console: ConsoleEntry[];
  feedback: FeedbackState;

  setPythonMode(mode: DualEditorMode): void;
  toggleHistoryMode(): void;
  setRunState(state: RunState): void;
  appendConsole(entry: ConsoleEntry): void;
  clearConsole(): void;
  setFeedback(feedback: FeedbackState): void;
  clearFeedback(): void;
}

const EMPTY_FEEDBACK: FeedbackState = {
  category: null,
  label: '',
  message: 'Ready',
};

export const useEditorChromeStore = create<EditorChromeState>((set) => ({
  pythonMode: 'split',
  historyMode: false,
  runState: 'idle',
  console: [],
  feedback: EMPTY_FEEDBACK,

  setPythonMode: (mode) => set({ pythonMode: mode }),
  toggleHistoryMode: () =>
    set((state) => ({ historyMode: !state.historyMode })),
  setRunState: (runState) => set({ runState }),
  appendConsole: (entry) =>
    set((state) => ({ console: [...state.console, entry] })),
  clearConsole: () => set({ console: [] }),
  setFeedback: (feedback) => set({ feedback }),
  clearFeedback: () => set({ feedback: EMPTY_FEEDBACK }),
}));
