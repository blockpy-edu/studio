// @vitest-environment jsdom
/**
 * AssignmentSurface conformance (spec §12): owning-id inheritance,
 * variant defaults, and the depth-3 nesting guard.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  AssignmentSurface,
  MAX_SURFACE_DEPTH,
  useAssignmentSurface,
  type AssignmentSurfaceValue,
} from './surface';

afterEach(cleanup);

function Probe({ onValue }: { onValue: (value: AssignmentSurfaceValue) => void }) {
  onValue(useAssignmentSurface());
  return <span>probe</span>;
}

describe('AssignmentSurface (§12)', () => {
  it('provides the root sentinel outside any provider', () => {
    let seen: AssignmentSurfaceValue | null = null;
    render(<Probe onValue={(value) => (seen = value)} />);
    expect(seen).toMatchObject({
      assignmentId: null,
      submissionId: null,
      variant: 'full',
      depth: 0,
    });
  });

  it('carries the owning pair and increments depth per surface', () => {
    let seen: AssignmentSurfaceValue | null = null;
    render(
      <AssignmentSurface assignmentId={7} submissionId={70} variant="full">
        <Probe onValue={(value) => (seen = value)} />
      </AssignmentSurface>,
    );
    expect(seen).toMatchObject({ assignmentId: 7, submissionId: 70, variant: 'full', depth: 1 });
  });

  it('inherits omitted fields so nested editors attribute to the owning assignment', () => {
    // §12: nested editors in a reading log against the READING.
    const logEvent = vi.fn();
    let seen: AssignmentSurfaceValue | null = null;
    render(
      <AssignmentSurface assignmentId={103} submissionId={5003} logEvent={logEvent}>
        <AssignmentSurface variant="minified">
          <Probe onValue={(value) => (seen = value)} />
        </AssignmentSurface>
      </AssignmentSurface>,
    );
    expect(seen).toMatchObject({
      assignmentId: 103,
      submissionId: 5003,
      variant: 'minified',
      depth: 2,
    });
    expect(seen!.logEvent).toBe(logEvent);
  });

  it('lets a child surface override the owning pair (subordinate quiz owns its ids)', () => {
    let seen: AssignmentSurfaceValue | null = null;
    render(
      <AssignmentSurface assignmentId={104} submissionId={5004}>
        <AssignmentSurface assignmentId={103} submissionId={5003} variant="embedded">
          <Probe onValue={(value) => (seen = value)} />
        </AssignmentSurface>
      </AssignmentSurface>,
    );
    expect(seen).toMatchObject({ assignmentId: 103, submissionId: 5003, variant: 'embedded' });
  });

  it('allows the deepest legitimate chain (group → quiz → preamble reading → minified)', () => {
    render(
      <AssignmentSurface assignmentId={1}>
        <AssignmentSurface assignmentId={2} variant="embedded">
          <AssignmentSurface variant="minified">
            <span>deepest</span>
          </AssignmentSurface>
        </AssignmentSurface>
      </AssignmentSurface>,
    );
    expect(screen.getByText('deepest')).toBeTruthy();
  });

  it(`refuses to render children beyond depth ${MAX_SURFACE_DEPTH} with a console warning`, () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      render(
        <AssignmentSurface assignmentId={1}>
          <AssignmentSurface assignmentId={2}>
            <AssignmentSurface assignmentId={3}>
              <AssignmentSurface assignmentId={4}>
                <span>too deep</span>
              </AssignmentSurface>
            </AssignmentSurface>
          </AssignmentSurface>
        </AssignmentSurface>,
      );
      expect(screen.queryByText('too deep')).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('beyond depth 3'));
    } finally {
      warn.mockRestore();
    }
  });
});
