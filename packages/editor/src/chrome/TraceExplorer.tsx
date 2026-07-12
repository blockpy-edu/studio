/**
 * Trace / State Explorer — Row 2 right, shown in place of the feedback pane
 * (legacy `ui.secondRow.isTraceVisible`; A8 §1 TRACE_HTML markup:
 * `.blockpy-trace.col-md-6` with the step control strip and the
 * Name/Type/Value variables table). Data: the engine's E3 trace buffer.
 *
 * The legacy Type column came from Skulpt value types; the engine's compact
 * trace snapshots are repr strings only, so Type derives best-effort from
 * the repr (a §6.7-style display delta, not a wire change).
 */
import { useEffect } from 'react';
import { Icon } from './icons';
import { useEditorChromeStore } from './store';

/** Best-effort type name from a repr string (display only). */
export function typeFromRepr(repr: string): string {
  if (/^-?\d+$/.test(repr)) return 'int';
  if (/^-?\d*\.\d+(e-?\d+)?$/i.test(repr)) return 'float';
  if (/^(True|False)$/.test(repr)) return 'bool';
  if (repr === 'None') return 'NoneType';
  if (/^['"]/.test(repr)) return 'str';
  if (repr.startsWith('[')) return 'list';
  if (repr.startsWith('{') && repr.includes(':')) return 'dict';
  if (repr.startsWith('{')) return 'set';
  if (repr.startsWith('(')) return 'tuple';
  const instance = /^<(\w+)/.exec(repr);
  return instance ? instance[1]! : '';
}

export interface TraceExplorerProps {
  /** Highlight the step's student line in the editor (traced-line style). */
  onStepLine?: (studentLine: number | null) => void;
}

export function TraceExplorer({ onStepLine }: TraceExplorerProps) {
  const steps = useEditorChromeStore((state) => state.traceSteps);
  const current = useEditorChromeStore((state) => state.traceStep);
  const setTraceStep = useEditorChromeStore((state) => state.setTraceStep);
  const setTraceVisible = useEditorChromeStore((state) => state.setTraceVisible);
  const step = steps[current];

  useEffect(() => {
    onStepLine?.(step ? step.studentLine : null);
    return () => onStepLine?.(null);
  }, [step, onStepLine]);

  const locals = step?.locals ?? {};
  return (
    <div className="blockpy-trace col-md-6 blockpy-panel">
      {/* Flex header, same fix as the Feedback pane (M3.2 gap). */}
      <div className="blockpy-panel-header">
        <strong>Trace: </strong>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary blockpy-panel-header-action blockpy-hide-trace"
          onClick={() => setTraceVisible(false)}
        >
          <Icon name="eye" /> Hide Trace
        </button>
      </div>
      {steps.length === 0 ? (
        <p>Run your program to record a trace.</p>
      ) : (
        <>
          <div className="input-group mb-3 blockpy-trace-controls">
            <div className="input-group-prepend">
              <button
                type="button"
                className="btn btn-outline-secondary"
                aria-label="First step"
                onClick={() => setTraceStep(0)}
              >
                <Icon name="stepFirst" />
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                aria-label="Previous step"
                onClick={() => setTraceStep(current - 1)}
              >
                <Icon name="stepBack" />
              </button>
              <span className="input-group-text">Step:</span>
              <span className="input-group-text">
                {current + 1} / {steps.length}
              </span>
            </div>
            <div className="input-group-append">
              <button
                type="button"
                className="btn btn-outline-secondary"
                aria-label="Next step"
                onClick={() => setTraceStep(current + 1)}
              >
                <Icon name="stepForward" />
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                aria-label="Last step"
                onClick={() => setTraceStep(steps.length - 1)}
              >
                <Icon name="stepLast" />
              </button>
              <span className="input-group-text">
                Line {step?.studentLine ?? '—'}
              </span>
            </div>
          </div>
          <p>Variables after this step:</p>
          <table className="table table-sm table-striped table-bordered table-hover">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(locals).map(([name, repr]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{typeFromRepr(repr)}</td>
                  <td>
                    <code>{repr}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
