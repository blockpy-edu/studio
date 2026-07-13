/**
 * Minified editor variant (§8.4) — the compact configuration hydrated into
 * reading code blocks (§11.2, M2.3): text-only by default (blocks optional),
 * short height, no file tabs, no instructions pane. Save/submit endpoints
 * are stripped (A7 §"runnable code blocks").
 *
 * Layout (maintainer, 2026-07-11): two columns — LEFT: output console above
 * the feedback area; RIGHT: the Run/Reset toolbar above the code editor.
 *
 * Unlike `CodingEditor`, ALL state is per-instance React state — a reading
 * page hydrates many of these at once (§16.3 budgets ten), so they must not
 * share the singleton chrome store. They DO share the page's engine through
 * a common `RunController`; each run executes in a detached namespace (the
 * engine gives every `student.run` job a fresh `__main__`, §6.4/M1.3.3).
 *
 * Event logging attaches to the READING assignment id — wired with the M2.3
 * reader (the logger does not exist in the chrome yet). The ephemeral-VFS
 * file staging for readings that reference data files also lands there.
 */
import { useCallback, useRef, useState } from 'react';
import { DualEditorView } from '../components/DualEditorView';
import type { DualEditor, DualEditorMode } from '../dual/dual-editor';
import { categoryPresentation } from './categories';
import { highlightCodeBlocks } from './highlight';
import { Icon } from './icons';
import type { RunController } from './CodingEditor';
import type { ConsoleEntry, FeedbackState } from './store';

export interface MinifiedEditorProps {
  /** The code block's contents (= its ephemeral `answer.py`). */
  initialCode: string;
  /** The page-shared engine controller. */
  runController?: RunController;
  /** Blocks are optional in readings (§8.4); default text-only. */
  mode?: DualEditorMode;
  /** Editor height — short by default. */
  height?: number;
  readOnly?: boolean;
  blocklyMediaPath?: string;
  onCodeChange?: (code: string) => void;
}

type MinifiedRunState = 'idle' | 'running' | 'error';

const READY_FEEDBACK: FeedbackState = {
  category: null,
  label: '',
  message: 'Ready',
};

export function MinifiedEditor(props: MinifiedEditorProps) {
  // Destructured props (M5.1): hook deps stay exact without depending
  // on the whole `props` object.
  const { runController, initialCode, onCodeChange } = props;
  const [code, setCode] = useState(initialCode);
  const [runState, setRunState] = useState<MinifiedRunState>('idle');
  const [output, setOutput] = useState<ConsoleEntry[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState>(READY_FEEDBACK);
  const editorRef = useRef<DualEditor | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  const handleRun = useCallback(async () => {
    const controller = runController;
    setOutput([]);
    setFeedback(READY_FEEDBACK);
    if (!controller) {
      setOutput([{ kind: 'stderr', text: 'No execution engine attached to this editor.' }]);
      return;
    }
    setRunState('running');
    const append = (entry: ConsoleEntry) => setOutput((existing) => [...existing, entry]);
    try {
      const outcome = await controller.run(codeRef.current, {
        stdout: (text) => append({ kind: 'stdout', text }),
        stderr: (text) => append({ kind: 'stderr', text }),
        // System messages have no dev console here; drop them quietly.
        system: () => {},
      });
      setRunState(outcome.error === null ? 'idle' : 'error');
      if (outcome.error !== null) {
        append({ kind: 'stderr', text: outcome.error });
      }
      for (const image of outcome.images ?? []) {
        append({ kind: 'image', text: `data:image/png;base64,${image}` });
      }
      if (outcome.feedback) {
        setFeedback(outcome.feedback);
        // Same LD-10 highlighting as the main feedback pane.
        setTimeout(() => {
          if (feedbackRef.current) highlightCodeBlocks(feedbackRef.current);
        }, 0);
      }
    } catch (error) {
      setRunState('error');
      append({ kind: 'stderr', text: String(error) });
    }
  }, [runController]);

  const handleStop = useCallback(() => {
    runController?.stop?.();
    setRunState('idle');
  }, [runController]);

  const handleReset = useCallback(() => {
    setCode(initialCode);
    editorRef.current?.setCode(initialCode);
    onCodeChange?.(initialCode);
  }, [initialCode, onCodeChange]);

  const running = runState === 'running';
  const presentation = categoryPresentation(feedback.category);
  return (
    // Carries .blockpy-content so every scoped color rule (parchment frame,
    // feedback label-* badges, button retheme) matches the full editor.
    <div className="blockpy-content blockpy-minified">
      <div className="blockpy-minified-left">
        <div
          className="blockpy-printer blockpy-printer-default blockpy-minified-printer"
          role="log"
          aria-label="Console"
        >
          {output.map((entry, i) => (
            <div
              key={i}
              className={
                entry.kind === 'image'
                  ? 'blockpy-printer-output blockpy-console-image-output'
                  : `blockpy-printer-output blockpy-printer-${entry.kind}`
              }
            >
              {entry.kind === 'image' ? (
                <img src={entry.text} alt="Plot output" />
              ) : entry.kind === 'stderr' ? (
                <span style={{ color: 'darkred' }}>{entry.text}</span>
              ) : (
                entry.text
              )}
            </div>
          ))}
        </div>
        <div className="blockpy-minified-feedback" aria-live="polite" aria-label="Feedback">
          <strong className="feedback-header">Feedback: </strong>
          <span
            className={`badge blockpy-feedback-category feedback-badge ${presentation.badgeClass}`}
          >
            {presentation.displayText}
          </span>
          {feedback.label && <strong className="blockpy-feedback-label"> {feedback.label}</strong>}
          <div
            ref={feedbackRef}
            className="blockpy-feedback-message"
            // D4-A: feedback HTML renders unsanitized, like the main pane.
            dangerouslySetInnerHTML={{ __html: feedback.message }}
          />
        </div>
      </div>
      <div className="blockpy-minified-right">
        <div className="blockpy-minified-toolbar btn-toolbar" role="toolbar">
          <div className="btn-group mr-2" role="group">
            <button
              type="button"
              className={
                'btn btn-sm blockpy-run notransition' +
                (running ? ' blockpy-run-running' : '') +
                (runState === 'error' ? ' blockpy-run-error' : '')
              }
              onClick={running ? handleStop : () => void handleRun()}
            >
              <Icon name={running ? 'stop' : 'run'} /> {running ? 'Stop' : 'Run'}
            </button>
          </div>
          <div className="btn-group" role="group">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={handleReset}
            >
              <Icon name="reset" /> Reset
            </button>
          </div>
        </div>
        <DualEditorView
          mode={props.mode ?? 'text'}
          toolbox="normal"
          // No block toolbox to align with in the compact variant — drop the
          // legacy text-mode indent sidebar.
          indentSidebar={false}
          code={code}
          onCodeChange={(newCode) => {
            setCode(newCode);
            onCodeChange?.(newCode);
          }}
          readOnly={props.readOnly}
          blocklyMediaPath={props.blocklyMediaPath}
          height={props.height ?? 120}
          editorRef={(editor) => {
            editorRef.current = editor;
          }}
        />
      </div>
    </div>
  );
}
