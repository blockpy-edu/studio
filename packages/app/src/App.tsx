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
  const vfs = useMemo(() => {
    const files = new Vfs();
    files.write('answer.py', 'a = 0\nprint(a)');
    files.write('^starting_code.py', 'a = 0\nprint(a)');
    files.write(
      '!instructions.md',
      'Print the value of `a`.\n\nUse the **Run** button to execute.',
    );
    files.write('&sample_data.txt', 'temperature,42\nhumidity,13\n');
    return files;
  }, []);
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
        instructions={
          'Print the value of `a`.\n\nUse the **Run** button to execute.'
        }
        vfs={vfs}
        role={display.instructor ? 'instructor' : 'student'}
        onCodeChange={setCode}
        readOnly={display.readOnly}
        blocklyMediaPath={paths.blocklyMedia}
        runController={runController}
      />
    </main>
  );
}
