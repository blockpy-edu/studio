/**
 * AssignmentHost (spec §5.3) - replaces editor.html's `mainModel` +
 * `loadAssignmentWrapper` (editor.html:304-338). Behavior preserved exactly:
 *
 * - Type dispatch by typeIndex membership in the legacy priority order
 *   quiz → reading → textbook → java → kettle(typescript) → explain →
 *   blockpy; unknown ids fall through to the editor (the fallback renderer).
 * - Non-blockpy types hide the coding editor (legacy `editor.hide()` - the
 *   container stays mounted) and mount the matching component; the six
 *   non-blockpy "current id" slots are reset on EVERY dispatch (only the
 *   active type keeps its id), which is what makes components unmount and
 *   remount rather than reload in place.
 * - The blockpy current id is set only in the editor branch's async
 *   completion (`whenDone`, editor.html:323-330) - viewing a quiz does NOT
 *   null it (legacy leaves it untouched in that branch).
 * - `loadAssignment(id): Promise<void>` is the modern
 *   `altAssignmentChangingFunction`; the host publishes the global (§15.3).
 *
 * The quiz/reading/textbook/kettle/explain bodies are placeholders until
 * Milestones 2.2-2.4 land their packages; java renders its tombstone
 * message verbatim (editor.html:159).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AssignmentTypeIndex } from './boot-config';

export type AssignmentType =
  'quiz' | 'reading' | 'textbook' | 'java' | 'typescript' | 'explain' | 'blockpy';

const NON_BLOCKPY_TYPES = ['quiz', 'reading', 'textbook', 'java', 'typescript', 'explain'] as const;

/**
 * Membership classification in the legacy priority order
 * (editor.html:305-320). Unknown ids classify as 'blockpy' - the editor is
 * the fallback renderer and surfaces its own load errors.
 */
export function classifyAssignment(id: number, typeIndex: AssignmentTypeIndex): AssignmentType {
  if (typeIndex.quiz.includes(id)) return 'quiz';
  if (typeIndex.reading.includes(id)) return 'reading';
  if (typeIndex.textbook.includes(id)) return 'textbook';
  if (typeIndex.java.includes(id)) return 'java';
  if (typeIndex.typescript.includes(id)) return 'typescript';
  if (typeIndex.explain.includes(id)) return 'explain';
  return 'blockpy';
}

/**
 * URL contract (§5.3): assignment switches update `assignment_id` in place
 * (preserving `assignment_group_id`, `assignment_group_url`, `embed`, …)
 * via history.replaceState - only outside embeds.
 */
export function replaceAssignmentIdInUrl(id: number, embed: boolean): void {
  if (embed || typeof history === 'undefined' || typeof location === 'undefined') return;
  const url = new URL(location.href);
  url.searchParams.set('assignment_id', String(id));
  history.replaceState(null, '', url.toString());
}

export interface AssignmentHostProps {
  typeIndex: AssignmentTypeIndex;
  embed?: boolean;
  /** The editor's async load (legacy `editor.loadAssignment(id)`). */
  loadEditorAssignment: (assignmentId: number) => Promise<void>;
  /** Receives the dispatch function once mounted (boot glue, bridge). */
  onReady?: (dispatch: (assignmentId: number) => Promise<void>) => void;
  /**
   * Per-type renderers (M2.3+ packages plug in here); a type without one
   * keeps its placeholder body. Keyed remount semantics are the host's.
   */
  renderAssignment?: Partial<
    Record<Exclude<AssignmentType, 'blockpy'>, (assignmentId: number) => ReactNode>
  >;
  /** The coding-editor surface - stays mounted, hidden for other types. */
  children: ReactNode;
}

type CurrentIds = Record<AssignmentType, number | null>;

const NO_IDS: CurrentIds = {
  quiz: null,
  reading: null,
  textbook: null,
  java: null,
  typescript: null,
  explain: null,
  blockpy: null,
};

/** Placeholder bodies until M2.2-2.4; java's tombstone is the real text. */
function typeBody(type: AssignmentType, id: number): ReactNode {
  if (type === 'java') {
    return 'Java assignments are no longer supported in BlockPy.';
  }
  const milestone = type === 'quiz' ? '2.4' : type === 'reading' ? '2.3' : '2.2+';
  return `${type} assignment ${id} loads here (Milestone ${milestone}).`;
}

export function AssignmentHost(props: AssignmentHostProps) {
  const [assignmentType, setAssignmentType] = useState<AssignmentType | null>(null);
  const [currentIds, setCurrentIds] = useState<CurrentIds>(NO_IDS);
  const [editorVisible, setEditorVisible] = useState(true);
  const latest = useRef(props);
  latest.current = props;

  const dispatch = useCallback(async (rawId: number) => {
    const { typeIndex, embed, loadEditorAssignment } = latest.current;
    const id = parseInt(String(rawId), 10);
    replaceAssignmentIdInUrl(id, embed ?? false);
    const type = classifyAssignment(id, typeIndex);
    const isBlockPy = typeIndex.blockpy.includes(id);
    // The six non-blockpy slots reset on EVERY dispatch
    // (editor.html:332-337) - the per-type remount semantics.
    setCurrentIds(
      (previous) =>
        ({
          ...Object.fromEntries(NON_BLOCKPY_TYPES.map((slot) => [slot, slot === type ? id : null])),
          blockpy: previous.blockpy, // untouched here (legacy)
        }) as CurrentIds,
    );
    if (type !== 'blockpy') {
      setEditorVisible(false); // editor.hide() - stays mounted
      setAssignmentType(type);
      return;
    }
    setEditorVisible(true); // editor.show()
    await loadEditorAssignment(id);
    // whenDone (editor.html:325-329): the type/blockpy-id flip waits for
    // the editor's async load; unknown ids leave the type null.
    setAssignmentType(isBlockPy ? 'blockpy' : null);
    setCurrentIds((previous) => ({ ...previous, blockpy: isBlockPy ? id : null }));
  }, []);

  useEffect(() => {
    latest.current.onReady?.(dispatch);
    // §15.3: the global alias navigation and course content call.
    const target = window as unknown as Record<string, unknown>;
    target['altAssignmentChangingFunction'] = dispatch;
    return () => {
      if (target['altAssignmentChangingFunction'] === dispatch) {
        delete target['altAssignmentChangingFunction'];
      }
    };
  }, [dispatch]);

  const activeType =
    assignmentType !== null && assignmentType !== 'blockpy' ? assignmentType : null;
  const activeId = activeType !== null ? currentIds[activeType] : null;
  return (
    <>
      <div className="blockpy-host-editor" style={editorVisible ? undefined : { display: 'none' }}>
        {props.children}
      </div>
      {activeType !== null && activeId !== null && (
        // Keyed by type+id: a different assignment remounts the component
        // rather than reloading in place (observable legacy behavior).
        <div
          key={`${activeType}-${activeId}`}
          className={`blockpy-host-type blockpy-host-${activeType}`}
        >
          {props.renderAssignment?.[activeType]?.(activeId) ?? typeBody(activeType, activeId)}
        </div>
      )}
    </>
  );
}
