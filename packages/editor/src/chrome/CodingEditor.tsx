/**
 * The coding-problem editor surface - assembles the A8 §1 rows: header/
 * instructions + quick menu (Row 1), console + feedback (Row 2), file tabs
 * (Row 3), the Python toolbar + dual editor (Row 4), and the status footer
 * (Row 5), inside the parchment `.blockpy-content` frame.
 *
 * Execution is abstracted behind `RunController` so the chrome stays
 * engine-agnostic; the app supplies an `@blockpy/engine` adapter.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { format, parse, type Role, type Space, type Vfs } from '@blockpy/vfs';
import { categoryPresentation } from './categories';
import { DualEditorView } from '../components/DualEditorView';
import type { DualEditor } from '../dual/dual-editor';
import { TOOLBOXES, type ToolboxSpec } from '../dual/toolboxes';
import { Console } from './Console';
import { DevConsole } from './DevConsole';
import { CsvEditor } from './CsvEditor';
import { parseCsv } from './csv';
import { Dialog } from './Dialog';
import { DocsPanel } from './DocsPanel';
import { Feedback } from './Feedback';
import { JsonEditor } from './JsonEditor';
import { FileTabs } from './FileTabs';
import { FileTree } from './FileTree';
import { Icon } from './icons';
import { ImageEditor } from './ImageEditor';
import { Footer, type FooterProps } from './Footer';
import { editEvents, HistoryToolbar, type HistoryEntry } from './History';
import { HistoryDiffView } from '../components/HistoryDiffView';
import { ImagesManager, type UploadsController } from './ImagesManager';
import { Instructions, renderInstructions } from './Instructions';
import { PythonToolbar } from './PythonToolbar';
import { convertIpynbToPython, downloadPlan, triggerBrowserDownload } from './file-transfer';
import { QuickMenu, type QuickMenuProps } from './QuickMenu';
import { SettingsEditor, type AssignmentFields } from './SettingsEditor';
import { TraceExplorer } from './TraceExplorer';
import { useEditorChromeStore, type FeedbackState, type TraceStepView } from './store';

/**
 * Resolve the legacy `toolbox` settings key (A4: enum normal/ct/ct2/minimal/
 * full/custom, default "normal") to a toolbox spec. `custom` reads
 * `?toolbox.blockpy` as JSON; parse failure falls back to `empty` exactly
 * like legacy `reloadToolbox`.
 */
export function resolveToolboxSetting(setting: string | undefined, vfs?: Vfs): ToolboxSpec {
  if (!setting) return 'normal';
  if (setting === 'custom') {
    try {
      const raw = vfs?.read('?toolbox.blockpy');
      if (!raw) return 'empty';
      return JSON.parse(raw) as ToolboxSpec;
    } catch {
      return 'empty';
    }
  }
  return setting in TOOLBOXES ? setting : 'normal';
}

export interface RunHandlers {
  stdout(text: string): void;
  stderr(text: string): void;
  /**
   * Interactive input() (spec §6.5): show an input line in the console and
   * resolve with what the user submits. The run stays suspended (JSPI)
   * until then. Absent = the legacy scripted-inputs-then-EOFError model.
   */
  onInput?(prompt: string): Promise<string>;
  /**
   * System/diagnostic messages (engine boot, grader lifecycle) and
   * instructor-code output - NOT student program output. Routed to the
   * footer status area and the instructor-only dev console, never the
   * student console.
   */
  system?(text: string): void;
  /**
   * Internal grading error (Pedal system_error / environment failure): the
   * full grader traceback. Surfaces as the quick-menu bug icon → dialog
   * (LD-36) in addition to the `system` dev-console routing.
   */
  systemError?(traceback: string): void;
}

export interface RunOptions {
  /** Collect the E3 trace during this run (powers the Trace explorer). */
  trace?: boolean;
  /** Queued stdin lines replayed into the run (compat-mode input, M1.3.4). */
  inputs?: string[];
  /**
   * The instructor grading script for THIS run - the current `!on_run.py`
   * from the VFS, so instructor edits take effect immediately. Empty string
   * = no grader. `undefined` = caller has no VFS; the controller may fall
   * back to a statically configured script.
   */
  onRun?: string;
  /**
   * Files staged into the student run's working directory, prefix-stripped
   * (the student search-order view, A1 §4a - what `open()` can reach).
   */
  files?: Record<string, string>;
  /** Files staged for the grading job (instructor view; A1 §3). */
  graderFiles?: Record<string, string>;
  /**
   * Legacy `disable_feedback` (engine.js:115): the controller must skip the
   * grading pass even when an `onRun` script exists.
   */
  disableFeedback?: boolean;
  /**
   * `allow_real_requests` setting (M3.5): the engine skips the requests
   * mock and lets the real package hit the network (CORS best-effort).
   */
  allowRealRequests?: boolean;
  /** Legacy `disable_tifa` setting → BlockPyEnvironment skip_tifa. */
  disableTifa?: boolean;
  /** Legacy `disable_instructor_run` setting → skip_run (no sandbox run). */
  disableInstructorRun?: boolean;
  /** Pool-question seed (legacy currentSeed = poolSeed || submission.id). */
  seed?: string;
}

/** Graphic extensions served by the ImageEditor tab body (M4.5, LD-27). */
const IMAGE_FILE = /\.(png|jpe?g|gif|bmp)$/i;

/** Legacy countTestCases tallies - the Intervention `unitTests` block (A2). */
export interface UnitTestCounts {
  tests: number;
  feedbacks: number;
  successes: number;
  feedbackSuccess: number;
}

/** Resolved grading verdict - the legacy SUCCESS/SCORE/HIDE triple (§14.3). */
export interface GradeResult {
  /** RAW success of THIS run (the wire `correct`; monotonic OR is display). */
  success: boolean;
  /** Unclamped resolver score; the submission sync clamps + maxes it. */
  score: number;
  /** Legacy HIDE: suppress the verdict and block markCorrect. */
  hideCorrectness: boolean;
  /** Feedback tallies for the Intervention event (feedback.js:341-368). */
  unitTests?: UnitTestCounts;
}

/**
 * Event-log hook (spec §14.4): the chrome fires this at the legacy logEvent
 * call sites; the app layer forwards to the `logEvent` endpoint. Signature
 * mirrors legacy `BlockPyServer.logEvent`.
 */
export type LogEventFn = (
  eventType: string,
  category: string,
  label: string,
  message: string,
  filePath: string,
  extended?: boolean,
) => void;

export interface RunOutcome {
  /** Traceback/error text, or null on success. */
  error: string | null;
  /** Pedal feedback to show, if the run produced any. */
  feedback?: FeedbackState | null;
  /** Grading verdict when an instructor grader actually resolved (§14.3). */
  grade?: GradeResult | null;
  /** Trace buffer when the run collected one. */
  trace?: TraceStepView[];
  /** Base64 PNGs of matplotlib figures the run produced (§10.2). */
  images?: string[];
  /**
   * Pedal questions (on_run.js:74-76): replaces the instructions pane
   * (legacy set_instructions) when a grader emitted instructions feedback.
   */
  instructions?: string | null;
  /**
   * First error line from the winning feedback's DATA['location']
   * (feedback.js findFirstErrorLine) - drives editor-error-line.
   */
  errorLine?: number | null;
}

/** Per-evaluation options for the on_eval grading pass (on_eval.js). */
export interface EvalOptions {
  /** The instructor `!on_eval.py` script; empty/absent = no grading. */
  onEval?: string;
  /** Legacy disable_feedback: skip the grading pass. */
  disableFeedback?: boolean;
  /** Instructor staging view (grader helper imports). */
  graderFiles?: Record<string, string>;
}

export interface EvalOutcome {
  /** repr() of the expression, or null when it errored. */
  value: string | null;
  error: string | null;
  /** on_eval grading results (on_eval.js success: presentFeedback + POST). */
  feedback?: FeedbackState | null;
  grade?: GradeResult | null;
  instructions?: string | null;
}

export interface RunController {
  run(code: string, handlers: RunHandlers, options?: RunOptions): Promise<RunOutcome>;
  /** REPL evaluation against the persistent run namespace (§6.4). */
  evaluate?(expression: string, handlers: RunHandlers, options?: EvalOptions): Promise<EvalOutcome>;
  stop?(): void;
}

export interface CodingEditorProps {
  assignmentName?: string;
  instructions?: string;
  startingCode?: string;
  runController?: RunController;
  enableBlocks?: boolean;
  readOnly?: boolean;
  blocklyMediaPath?: string;
  toolbox?: ToolboxSpec;
  /** Legacy `toolbox` settings key (overrides `toolbox` when set). */
  toolboxSetting?: string;
  /** File system driving the tab strip; `answer.py` is the working file. */
  vfs?: Vfs;
  role?: Role;
  /**
   * Legacy `display.instructor` (the "View as instructor" toggle): shows
   * the dev console and the footer's force-load input.
   */
  instructor?: boolean;
  /** Legacy `hide_evaluate` setting: never offer the console Evaluate. */
  hideEvaluate?: boolean;
  /**
   * `enable_autocomplete` ASSIGNMENT setting (M7.2; Studio extension -
   * default off). Reversed from the M3.3 per-user toggle by maintainer
   * decision 2026-07-14: instructors opt an assignment in via the Settings
   * tab; there is no student-facing toggle.
   */
  enableAutocomplete?: boolean;
  /**
   * Legacy `disable_feedback` setting (engine.js:115): skip the instructor
   * grading pass entirely - runs report only their own success/errors.
   */
  disableFeedback?: boolean;
  /** `allow_real_requests` setting (M3.5): real network for `requests`. */
  allowRealRequests?: boolean;
  /** Legacy `disable_tifa` setting (skips the static analyzer). */
  disableTifa?: boolean;
  /** Legacy `disable_instructor_run` setting (grader sandbox not run). */
  disableInstructorRun?: boolean;
  /** Pool-question seed - legacy currentSeed = poolSeed ?? submission.id. */
  seed?: string;
  /**
   * Assignment-level columns shown in the Settings form (M3.5); the section
   * renders only when provided.
   */
  assignmentFields?: AssignmentFields;
  /**
   * The Settings form saved: persist the blob + edited assignment columns
   * (legacy saveAssignmentSettings → save_assignment).
   */
  onSaveSettings?: (blob: string, fields: AssignmentFields) => void;
  /**
   * Legacy `hide_files` setting (A4: defaults TRUE) - gates the whole files
   * UI for students: the tab strip, the tree rail, and Add New (legacy
   * files.visible/addIsVisible, blockpy.js:913-917).
   */
  hideFiles?: boolean;
  /**
   * Legacy `preload_all_files` setting: forces the files UI visible even
   * under hide_files (legacy files.visible ORs it in, blockpy.js:914).
   */
  preloadAllFiles?: boolean;
  /**
   * Fetch the submission's event log (legacy `loadHistory` endpoint). The
   * History button is enabled only when provided (`isHistoryAvailable`).
   */
  loadHistory?: () => Promise<HistoryEntry[]>;
  /** `assignment.hidden` - filters X-Submission.LMS rows (history.js). */
  assignmentHidden?: boolean;
  onCodeChange?: (code: string) => void;
  /**
   * Any writable file changed through the editor - the autosave hook
   * (legacy createFileSubscription, server.js:114-134).
   */
  onFileEdit?: (filename: string, contents: string) => void;
  /**
   * Run is starting: legacy saves answer.py IMMEDIATELY here (run.js:13),
   * before execution.
   */
  onRunStart?: (code: string) => void;
  /**
   * A grader resolved for this run. Fired AFTER the feedback is presented
   * (legacy presentFeedback-first ordering, on_run.js:162-175); the app
   * layer runs the §14.3 updateSubmission → markCorrect sequence.
   */
  onGraded?: (grade: GradeResult) => void;
  /** ProgSnap2 event stream hook (§14.4, A2) - see LogEventFn. */
  onLogEvent?: LogEventFn;
  /**
   * Receive the live DualEditor (null on unmount) - the app layer uses
   * `blockEditor.getPng()` for the updateSubmission image payload (§14.3).
   */
  onEditorReady?: (editor: DualEditor | null) => void;
  /**
   * Uploaded-files server actions - `images.blockpy` tabs render the
   * ImagesManager instead of a code editor when provided.
   */
  uploads?: UploadsController;
  /** Legacy provideRatings (= !assignment.hidden) - feedback thumbs. */
  provideRatings?: boolean;
  /**
   * `docs_url` setting (M4.3; STUDIO EXTENSION, LD-25): a markdown
   * reference document rendered in the collapsible right-hand Docs panel.
   * Empty/undefined hides the affordance entirely.
   */
  docsUrl?: string;
  /** submission.score (0-1) for the instructor feedback header. */
  submissionScore?: number;
  /** Legacy ui.feedback.resetScore (blockpy.js:784-788). */
  onResetScore?: () => void;
  /** Quick-menu wiring (Row 1 right column); `onRun` is supplied here. */
  quickMenu?: Omit<QuickMenuProps, 'onRun'>;
  /**
   * Footer identity/callbacks (Row 5). The footer always renders - legacy
   * hides it only under `small_layout`, which lands with the settings
   * wiring.
   */
  footer?: FooterProps;
}

export function CodingEditor(props: CodingEditorProps) {
  // Destructured props (M5.1): the hooks below close over these
  // individually, so their dep arrays satisfy exhaustive-deps without
  // depending on the whole `props` object.
  const {
    vfs,
    onCodeChange,
    onFileEdit,
    onGraded,
    onRunStart,
    onLogEvent,
    runController,
    hideEvaluate,
    enableAutocomplete,
    disableFeedback,
    allowRealRequests,
    disableTifa,
    disableInstructorRun,
    seed,
    loadHistory,
    startingCode,
    assignmentHidden,
  } = props;
  const role: Role = props.role ?? 'student';
  const [activeFile, setActiveFile] = useState('answer.py');
  const [code, setCode] = useState(() => vfs?.read('answer.py') ?? startingCode ?? '');
  const editorRef = useRef<DualEditor | null>(null);
  const store = useEditorChromeStore;
  const pythonMode = useEditorChromeStore((state) => state.pythonMode);
  const instructionsOverride = useEditorChromeStore((state) => state.instructionsOverride);
  const fileTreeOn = useEditorChromeStore((state) => state.fileTree);
  // Keyed remount = new assignment: grader-set instructions reset (legacy
  // set_instructions persisted only until the next load).
  useEffect(() => {
    store.getState().setInstructionsOverride(null);
  }, [store]);
  // Legacy files.visible (blockpy.js:913-917): the WHOLE files UI - tab
  // strip, tree rail, Add New - shows for instructors, un-hidden
  // assignments, or when preload_all_files forces it. hide_files defaults
  // TRUE (A4 §5), so default student assignments have no files UI (M7.2 -
  // the always-visible strip was the regression).
  const filesVisible =
    (props.instructor ?? false) || !(props.hideFiles ?? true) || (props.preloadAllFiles ?? false);
  // Tree rail gating (M3.7): user toggle AND files.visible, with a VFS.
  const showFileTree = fileTreeOn && Boolean(props.vfs) && filesVisible;
  // Docs panel gating (M4.3): assignment provides docs_url AND the
  // persisted user toggle is on.
  const docsPanelOn = useEditorChromeStore((state) => state.docsPanel);
  const showDocs = Boolean(props.docsUrl) && docsPanelOn;
  // Structured-editor escape hatch (M4.4): csv/json tabs get grid/JSON
  // editors unless the user drops to raw text; resets on file switch.
  const [rawStructured, setRawStructured] = useState(false);
  useEffect(() => setRawStructured(false), [activeFile]);
  const traceVisible = useEditorChromeStore((state) => state.traceVisible);
  const activeConsole = useEditorChromeStore((state) => state.activeConsole);
  const historyMode = useEditorChromeStore((state) => state.historyMode);
  // History mode state: the loaded event log and the selected edit event.
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyError, setHistoryError] = useState(false);

  // -- focused editor mode (M4.2; Studio extension, exam-friendly) ----------
  // Hides instructions/quick-menu/file-strip (App hides the group nav off
  // the same store flag); console + feedback live in a collapsible bottom
  // drawer whose feedback badge stays visible while collapsed.
  const focusedMode = useEditorChromeStore((state) => state.focusedMode);
  // Drawer defaults OPEN (M7.6, amends LD-24): console + feedback visible on
  // focus entry; the user can still collapse to the slim bar.
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [instructionsOverlay, setInstructionsOverlay] = useState(false);
  const feedback = useEditorChromeStore((state) => state.feedback);
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const setFocused = useCallback(
    (on: boolean) => {
      if (store.getState().focusedMode === on) return;
      store.getState().setFocusedMode(on);
      setDrawerOpen(true);
      setInstructionsOverlay(false);
      onLogEvent?.(
        on ? 'X-Display.Focus.Enter' : 'X-Display.Focus.Exit',
        '',
        '',
        '',
        activeFileRef.current,
      );
    },
    [store, onLogEvent],
  );
  // Esc leaves; Ctrl+Alt+F toggles (documented on the toolbar button).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && store.getState().focusedMode) {
        setFocused(false);
      } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFocused(!store.getState().focusedMode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, setFocused]);
  // Leaving the editor (assignment switch) always restores the chrome.
  useEffect(() => () => store.getState().setFocusedMode(false), [store]);

  // Leaving instructor view forfeits the dev console slot (and keeps the
  // unseen counters coherent for the next visit).
  useEffect(() => {
    if (!props.instructor && store.getState().activeConsole === 'dev') {
      store.getState().setActiveConsole('student');
    }
  }, [props.instructor, store]);

  // Only answer.py gets the block/split modes; every other file is a plain
  // text file (legacy python.js forces TEXT for non-answer files).
  const isAnswerFile = activeFile === 'answer.py';
  const fileReadOnly = (props.readOnly ?? false) || (vfs ? !vfs.canEdit(activeFile, role) : false);

  const handleSelectFile = useCallback(
    (legacyName: string) => {
      setActiveFile(legacyName);
      if (vfs) {
        setCode(vfs.read(legacyName) ?? '');
      }
      // History versions are per-file (legacy isEditEvent matches
      // display.filename()); switching files leaves history mode.
      store.getState().setHistoryMode(false);
    },
    [vfs, store],
  );

  // -- file management (M3.7 / LD-21) ---------------------------------------
  // Legacy context: Delete existed (python.js:117-123); Rename was DEAD
  // (files.js:518-528 references an undefined variable); namespace was only
  // chosen at creation. Prompts follow the legacy plain-prompt convention
  // (ImagesManager rename).

  const handleDeleteFile = useCallback(
    (legacyName: string) => {
      if (!vfs) return;
      if (!window.confirm(`Are you sure you want to delete ${legacyName}?`)) {
        return;
      }
      if (vfs.delete(legacyName)) {
        onLogEvent?.('X-File.Delete', '', '', '', legacyName);
        if (legacyName === activeFile) handleSelectFile('answer.py');
      }
    },
    [vfs, activeFile, handleSelectFile, onLogEvent],
  );

  const handleRenameFile = useCallback(
    (legacyName: string) => {
      if (!vfs) return;
      const { space, basename } = parse(legacyName);
      const next = window.prompt(`Rename ${legacyName} to:`, basename);
      if (!next || next === basename) return;
      if (vfs.rename(legacyName, next)) {
        onLogEvent?.('X-File.Rename', '', '', next, legacyName);
        if (legacyName === activeFile) handleSelectFile(format(space, next));
      } else {
        window.alert('Could not rename the file (protected name, or the target already exists).');
      }
    },
    [vfs, activeFile, handleSelectFile, onLogEvent],
  );

  const handleMoveFile = useCallback(
    (legacyName: string) => {
      if (!vfs) return;
      const PREFIX_TO_SPACE: Record<string, Space> = {
        '!': 'instructor',
        '?': 'hidden',
        '&': 'readonly',
        '^': 'starting',
        '': 'student',
      };
      const answer = window.prompt(
        `Move ${legacyName} to which namespace?\n` +
          '! = instructor (inaccessible)   ? = hidden (programmatic)\n' +
          '& = read-only   ^ = starting   (blank = student)',
        '',
      );
      if (answer === null) return;
      const target = PREFIX_TO_SPACE[answer.trim()];
      if (target === undefined) {
        window.alert(`Unknown namespace "${answer}".`);
        return;
      }
      const { basename } = parse(legacyName);
      if (vfs.changeSpace(legacyName, target)) {
        onLogEvent?.('X-File.Move', '', '', target, legacyName);
        if (legacyName === activeFile) {
          handleSelectFile(format(target, basename));
        }
      } else {
        window.alert('Could not move the file (protected name, or the target already exists).');
      }
    },
    [vfs, activeFile, handleSelectFile, onLogEvent],
  );

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      if (vfs && !fileReadOnly) {
        vfs.write(activeFile, newCode);
        // Autosave hook (legacy file subscriptions, server.js:114-134).
        onFileEdit?.(activeFile, newCode);
      }
      if (activeFile === 'answer.py') {
        // Any answer edit stales the last run's feedback (feedback.js:110).
        store.getState().setDirtySubmission(true);
        onCodeChange?.(newCode);
      }
    },
    [onCodeChange, onFileEdit, vfs, activeFile, fileReadOnly, store],
  );

  // -- local upload/download (M7.4, LD-39) -----------------------------------
  // Upload writes the chosen file into the ACTIVE tab through the normal
  // change path (VFS + autosave + dirty ride along); .ipynb converts via the
  // legacy port. Unlike legacy (python.js:462), no auto-run. Download saves
  // the current code under the legacy naming rules.
  const handleUpload = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        let contents = typeof reader.result === 'string' ? reader.result : '';
        if (file.name.endsWith('.ipynb')) {
          try {
            contents = convertIpynbToPython(contents);
          } catch {
            // Unparseable notebook JSON - fall back to the raw text.
          }
        }
        onLogEvent?.('X-File.Upload', '', '', contents, activeFile);
        handleCodeChange(contents);
      };
      reader.readAsText(file);
    },
    [activeFile, handleCodeChange, onLogEvent],
  );
  const handleDownload = useCallback(() => {
    const contents = vfs ? (vfs.read(activeFile) ?? code) : code;
    const { downloadName, mimetype } = downloadPlan(activeFile, props.assignmentName);
    onLogEvent?.('X-File.Download', '', '', '', downloadName);
    triggerBrowserDownload(contents, downloadName, mimetype);
  }, [vfs, activeFile, code, onLogEvent, props.assignmentName]);

  // Live toolbox reload on settings change (legacy `reloadToolbox`).
  const toolboxSpec = props.toolboxSetting
    ? resolveToolboxSetting(props.toolboxSetting, vfs)
    : (props.toolbox ?? 'normal');
  const lastToolbox = useRef(toolboxSpec);
  useEffect(() => {
    if (lastToolbox.current !== toolboxSpec && editorRef.current) {
      lastToolbox.current = toolboxSpec;
      editorRef.current.blockEditor.remakeToolbox(toolboxSpec);
    }
  }, [toolboxSpec]);

  // `enable_autocomplete` assignment setting → live CM6 reconfigure (M7.2;
  // default off - an ASSIGNMENT setting, not a user toggle).
  useEffect(() => {
    editorRef.current?.setAutocomplete(enableAutocomplete ?? false);
  }, [enableAutocomplete]);

  // Blockly keyboard navigation (M6.2, LD-30; default off, persisted).
  const keyboardNavOn = useEditorChromeStore((state) => state.blockKeyboardNav);
  useEffect(() => {
    editorRef.current?.setKeyboardNav(keyboardNavOn);
  }, [keyboardNavOn]);

  // System messages (engine boot, grader lifecycle, instructor output) go
  // to the footer status line + the instructor-only dev console - never the
  // student console.
  const handleSystem = useCallback(
    (text: string) => {
      const state = store.getState();
      const message = text.replace(/\n+$/, '');
      state.appendDevConsole({ kind: 'stdout', text: message });
      state.setServerStatus('onExecution', 'active', message);
    },
    [store],
  );

  const handleRun = useCallback(async () => {
    const controller = runController;
    const { setRunState, appendConsole, clearConsole, setFeedback } = store.getState();
    clearConsole();
    // A fresh run clears the previous internal-grading-error state - the bug
    // icon disappears until a grader failure sets it again (LD-36; parity
    // with legacy clearing the icon per grade, feedback.js:269).
    store.getState().setGraderError(null);
    if (!controller) {
      appendConsole({
        kind: 'stderr',
        text: 'No execution engine attached to this editor.',
      });
      return;
    }
    setRunState('running');
    store.getState().setServerStatus('onExecution', 'active', '');
    // Snapshot the queued inputs for THIS run, then clear the queue
    // immediately unless reuse is on - legacy clears at run START
    // (run.js:37 → configurations.js clearInput), so inputs queued while a
    // run is in flight are never wiped by its completion.
    const runInputs = store.getState().queuedInputs;
    if (store.getState().clearInputs) {
      store.getState().setQueuedInputs([]);
    }
    // Run always executes the student's answer.py, regardless of which
    // file tab is active (legacy behavior).
    const studentCode = vfs ? (vfs.read('answer.py') ?? '') : code;
    // Legacy saves answer.py immediately at run start (run.js:13) and logs
    // the Compile event (run.js:14).
    onRunStart?.(studentCode);
    onLogEvent?.('Compile', '', '', '', 'answer.py');
    try {
      const outcome = await controller.run(
        studentCode,
        {
          stdout: (text) => appendConsole({ kind: 'stdout', text }),
          stderr: (text) => appendConsole({ kind: 'stderr', text }),
          // input() suspends on the console's input line (§6.5).
          onInput: (prompt) => store.getState().requestConsoleInput(prompt),
          system: handleSystem,
          // Internal grading errors light the quick-menu bug icon (LD-36).
          systemError: (traceback) => store.getState().setGraderError(traceback),
        },
        {
          trace: true,
          inputs: runInputs,
          disableFeedback: disableFeedback,
          allowRealRequests: allowRealRequests,
          disableTifa: disableTifa,
          disableInstructorRun: disableInstructorRun,
          seed: seed,
          // Grade with the CURRENT !on_run.py - instructor edits to the On
          // Run tab apply on the very next run (§7: the VFS is the source
          // of truth) - and stage the live VFS into both jobs: the student
          // search-order view for open() etc., the instructor view for
          // grader helper imports (A1 §3/§4a).
          ...(vfs
            ? {
                onRun: vfs.read('!on_run.py') ?? '',
                files: vfs.stageFiles('student'),
                graderFiles: vfs.stageFiles('instructor'),
              }
            : {}),
        },
      );
      const succeeded = outcome.error === null;
      setRunState(succeeded ? 'idle' : 'error');
      store.getState().setServerStatus('onExecution', succeeded ? 'ready' : 'failed', '');
      if (outcome.error !== null) {
        appendConsole({ kind: 'stderr', text: outcome.error });
      }
      // Run outcome events (run.js:48, 83-85): success carries the
      // {inputs, outputs} JSON; runtime errors are Run.Program with the
      // ProgramErrorOutput category; syntax errors are Compile.Error.
      if (succeeded) {
        const outputs = store
          .getState()
          .console.filter((entry) => entry.kind === 'stdout')
          .map((entry) => entry.text)
          .join('')
          .replace(/\n$/, '');
        onLogEvent?.(
          'Run.Program',
          '',
          '',
          JSON.stringify({ inputs: runInputs.join('\n'), outputs }),
          'answer.py',
        );
      } else if (outcome.feedback?.category === 'syntax') {
        onLogEvent?.('Compile.Error', '', '', outcome.error ?? '', 'answer.py');
      } else {
        onLogEvent?.('Run.Program', 'ProgramErrorOutput', '', outcome.error ?? '', 'answer.py');
      }
      // Plots print into the console flow as image lines (§10.2).
      for (const image of outcome.images ?? []) {
        appendConsole({ kind: 'image', text: `data:image/png;base64,${image}` });
      }
      if (outcome.feedback) {
        setFeedback(outcome.feedback);
        // Intervention logs with the presentation (feedback.js:223-230);
        // the unitTests block comes from the resolver tallies when a
        // grader actually ran.
        const category = outcome.feedback.category ?? '';
        onLogEvent?.(
          'Intervention',
          category,
          outcome.feedback.label,
          JSON.stringify({
            message: outcome.feedback.message,
            syntaxError: category.toLowerCase() === 'syntax',
            runtimeError: category.toLowerCase() === 'runtime',
            unitTests: outcome.grade?.unitTests ?? {
              tests: 0,
              feedbacks: 0,
              successes: 0,
              feedbackSuccess: 0,
            },
          }),
          'answer.py',
          true,
        );
      }
      // Questions support (on_run.js:74-76): a grader's instructions
      // feedback REPLACES the instructions pane (legacy set_instructions).
      if (outcome.instructions) {
        store.getState().setInstructionsOverride(outcome.instructions);
      }
      // First-error-line highlight from the winning feedback's location
      // (feedback.js:242-246): cleared on every presentation, set when the
      // grader pinned a line.
      editorRef.current?.clearHighlightedLines('editor-error-line');
      if (outcome.errorLine != null) {
        editorRef.current?.setHighlightedLines([outcome.errorLine], 'editor-error-line');
      }
      // §14.3 ordering: the verdict reaches the submission lifecycle only
      // AFTER the feedback is presented (on_run.js:162-175).
      if (outcome.grade) {
        onGraded?.(outcome.grade);
      }
      const after = store.getState();
      after.setTrace(outcome.trace ?? []);
      // Run cycle end: feedback now matches the code (run.js:49).
      after.setDirtySubmission(false);
      // Successful run offers the console Evaluate button (run.js:57-59),
      // unless the hide_evaluate setting is on.
      if (succeeded && !(hideEvaluate ?? false)) {
        after.setEvalState('button');
      }
    } catch (error) {
      setRunState('error');
      store.getState().setServerStatus('onExecution', 'failed', String(error));
      appendConsole({ kind: 'stderr', text: String(error) });
    } finally {
      // A hard stop (interrupt/timeout) can leave the input line orphaned -
      // the run it belonged to is gone either way (§6.5).
      store.getState().cancelConsoleInput();
    }
  }, [
    code,
    vfs,
    runController,
    hideEvaluate,
    disableFeedback,
    allowRealRequests,
    // Latent staleness bug surfaced by the M5.1 destructure: these three
    // were missing, so mid-session settings changes didn't reach the run.
    disableTifa,
    disableInstructorRun,
    seed,
    onRunStart,
    onGraded,
    onLogEvent,
    store,
    handleSystem,
  ]);

  const handleEvaluate = useCallback(
    (expression: string) => {
      // The submitted expression is already frozen into the printer by the
      // Console (legacy keeps the disabled input line as the echo).
      const controller = runController;
      const { appendConsole, setServerStatus } = store.getState();
      if (!controller?.evaluate) {
        appendConsole({
          kind: 'stderr',
          text: 'No execution engine attached to this editor.',
        });
        return;
      }
      setServerStatus('onExecution', 'active', '');
      // Eval lifecycle events (eval.js:19-27): the expression joins the
      // virtual `evaluations` file, then compiles.
      onLogEvent?.('X-File.Add', '', '', expression, 'evaluations');
      onLogEvent?.('Compile', '', '', expression, 'evaluations');
      void controller
        .evaluate(
          expression,
          {
            stdout: (text) => appendConsole({ kind: 'stdout', text }),
            stderr: (text) => appendConsole({ kind: 'stderr', text }),
            system: handleSystem,
            // on_eval grader crashes light the bug icon too (LD-36).
            systemError: (traceback) => store.getState().setGraderError(traceback),
          },
          // on_eval grading (engine.js:146-156): runs only when the
          // assignment HAS an on_eval script and feedback isn't disabled -
          // the controller enforces both; we supply the live VFS script.
          {
            onEval: vfs ? (vfs.read('!on_eval.py') ?? '') : '',
            disableFeedback: disableFeedback,
            ...(vfs ? { graderFiles: vfs.stageFiles('instructor') } : {}),
          },
        )
        .then((outcome) => {
          store.getState().setServerStatus('onExecution', 'ready', '');
          if (outcome.error !== null) {
            appendConsole({ kind: 'stderr', text: outcome.error });
            // eval.js:57 - eval errors log as Compile.Error.
            onLogEvent?.('Compile.Error', '', '', outcome.error, 'evaluations');
          } else {
            onLogEvent?.('X-Evaluate.Program', '', '', '', 'evaluations');
            if (outcome.value !== null) {
              appendConsole({ kind: 'value', text: outcome.value });
            }
          }
          // on_eval feedback presents exactly like on_run's
          // (on_eval.js success: presentFeedback → updateSubmission).
          if (outcome.feedback) {
            store.getState().setFeedback(outcome.feedback);
            onLogEvent?.(
              'Intervention',
              outcome.feedback.category ?? '',
              outcome.feedback.label,
              JSON.stringify({
                message: outcome.feedback.message,
                syntaxError: false,
                runtimeError: false,
                unitTests: outcome.grade?.unitTests ?? {
                  tests: 0,
                  feedbacks: 0,
                  successes: 0,
                  feedbackSuccess: 0,
                },
              }),
              'answer.py',
              true,
            );
          }
          if (outcome.instructions) {
            store.getState().setInstructionsOverride(outcome.instructions);
          }
          if (outcome.grade) {
            onGraded?.(outcome.grade);
          }
        });
    },
    [runController, onLogEvent, onGraded, disableFeedback, vfs, store, handleSystem],
  );

  const handleTraceLine = useCallback((studentLine: number | null) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.clearHighlightedLines('editor-traced-line');
    if (studentLine !== null && studentLine > 0) {
      editor.setHighlightedLines([studentLine], 'editor-traced-line');
    }
  }, []);

  const handleStop = useCallback(() => {
    runController?.stop?.();
    store.getState().setRunState('idle');
  }, [runController, store]);

  // Legacy toggleHistoryMode (blockpy.js:1098-1104): off is immediate; on
  // fetches the log first and only then flips the mode (failure = dialog).
  const handleToggleHistory = useCallback(() => {
    if (!loadHistory) return;
    if (store.getState().historyMode) {
      store.getState().setHistoryMode(false);
      return;
    }
    void loadHistory()
      .then((entries) => {
        setHistoryEntries(entries);
        // Default selection: the most recent edit event (history.js:74).
        const edits = editEvents(entries, activeFile, assignmentHidden);
        setHistoryIndex(Math.max(0, edits.length - 1));
        store.getState().setHistoryMode(true);
      })
      .catch(() => setHistoryError(true));
  }, [loadHistory, assignmentHidden, activeFile, store]);

  // Legacy `use` (history.js:107-114): adopt the selected version, leave
  // history mode.
  const handleUseHistory = useCallback(() => {
    const edits = editEvents(historyEntries, activeFile, assignmentHidden);
    const selected = edits[historyIndex];
    if (!selected) return;
    store.getState().setHistoryMode(false);
    setCode(selected.message);
    if (vfs) {
      vfs.write(activeFile, selected.message);
    }
    if (activeFile === 'answer.py') {
      store.getState().setDirtySubmission(true);
      onCodeChange?.(selected.message);
    }
  }, [historyEntries, historyIndex, activeFile, assignmentHidden, onCodeChange, vfs, store]);

  const handleReset = useCallback(() => {
    // Reset restores answer.py to the starting code (`^starting_code.py`
    // when a VFS is attached - reset-to-`^` semantics, §7.4).
    const starting = vfs
      ? (vfs.read('^starting_code.py') ?? startingCode ?? '')
      : (startingCode ?? '');
    if (vfs) {
      vfs.write('answer.py', starting);
    }
    if (isAnswerFile) {
      setCode(starting);
      editorRef.current?.setCode(starting);
    }
    onLogEvent?.('X-File.Reset', '', '', '', 'answer.py');
  }, [startingCode, onLogEvent, vfs, isAnswerFile]);

  // X-View.Change on Blocks/Split/Text toggles (blockpy.js:1071-1075) -
  // logged on changes only, not the initial mode.
  const loggedMode = useRef(pythonMode);
  useEffect(() => {
    if (loggedMode.current !== pythonMode) {
      loggedMode.current = pythonMode;
      onLogEvent?.('X-View.Change', '', '', pythonMode, activeFile);
    }
  }, [pythonMode, activeFile, onLogEvent]);

  // Console + feedback pair (Row 2). In focused mode (M4.2) the same pair
  // renders inside the bottom drawer instead of the fixed second row.
  const consoleAndFeedback = (
    <div className="row">
      {props.instructor && activeConsole === 'dev' ? (
        <DevConsole onShowStudent={() => store.getState().setActiveConsole('student')} />
      ) : (
        <Console
          onEvaluate={handleEvaluate}
          onShowDev={props.instructor ? () => store.getState().setActiveConsole('dev') : undefined}
        />
      )}
      {traceVisible ? (
        <TraceExplorer onStepLine={handleTraceLine} />
      ) : (
        <Feedback
          instructor={props.instructor}
          score={props.submissionScore}
          onResetScore={props.onResetScore}
          onRate={
            props.provideRatings
              ? (rating) => {
                  // X-Rating carries the presented feedback's
                  // category/label (blockpy.js:797-800).
                  const current = store.getState().feedback;
                  onLogEvent?.('X-Rating', current.category ?? '', current.label, rating, '');
                }
              : undefined
          }
        />
      )}
    </div>
  );
  const feedbackBadge = categoryPresentation(feedback.category);

  return (
    <div className="blockpy-content container-fluid">
      {!focusedMode && (
        <div className="row">
          <Instructions
            // Pedal questions (on_run.js:74-76): grader-set instructions win
            // until the next assignment load (the mount effect clears them).
            markdown={instructionsOverride ?? props.instructions ?? ''}
            assignmentName={props.assignmentName}
          />
          <QuickMenu {...props.quickMenu} onRun={() => void handleRun()} />
        </div>
      )}
      {!focusedMode && (
        <div className="row">
          <div className="col-md-12">{consoleAndFeedback}</div>
        </div>
      )}
      {/* Row 3: the file strip renders only under legacy files.visible
          (M7.2 - hide_files defaults TRUE, so students see no strip unless
          the assignment opts in or preload_all_files forces it). */}
      {!focusedMode &&
        vfs &&
        filesVisible &&
        !(showFileTree && pythonMode === 'text' && !historyMode) && (
          <div className="row">
            <FileTabs
              vfs={vfs}
              role={role}
              activeFile={activeFile}
              onSelect={handleSelectFile}
              // addIsVisible = instructor || !hideFiles (blockpy.js:916-918;
              // hide_files defaults TRUE per A4 §5).
              addVisible={(props.instructor ?? false) || !(props.hideFiles ?? true)}
              instructor={props.instructor ?? false}
            />
          </div>
        )}
      <div className="row">
        {!focusedMode && showFileTree && vfs && (
          <div className="col-md-3 blockpy-panel blockpy-file-tree-rail">
            <div className="blockpy-panel-header">
              <strong>Files:</strong>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary blockpy-panel-header-action"
                title="Hide file tree"
                onClick={() => store.getState().toggleFileTree()}
              >
                <Icon name="fileTree" />
              </button>
            </div>
            <FileTree
              vfs={vfs}
              role={role}
              activeFile={activeFile}
              onSelect={handleSelectFile}
              instructor={props.instructor ?? false}
              onRename={handleRenameFile}
              onMove={props.instructor ? handleMoveFile : undefined}
              onDelete={handleDeleteFile}
            />
          </div>
        )}
        <div
          // Grid negotiation (M3.7 rails + M4.3 docs): 12 minus 3 per open
          // side panel; focused mode always takes the full width.
          className={`blockpy-panel blockpy-editor col-md-${
            focusedMode ? 12 : 12 - (showFileTree && vfs ? 3 : 0) - (showDocs ? 3 : 0)
          }`}
        >
          <PythonToolbar
            onRun={() => void handleRun()}
            onStop={handleStop}
            onReset={handleReset}
            enableBlocks={(props.enableBlocks ?? true) && isAnswerFile}
            onToggleFocus={() => setFocused(!focusedMode)}
            focusedMode={focusedMode}
            {...(props.docsUrl
              ? {
                  onToggleDocs: () => store.getState().toggleDocsPanel(),
                  docsOpen: showDocs,
                }
              : {})}
            onHistory={loadHistory ? handleToggleHistory : undefined}
            // Local upload/download (M7.4, LD-39). Upload respects the
            // read-only guard (D3-A: never overwrite an uneditable file).
            onUpload={fileReadOnly ? undefined : handleUpload}
            onDownload={handleDownload}
            // File actions for the ACTIVE file (M3.7 / LD-21), gated by the
            // VFS capability guards + role editability.
            {...(vfs
              ? {
                  onDeleteFile: () => handleDeleteFile(activeFile),
                  onRenameFile: () => handleRenameFile(activeFile),
                  canDeleteFile: vfs.canDeleteName(activeFile) && vfs.canEdit(activeFile, role),
                  canRenameFile: vfs.canRenameName(activeFile) && vfs.canEdit(activeFile, role),
                }
              : {})}
          />
          {historyMode && (
            <HistoryToolbar
              entries={historyEntries}
              filename={activeFile}
              index={historyIndex}
              onSelect={setHistoryIndex}
              onUse={handleUseHistory}
              assignmentHidden={assignmentHidden}
            />
          )}
          {historyMode ? (
            <HistoryDiffView
              original={
                editEvents(historyEntries, activeFile, assignmentHidden)[historyIndex]?.message ??
                ''
              }
              current={code}
              height={400}
            />
          ) : activeFile.endsWith('images.blockpy') && props.uploads ? (
            // Legacy editor dispatch by extension (images.js: extensions
            // ["images.blockpy"]) - the uploaded-files manager replaces the
            // code editor for this tab.
            <ImagesManager uploads={props.uploads} instructor={props.instructor} />
          ) : activeFile === '!assignment_settings.blockpy' ? (
            // The Settings tab is a FORM over the settings blob, not a text
            // editor (M3.5; legacy ASSIGNMENT_SETTINGS_EDITOR_HTML port).
            <SettingsEditor
              key={vfs ? activeFile : `${activeFile}-plain`}
              blob={vfs?.read(activeFile) ?? code}
              assignment={props.assignmentFields}
              onSave={(blob, fields) => {
                if (vfs) {
                  vfs.write(activeFile, blob);
                  onFileEdit?.(activeFile, blob);
                }
                setCode(blob);
                props.onSaveSettings?.(blob, fields);
              }}
            />
          ) : !rawStructured && IMAGE_FILE.test(activeFile) ? (
            // M4.5 (LD-27): image preview + sprite pixel editor. The
            // editable representation is the file's VFS contents as a
            // data-URL; uploads stay in the ImagesManager.
            <ImageEditor
              key={activeFile}
              value={code}
              readOnly={fileReadOnly}
              onChange={handleCodeChange}
              onRawView={() => setRawStructured(true)}
            />
          ) : !rawStructured &&
            activeFile.toLowerCase().endsWith('.csv') &&
            parseCsv(code) !== null ? (
            // M4.4 (LD-26): grid editor for parseable CSV tabs; unparseable
            // content falls through to the text editor. `&`-space read-only
            // rides fileReadOnly (D3-A).
            <CsvEditor
              key={activeFile}
              value={code}
              readOnly={fileReadOnly}
              onChange={handleCodeChange}
              onRawView={() => setRawStructured(true)}
            />
          ) : !rawStructured && activeFile.toLowerCase().endsWith('.json') ? (
            // M4.4 (LD-26): CM6 JSON editor with live parse status + tree.
            <JsonEditor
              key={activeFile}
              value={code}
              readOnly={fileReadOnly}
              onChange={handleCodeChange}
              onRawView={() => setRawStructured(true)}
            />
          ) : (
            <div
              className="blockpy-python-blockmirror"
              // X-Editor.Paste (python.js:238-248) with REAL character
              // counts - legacy's shadowed `const characters` always
              // logged {characters: 0} (LD-2a; trustworthy from Studio on).
              onPaste={(event) => {
                let characters = 0;
                try {
                  characters = event.clipboardData.getData('Text').length;
                } catch {
                  // Clipboard unreadable - log the 0 like legacy's catch.
                }
                onLogEvent?.('X-Editor.Paste', '', '', JSON.stringify({ characters }), activeFile);
              }}
            >
              {rawStructured &&
                (activeFile.toLowerCase().endsWith('.csv') ||
                  activeFile.toLowerCase().endsWith('.json') ||
                  IMAGE_FILE.test(activeFile)) && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary blockpy-structured-return"
                    onClick={() => setRawStructured(false)}
                  >
                    Back to{' '}
                    {activeFile.toLowerCase().endsWith('.csv')
                      ? 'Grid'
                      : IMAGE_FILE.test(activeFile)
                        ? 'Image'
                        : 'JSON'}{' '}
                    Editor
                  </button>
                )}
              <DualEditorView
                // Height is construction-time config - the key remounts the
                // editor taller for focused mode (code survives via props).
                key={focusedMode ? 'focused' : 'normal'}
                mode={isAnswerFile ? pythonMode : 'text'}
                code={code}
                onCodeChange={handleCodeChange}
                readOnly={fileReadOnly}
                blocklyMediaPath={props.blocklyMediaPath}
                toolbox={toolboxSpec}
                height={focusedMode ? Math.max(500, window.innerHeight - 220) : 400}
                editorRef={(editor) => {
                  editorRef.current = editor;
                  // Apply the configured/persisted preferences to the fresh
                  // editor (the effects only fire on later changes).
                  if (editor && enableAutocomplete) {
                    editor.setAutocomplete(true);
                  }
                  if (editor && store.getState().blockKeyboardNav) {
                    editor.setKeyboardNav(true);
                  }
                  props.onEditorReady?.(editor);
                }}
              />
            </div>
          )}
        </div>
        {/* Docs browser rail (M4.3; renders only when docs_url is set and
            the persisted toggle is on). */}
        {!focusedMode && showDocs && props.docsUrl && (
          <div className="col-md-3 blockpy-panel blockpy-docs-rail">
            <DocsPanel url={props.docsUrl} onCollapse={() => store.getState().toggleDocsPanel()} />
          </div>
        )}
      </div>
      {/* Focused-mode bottom drawer (M4.2): a slim bar with the feedback
          badge always visible; expanding reveals the console + feedback
          pair that normally lives in Row 2. */}
      {focusedMode && (
        <div className="row blockpy-focus-drawer">
          <div className="col-md-12">
            <div className="blockpy-focus-drawer-bar">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary blockpy-focus-drawer-toggle"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(!drawerOpen)}
              >
                {drawerOpen ? 'Hide Console & Feedback' : 'Console & Feedback'}
              </button>
              <span
                role="button"
                tabIndex={0}
                className={`badge blockpy-focus-feedback-badge ${feedbackBadge.badgeClass}`}
                title="Show feedback"
                onClick={() => setDrawerOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    setDrawerOpen(true);
                  }
                }}
              >
                {feedbackBadge.displayText || 'Ready'}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary blockpy-focus-instructions"
                onClick={() => setInstructionsOverlay(true)}
              >
                Instructions
              </button>
            </div>
            {drawerOpen && consoleAndFeedback}
          </div>
        </div>
      )}
      {/* Focused-mode instructions overlay (M4.2): the pane is hidden, not
          gone - same markdown pipeline as the Instructions component. Only
          mounted while open (the markdown pass is per-render). */}
      {focusedMode && instructionsOverlay && (
        <Dialog
          title={props.assignmentName ?? 'Instructions'}
          visible
          onClose={() => setInstructionsOverlay(false)}
          onOkay={() => setInstructionsOverlay(false)}
          okayLabel="Close"
        >
          <div
            className="blockpy-instructions"
            // D4-A: legacy renders instructor HTML unsanitized.
            dangerouslySetInnerHTML={{
              __html: renderInstructions(instructionsOverride ?? props.instructions ?? ''),
            }}
          />
        </Dialog>
      )}
      <Dialog
        title="Error Loading History"
        visible={historyError}
        onClose={() => setHistoryError(false)}
      >
        BlockPy encountered an error while loading your history.
        <br />
        Please reload the page and try again.
      </Dialog>
      <div className="row">
        <Footer instructor={props.instructor} {...props.footer} />
      </div>
    </div>
  );
}
