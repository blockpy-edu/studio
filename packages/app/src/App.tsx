import { useMemo, useState } from 'react';
import { CodingEditor } from '@blockpy/editor';
import { Vfs } from '@blockpy/vfs';
import { createEngineRunController } from './engine-adapter';
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
  const [, setCode] = useState('a = 0\nprint(a)');
  // "View as instructor" (legacy display.instructor). The dev harness
  // always exposes the grader toggle for debugging.
  const [instructorView, setInstructorView] = useState(display.instructor);
  const instructions =
    'Print the value of `a`.\n\nUse the **Run** button to execute:\n\n' +
    '```python\na = 0\nprint(a)\n```';
  const vfs = useMemo(() => {
    const files = new Vfs();
    files.write('answer.py', 'a = 0\nprint(a)');
    files.write('^starting_code.py', 'a = 0\nprint(a)');
    files.write('!instructions.md', instructions);
    files.write('&sample_data.txt', 'temperature,42\nhumidity,13\n');
    return files;
  }, [instructions]);
  const runController = useMemo(
    () =>
      createEngineRunController({
        indexURL: paths.pyodideIndexURL,
        // Dev-harness grader (a real `!on_run.py`-style Pedal script).
        onRunScript: [
          'from pedal import *',
          'if get_output() == ["0"]:',
          '    set_success()',
          'else:',
          '    gently("Try printing the value of a.", label="printing_a")',
          '',
        ].join('\n'),
      }),
    [paths.pyodideIndexURL],
  );
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
        instructions={instructions}
        vfs={vfs}
        role={instructorView ? 'instructor' : 'student'}
        instructor={instructorView}
        onCodeChange={setCode}
        readOnly={display.readOnly}
        blocklyMediaPath={paths.blocklyMedia}
        runController={runController}
        quickMenu={{
          grader: true,
          instructor: instructorView,
          onInstructorChange: setInstructorView,
          hasClock: true,
        }}
        footer={{
          identity: {
            userId: user.id ?? undefined,
            userName: user.name,
            userRole: user.role,
            courseId: user.courseId ?? undefined,
            groupId: assignment.assignmentGroupId ?? undefined,
            assignmentId: assignment.currentAssignmentId ?? undefined,
            editorVersion: '0.1.0',
          },
        }}
      />
    </main>
  );
}
