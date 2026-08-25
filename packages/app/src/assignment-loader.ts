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
const DEFAULT_SECTION_PATTERN = /^(##### Part (.+))$/gm;

/**
 * Legacy `extractPart` (utilities.js:240-262): find the `##### Part <id>`
 * section of a multi-part document. Empty/null id = the whole text;
 * a missing part = null.
 */
export function extractPart(text: string, partId: string | null | undefined): string | null {
  if (partId === '' || partId == null) {
    return text;
  }
  const parts = text.split(DEFAULT_SECTION_PATTERN);
  for (let i = 2; i < parts.length; i += 3) {
    if (parts[i] === partId) {
      let body = parts[i + 1] ?? '';
      if (body && body[0] === '\n') {
        body = body.slice(1);
      }
      if (i !== parts.length - 3 && body && body.slice(-1) === '\n') {
        body = body.slice(0, -1);
      }
      return body;
    }
  }
  return null;
}

export function vfsFromAssignment(
  assignment: DecodedAssignment,
  submission?: DecodedSubmission,
  /** `part_id` setting: this editor edits ONE `##### Part` section. */
  partId = '',
): Vfs {
  const vfs = new Vfs();
  // blockpy.js:172/472 - the submission code is narrowed to the part
  // (`extractPart(...) || ""`); a missing part starts empty.
  vfs.write(
    'answer.py',
    submission ? (extractPart(submission.code, partId) ?? '') : assignment.startingCode,
  );
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
