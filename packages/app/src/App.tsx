import type { BootConfig } from './boot-config';

/**
 * Application shell. Scaffold placeholder: renders a config summary so the
 * dev harness and embed builds can be verified end-to-end. AssignmentHost
 * (spec §5.3) replaces the body in Milestone 2.1.
 */
export function App({ config }: { config: BootConfig }) {
  const { user, assignment, display, group } = config;
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
    </main>
  );
}
