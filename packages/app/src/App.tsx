import { useState } from 'react';
import { CodingEditor } from '@blockpy/editor';
import '@blockpy/editor/styles/tokens.css';
import '@blockpy/editor/styles/bootstrap-subset.css';
import '@blockpy/editor/styles/blockpy.css';
import type { BootConfig } from './boot-config';

/**
 * Application shell. Scaffold placeholder: renders a config summary plus a
 * live dual editor (Milestone 1.4 dev harness) so the pipeline can be
 * exercised end-to-end in a browser. AssignmentHost (spec §5.3) replaces
 * the body in Milestone 2.1.
 */
export function App({ config }: { config: BootConfig }) {
  const { user, assignment, display, paths } = config;
  const [code, setCode] = useState('a = 0\nprint(a)');
  return (
    <main>
      <p style={{ fontSize: 'smaller' }}>
        Dev harness — {user.name ?? 'anonymous'} ({user.role});{' '}
        {assignment.currentAssignmentId ?? 'no assignment'};{' '}
        {display.instructor ? 'instructor' : 'student'} view. AssignmentHost
        replaces this shell in Milestone 2.1.
      </p>
      <h1 className="sr-only">BlockPy Studio</h1>
      <CodingEditor
        assignmentName="Dev Harness Problem"
        instructions={
          'Print the value of `a`.\n\nUse the **Run** button to execute.'
        }
        startingCode={code}
        onCodeChange={setCode}
        readOnly={display.readOnly}
        blocklyMediaPath={paths.blocklyMedia}
      />
    </main>
  );
}
