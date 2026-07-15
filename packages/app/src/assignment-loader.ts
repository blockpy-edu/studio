/**
 * Server payload → VFS mapping, the Studio port of legacy
 * `loadAssignmentData_` (blockpy.js:491-539) + `loadSubmission`
 * (blockpy.js:463-489). The legacy client spread these fields across the
 * Knockout model and mirrored them into files (A1 §"model-bound files");
 * Studio writes the files directly - the VFS is the model.
 */
import { Vfs } from '@blockpy/vfs';
import type { DecodedAssignment, DecodedSubmission } from '@blockpy/api';

/**
 * `extra_*_files` wire format: a JSON object `{filename: contents}` with
 * legacy-prefixed names, produced by `observeConcatenatedFile`
 * (files.js:292-299) and parsed by `loadConcatenatedFile` (files.js:259).
 * Legacy would crash the whole assignment load on malformed JSON; the
 * server never emits it, so we fail soft to "no files" instead.
 */
export function parseConcatenatedFiles(blob: string): Record<string, string> {
  if (!blob) return {};
  try {
    const parsed = JSON.parse(blob) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const files: Record<string, string> = {};
    for (const [filename, contents] of Object.entries(parsed)) {
      if (typeof contents === 'string') files[filename] = contents;
    }
    return files;
  } catch {
    return {};
  }
}

/** `!assignment_settings.blockpy` blob → key/value map (A4). */
export function parseAssignmentSettings(blob: string): Record<string, unknown> {
  if (!blob) return {};
  try {
    const parsed = JSON.parse(blob) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Build the working file system for a loaded assignment (+ submission).
 * File placement follows A1 §"Boot/mount sets" and blockpy.js:
 *
 * - `answer.py` = submission code; no submission falls back to the starting
 *   code (`loadNoSubmission`, blockpy.js:458-461).
 * - `!on_change.py` / `!on_eval.py` exist only when the assignment
 *   configures them (blockpy.js:512-519) - tab visibility keys off
 *   existence (files.js:36-39).
 * - `extra_instructor_files` / `extra_starting_files` / submission
 *   `extra_files` carry their prefixed names verbatim.
 */
export function vfsFromAssignment(
  assignment: DecodedAssignment,
  submission?: DecodedSubmission,
): Vfs {
  const vfs = new Vfs();
  vfs.write('answer.py', submission ? submission.code : assignment.startingCode);
  vfs.write('!instructions.md', assignment.instructions);
  vfs.write('!on_run.py', assignment.onRun);
  vfs.write('^starting_code.py', assignment.startingCode);
  vfs.write('!assignment_settings.blockpy', assignment.settings);
  if (assignment.onChange !== null) vfs.write('!on_change.py', assignment.onChange);
  if (assignment.onEval !== null) vfs.write('!on_eval.py', assignment.onEval);
  for (const [filename, contents] of Object.entries(
    parseConcatenatedFiles(assignment.extraInstructorFiles),
  )) {
    vfs.write(filename, contents);
  }
  for (const [filename, contents] of Object.entries(
    parseConcatenatedFiles(assignment.extraStartingFiles),
  )) {
    vfs.write(filename, contents);
  }
  if (submission) {
    for (const [filename, contents] of Object.entries(
      parseConcatenatedFiles(submission.extraFiles),
    )) {
      vfs.write(filename, contents);
    }
  }
  return vfs;
}
