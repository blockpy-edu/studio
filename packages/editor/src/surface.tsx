/**
 * AssignmentSurface — the single composition/nesting mechanism (spec §12).
 *
 * Every assignment component (editor, reader, quizzer, textbook) renders
 * inside a surface that carries the OWNING assignment's identity: nested
 * editors in a reading log against the reading; a subordinate quiz logs
 * against the quiz's own id — matching legacy, where each knockout
 * AssignmentInterface built payloads from its own loaded pair.
 *
 * Variants describe how the surface is presented:
 *   - 'full'     — a top-level assignment body (group page, standalone).
 *   - 'embedded' — hosted by another assignment (preamble reading,
 *                  subordinate quiz, textbook page).
 *   - 'minified' — a §8.4 minified editor hydrated inside content.
 *
 * Depth guard: authored content can cycle (a reading whose quiz preambles
 * the same reading, …). Legacy had no guard because the compositions were
 * hand-wired; the deepest legitimate chain is depth 3 (group page → quiz →
 * preamble reading → minified editors), so a surface deeper than 3 refuses
 * to render its children and warns on the console.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { RunController } from './chrome/CodingEditor';

export type SurfaceVariant = 'full' | 'embedded' | 'minified';

export type SurfaceLogEvent = (
  eventType: string,
  category: string,
  label: string,
  message: string,
  filePath: string,
) => void;

export interface AssignmentSurfaceValue {
  /** The owning assignment/submission pair — null until the surface's
   *  component has loaded its own pair. */
  assignmentId: number | null;
  submissionId: number | null;
  variant: SurfaceVariant;
  /** 0 = outside any surface; each provider is parent depth + 1. */
  depth: number;
  /** Event sink already bound to the OWNING pair's ids (§12, §14.4). */
  logEvent?: SurfaceLogEvent | undefined;
  /** The page-shared engine (§6; readings hydrate many minified editors
   *  against one engine). */
  runController?: RunController | undefined;
}

export const MAX_SURFACE_DEPTH = 3;

const ROOT_SURFACE: AssignmentSurfaceValue = {
  assignmentId: null,
  submissionId: null,
  variant: 'full',
  depth: 0,
};

const AssignmentSurfaceContext = createContext<AssignmentSurfaceValue>(ROOT_SURFACE);

/** The nearest enclosing surface (the root sentinel outside any provider). */
export function useAssignmentSurface(): AssignmentSurfaceValue {
  return useContext(AssignmentSurfaceContext);
}

export interface AssignmentSurfaceProps {
  /** Omitted fields inherit from the enclosing surface, so a 'minified'
   *  child surface attributes events to its hosting reading by default. */
  assignmentId?: number | null;
  submissionId?: number | null;
  variant?: SurfaceVariant;
  logEvent?: SurfaceLogEvent;
  runController?: RunController;
  children?: ReactNode;
}

export function AssignmentSurface(props: AssignmentSurfaceProps) {
  const parent = useContext(AssignmentSurfaceContext);
  const depth = parent.depth + 1;
  const value = useMemo<AssignmentSurfaceValue>(
    () => ({
      assignmentId: props.assignmentId !== undefined ? props.assignmentId : parent.assignmentId,
      submissionId: props.submissionId !== undefined ? props.submissionId : parent.submissionId,
      variant: props.variant ?? parent.variant,
      depth,
      logEvent: props.logEvent ?? parent.logEvent,
      runController: props.runController ?? parent.runController,
    }),
    [
      props.assignmentId,
      props.submissionId,
      props.variant,
      props.logEvent,
      props.runController,
      parent,
      depth,
    ],
  );
  if (depth > MAX_SURFACE_DEPTH) {
    console.warn(
      `BlockPy: refusing to nest assignment surfaces beyond depth ${MAX_SURFACE_DEPTH} ` +
        `(assignment ${String(value.assignmentId)}) — the authored content may contain a cycle.`,
    );
    return null;
  }
  return (
    <AssignmentSurfaceContext.Provider value={value}>
      {props.children}
    </AssignmentSurfaceContext.Provider>
  );
}
