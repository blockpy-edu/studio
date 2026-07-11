/**
 * The coding-problem editor surface — assembles the A8 §1 rows that belong
 * to the editor: header/instructions (Row 1), console + feedback (Row 2),
 * and the Python toolbar + dual editor (Row 4), inside the parchment
 * `.blockpy-content` frame. File tabs (Row 3) and the footer (Row 5) land
 * with the VFS/file wiring.
 *
 * Execution is abstracted behind `RunController` so the chrome stays
 * engine-agnostic; the app supplies an `@blockpy/engine` adapter.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Role, Vfs } from '@blockpy/vfs';
import { DualEditorView } from '../components/DualEditorView';
import type { DualEditor } from '../dual/dual-editor';
import { TOOLBOXES, type ToolboxSpec } from '../dual/toolboxes';
import { Console } from './Console';
import { Feedback } from './Feedback';
import { FileTabs } from './FileTabs';
import { Instructions } from './Instructions';
import { PythonToolbar } from './PythonToolbar';
import { TraceExplorer } from './TraceExplorer';
import {
  useEditorChromeStore,
  type FeedbackState,
  type TraceStepView,
} from './store';

/**
 * Resolve the legacy `toolbox` settings key (A4: enum normal/ct/ct2/minimal/
 * full/custom, default "normal") to a toolbox spec. `custom` reads
 * `?toolbox.blockpy` as JSON; parse failure falls back to `empty` exactly
 * like legacy `reloadToolbox`.
 */
export function resolveToolboxSetting(
  setting: string | undefined,
  vfs?: Vfs,
): ToolboxSpec {
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
}

export interface RunOptions {
  /** Collect the E3 trace during this run (powers the Trace explorer). */
  trace?: boolean;
}

export interface RunOutcome {
  /** Traceback/error text, or null on success. */
  error: string | null;
  /** Pedal feedback to show, if the run produced any. */
  feedback?: FeedbackState | null;
  /** Trace buffer when the run collected one. */
  trace?: TraceStepView[];
}

export interface EvalOutcome {
  /** repr() of the expression, or null when it errored. */
  value: string | null;
  error: string | null;
}

export interface RunController {
  run(
    code: string,
    handlers: RunHandlers,
    options?: RunOptions,
  ): Promise<RunOutcome>;
  /** REPL evaluation against the persistent run namespace (§6.4). */
  evaluate?(expression: string, handlers: RunHandlers): Promise<EvalOutcome>;
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
  onCodeChange?: (code: string) => void;
}

export function CodingEditor(props: CodingEditorProps) {
  const { vfs } = props;
  const role: Role = props.role ?? 'student';
  const [activeFile, setActiveFile] = useState('answer.py');
  const [code, setCode] = useState(
    () => vfs?.read('answer.py') ?? props.startingCode ?? '',
  );
  const editorRef = useRef<DualEditor | null>(null);
  const store = useEditorChromeStore;
  const pythonMode = useEditorChromeStore((state) => state.pythonMode);
  const traceVisible = useEditorChromeStore((state) => state.traceVisible);

  // Only answer.py gets the block/split modes; every other file is a plain
  // text file (legacy python.js forces TEXT for non-answer files).
  const isAnswerFile = activeFile === 'answer.py';
  const fileReadOnly =
    (props.readOnly ?? false) || (vfs ? !vfs.canEdit(activeFile, role) : false);

  const handleSelectFile = useCallback(
    (legacyName: string) => {
      setActiveFile(legacyName);
      if (vfs) {
        setCode(vfs.read(legacyName) ?? '');
      }
    },
    [vfs],
  );

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      if (vfs && !fileReadOnly) {
        vfs.write(activeFile, newCode);
      }
      if (activeFile === 'answer.py') {
        props.onCodeChange?.(newCode);
      }
    },
    [props.onCodeChange, vfs, activeFile, fileReadOnly],
  );

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

  const handleRun = useCallback(async () => {
    const controller = props.runController;
    const { setRunState, appendConsole, clearConsole, setFeedback } =
      store.getState();
    clearConsole();
    if (!controller) {
      appendConsole({
        kind: 'stderr',
        text: 'No execution engine attached to this editor.',
      });
      return;
    }
    setRunState('running');
    // Run always executes the student's answer.py, regardless of which
    // file tab is active (legacy behavior).
    const studentCode = vfs ? (vfs.read('answer.py') ?? '') : code;
    try {
      const outcome = await controller.run(
        studentCode,
        {
          stdout: (text) => appendConsole({ kind: 'stdout', text }),
          stderr: (text) => appendConsole({ kind: 'stderr', text }),
        },
        { trace: true },
      );
      setRunState(outcome.error === null ? 'idle' : 'error');
      if (outcome.error !== null) {
        appendConsole({ kind: 'stderr', text: outcome.error });
      }
      if (outcome.feedback) {
        setFeedback(outcome.feedback);
      }
      store.getState().setTrace(outcome.trace ?? []);
    } catch (error) {
      setRunState('error');
      appendConsole({ kind: 'stderr', text: String(error) });
    }
  }, [code, vfs, props.runController, store]);

  const handleEvaluate = useCallback(
    (expression: string) => {
      const controller = props.runController;
      const { appendConsole } = store.getState();
      appendConsole({ kind: 'value', text: '>>> ' + expression });
      if (!controller?.evaluate) {
        appendConsole({
          kind: 'stderr',
          text: 'No execution engine attached to this editor.',
        });
        return;
      }
      void controller
        .evaluate(expression, {
          stdout: (text) => appendConsole({ kind: 'stdout', text }),
          stderr: (text) => appendConsole({ kind: 'stderr', text }),
        })
        .then((outcome) => {
          if (outcome.error !== null) {
            appendConsole({ kind: 'stderr', text: outcome.error });
          } else if (outcome.value !== null) {
            appendConsole({ kind: 'value', text: outcome.value });
          }
        });
    },
    [props.runController, store],
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
    props.runController?.stop?.();
    store.getState().setRunState('idle');
  }, [props.runController, store]);

  const handleReset = useCallback(() => {
    // Reset restores answer.py to the starting code (`^starting_code.py`
    // when a VFS is attached — reset-to-`^` semantics, §7.4).
    const starting = vfs
      ? (vfs.read('^starting_code.py') ?? props.startingCode ?? '')
      : (props.startingCode ?? '');
    if (vfs) {
      vfs.write('answer.py', starting);
    }
    if (isAnswerFile) {
      setCode(starting);
      editorRef.current?.setCode(starting);
    }
  }, [props.startingCode, vfs, isAnswerFile]);

  return (
    <div className="blockpy-content container-fluid">
      <div className="row">
        <Instructions
          markdown={props.instructions ?? ''}
          assignmentName={props.assignmentName}
        />
        <div className="col-md-3 blockpy-panel blockpy-quick-menu" role="menubar" />
      </div>
      <div className="row">
        <div className="col-md-12">
          <div className="row">
            <Console onEvaluate={handleEvaluate} />
            {traceVisible ? (
              <TraceExplorer onStepLine={handleTraceLine} />
            ) : (
              <Feedback />
            )}
          </div>
        </div>
      </div>
      {vfs && (
        <div className="row">
          <FileTabs
            vfs={vfs}
            role={role}
            activeFile={activeFile}
            onSelect={handleSelectFile}
          />
        </div>
      )}
      <div className="row">
        <div className="blockpy-panel blockpy-editor col-md-12">
          <PythonToolbar
            onRun={() => void handleRun()}
            onStop={handleStop}
            onReset={handleReset}
            enableBlocks={(props.enableBlocks ?? true) && isAnswerFile}
          />
          <div className="blockpy-python-blockmirror">
            <DualEditorView
              mode={isAnswerFile ? pythonMode : 'text'}
              code={code}
              onCodeChange={handleCodeChange}
              readOnly={fileReadOnly}
              blocklyMediaPath={props.blocklyMediaPath}
              toolbox={toolboxSpec}
              height={400}
              editorRef={(editor) => {
                editorRef.current = editor;
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
