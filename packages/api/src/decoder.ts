/**
 * Versioned assignment/submission decoder (spec §14.5): accepts every
 * payload the current server emits — including fields the rewrite doesn't
 * use — and round-trips unknown fields losslessly on save. The same
 * merge-over-raw pattern implements D5-B for the settings blob (LD-5).
 */

export interface RawRecord {
  [key: string]: unknown;
}

/** The assignment fields the client actually consumes. */
export interface DecodedAssignment {
  id: number | null;
  name: string;
  url: string;
  type: string;
  version: number;
  instructions: string;
  startingCode: string;
  onRun: string;
  onChange: string | null;
  onEval: string | null;
  extraInstructorFiles: string;
  extraStartingFiles: string;
  /** Raw JSON string of !assignment_settings.blockpy (parse separately). */
  settings: string;
  /**
   * Ownership (M7.9, LD-42): the client compares `courseId` against the
   * context's course to predict "editing will offer a fork" for
   * instructors (assignment.py:72-81 columns; save_assignment rejects
   * non-owner edits with `forkable: true`, helpers.py:55-60).
   */
  ownerId: number | null;
  courseId: number | null;
  forkedId: number | null;
  forkedVersion: number | null;
  /** The complete original payload — never discard (spec §14.5). */
  raw: RawRecord;
}

export interface DecodedSubmission {
  id: number | null;
  code: string;
  extraFiles: string;
  version: number;
  correct: boolean;
  score: number;
  raw: RawRecord;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const id = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function decodeAssignment(raw: RawRecord): DecodedAssignment {
  return {
    id: id(raw.id),
    name: str(raw.name),
    url: str(raw.url),
    type: str(raw.type, 'blockpy'),
    version: num(raw.version),
    instructions: str(raw.instructions),
    startingCode: str(raw.starting_code),
    onRun: str(raw.on_run),
    onChange: raw.on_change === null ? null : str(raw.on_change) || null,
    onEval: raw.on_eval === null ? null : str(raw.on_eval) || null,
    extraInstructorFiles: str(raw.extra_instructor_files),
    extraStartingFiles: str(raw.extra_starting_files),
    settings: str(raw.settings),
    ownerId: id(raw.owner_id),
    courseId: id(raw.course_id),
    forkedId: id(raw.forked_id),
    forkedVersion: id(raw.forked_version),
    raw,
  };
}

export function decodeSubmission(raw: RawRecord): DecodedSubmission {
  return {
    id: id(raw.id),
    code: str(raw.code),
    extraFiles: str(raw.extra_files),
    version: num(raw.version),
    correct: raw.correct === true,
    score: num(raw.score),
    raw,
  };
}

/**
 * Re-encode edits over the original payload: known-field edits map back to
 * their wire names; every unknown field survives byte-for-byte.
 */
export function encodeAssignment(decoded: DecodedAssignment): RawRecord {
  return {
    ...decoded.raw,
    id: decoded.id,
    name: decoded.name,
    url: decoded.url,
    type: decoded.type,
    version: decoded.version,
    instructions: decoded.instructions,
    starting_code: decoded.startingCode,
    on_run: decoded.onRun,
    on_change: decoded.onChange,
    on_eval: decoded.onEval,
    extra_instructor_files: decoded.extraInstructorFiles,
    extra_starting_files: decoded.extraStartingFiles,
    settings: decoded.settings,
  };
}

/**
 * D5-B (ledger LD-5): merge edited known settings keys over the original
 * settings blob so unregistered keys (`time_limit`, `protected_ip_ranges`,
 * `poolRandomness`, …) survive an instructor save — legacy destroyed them.
 */
export function mergeSettings(originalBlob: string, edits: RawRecord): string {
  let original: RawRecord = {};
  try {
    const parsed = JSON.parse(originalBlob || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      original = parsed as RawRecord;
    }
  } catch {
    // Unparseable original: keep edits only (matches legacy tolerance).
  }
  return JSON.stringify({ ...original, ...edits });
}
