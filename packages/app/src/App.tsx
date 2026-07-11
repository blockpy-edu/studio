import { useState } from 'react';
import { DualEditorView, type DualEditorMode } from '@blockpy/editor';
import type { BootConfig } from './boot-config';

/**
 * Application shell. Scaffold placeholder: renders a config summary plus a
 * live dual editor (Milestone 1.4 dev harness) so the pipeline can be
 * exercised end-to-end in a browser. AssignmentHost (spec §5.3) replaces
 * the body in Milestone 2.1.
 */
export function App({ config }: { config: BootConfig }) {
  const { user, assignment, display, group, paths, settings } = config;
  const [mode, setMode] = useState<DualEditorMode>(
    (settings['settings-start_view'] as DualEditorMode) || 'split',
  );
  const [code, setCode] = useState('a = 0\nprint(a)');
  return (
    <main>
      <h1>BlockPy Studio</h1>
      <p>Scaffold shell — assignment dispatch lands in Milestone 2.1.</p>
      <dl>
        <dt>User</dt>
        <dd>
          {user.name ?? 'anonymous'} ({user.role})
        </dd>
        <dt>Current assignment</dt>
        <dd>{assignment.currentAssignmentId ?? 'none'}</dd>
        <dt>Group</dt>
        <dd>{group ? `${group.assignments.length} assignment(s)` : 'none'}</dd>
        <dt>Mode</dt>
        <dd>
          {display.instructor ? 'instructor' : 'student'}
          {display.readOnly ? ', read-only' : ''}
          {display.embed ? ', embedded' : ''}
        </dd>
      </dl>
      <section>
        <h2>Dual editor (M1.4 dev harness)</h2>
        <div role="group" aria-label="View mode">
          {(['block', 'split', 'text'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={mode === m}
              type="button"
            >
              {m}
            </button>
          ))}
        </div>
        <DualEditorView
          mode={mode}
          code={code}
          onCodeChange={setCode}
          readOnly={display.readOnly}
          blocklyMediaPath={paths.blocklyMedia}
          height={400}
        />
        <details>
          <summary>Generated code</summary>
          <pre>{code}</pre>
        </details>
      </section>
    </main>
  );
}
