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
import { useCallback, useRef, useState } from 'react';
import { DualEditorView } from '../components/DualEditorView';
import type { DualEditor } from '../dual/dual-editor';
import type { ToolboxSpec } from '../dual/toolboxes';
import { Console } from './Console';
import { Feedback } from './Feedback';
import { Instructions } from './Instructions';
import { PythonToolbar } from './PythonToolbar';
import { useEditorChromeStore, type FeedbackState } from './store';

export interface RunHandlers {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface RunOutcome {
  /** Traceback/error text, or null on success. */
  error: string | null;
  /** Pedal feedback to show, if the run produced any. */
  feedback?: FeedbackState | null;
}

export interface RunController {
  run(code: string, handlers: RunHandlers): Promise<RunOutcome>;
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
  onCodeChange?: (code: string) => void;
}

export function CodingEditor(props: CodingEditorProps) {
  const [code, setCode] = useState(props.startingCode ?? '');
  const editorRef = useRef<DualEditor | null>(null);
  const store = useEditorChromeStore;
  const pythonMode = useEditorChromeStore((state) => state.pythonMode);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      props.onCodeChange?.(newCode);
    },
    [props.onCodeChange],
  );

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
    try {
      const outcome = await controller.run(code, {
        stdout: (text) => appendConsole({ kind: 'stdout', text }),
        stderr: (text) => appendConsole({ kind: 'stderr', text }),
      });
      setRunState(outcome.error === null ? 'idle' : 'error');
      if (outcome.error !== null) {
        appendConsole({ kind: 'stderr', text: outcome.error });
      }
      if (outcome.feedback) {
        setFeedback(outcome.feedback);
      }
    } catch (error) {
      setRunState('error');
      appendConsole({ kind: 'stderr', text: String(error) });
    }
  }, [code, props.runController, store]);

  const handleStop = useCallback(() => {
    props.runController?.stop?.();
    store.getState().setRunState('idle');
  }, [props.runController, store]);

  const handleReset = useCallback(() => {
    const starting = props.startingCode ?? '';
    setCode(starting);
    editorRef.current?.setCode(starting);
  }, [props.startingCode]);

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
            <Console />
            <Feedback />
          </div>
        </div>
      </div>
      <div className="row">
        <div className="blockpy-panel blockpy-editor col-md-12">
          <PythonToolbar
            onRun={() => void handleRun()}
            onStop={handleStop}
            onReset={handleReset}
            enableBlocks={props.enableBlocks}
          />
          <div className="blockpy-python-blockmirror">
            <DualEditorView
              mode={pythonMode}
              code={code}
              onCodeChange={handleCodeChange}
              readOnly={props.readOnly}
              blocklyMediaPath={props.blocklyMediaPath}
              toolbox={props.toolbox}
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
