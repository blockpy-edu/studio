/**
 * Role-based visibility and mutability (spec §7.2), verified per A1 §2.
 *
 * Legacy keys almost everything on the `display.instructor` flag rather than
 * fine-grained roles (A1 §6.11), so the matrix takes a Role but only
 * distinguishes instructor vs not. Read-only mode (`display.readOnly`) blocks
 * persistence, not local edits - that gate lives in the persistence adapter,
 * not here.
 */
import { parse, type Space } from './legacy-names';

export type Role = 'student' | 'instructor' | 'grader';

const isInstructor = (role: Role) => role === 'instructor';

/**
 * Can this file appear in the file-tab UI for this role? (A1 §2 table.)
 * 'hidden' (?) files are entirely invisible to students - stronger than
 * read-only (A1 §4b). 'secret' ($) and 'bundle' (#) never appear for anyone.
 */
export function visibleInUi(legacyName: string, role: Role): boolean {
  const { space } = parse(legacyName);
  switch (space) {
    case 'student':
    case 'generated':
    case 'readonly':
      return true;
    case 'instructor':
    case 'starting':
    case 'hidden':
      return isInstructor(role);
    case 'secret':
    case 'bundle':
      return false;
  }
}

/**
 * Can this role edit the file's contents in an editor?
 *
 * D3-A (ledger LD-3): '&' read-only files are immutable to students in EVERY
 * editor - legacy enforced this in only four of six editors (A1 §7.2).
 */
export function editableBy(legacyName: string, role: Role): boolean {
  const { space } = parse(legacyName);
  switch (space) {
    case 'student':
      return true;
    case 'instructor':
    case 'starting':
    case 'hidden':
    case 'readonly':
      return isInstructor(role);
    case 'generated':
    case 'secret':
    case 'bundle':
      return false;
  }
}

/** Spaces whose files a role may create via the "Add New" UI (A1 §1). */
export function creatableSpaces(role: Role): Space[] {
  return isInstructor(role)
    ? ['student', 'instructor', 'starting', 'hidden', 'readonly']
    : ['student'];
}
