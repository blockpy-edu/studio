/**
 * Load courses/bakery_course.json (a blockpy-server course export — NOT in
 * git; ask a maintainer) into ordered groups for the curriculum walkers.
 * Ordering mirrors tools/extract-demo-groups.mjs: membership positions are
 * all 0 in the export, so assignments natural-sort by their "1A3.1)" name
 * prefix, which is how the curriculum reads.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CourseAssignment {
  id: number;
  name: string;
  url: string;
  type: 'blockpy' | 'quiz' | 'reading' | string;
  instructions: string;
  on_run: string;
  on_change: string | null;
  on_eval: string | null;
  starting_code: string | null;
  extra_instructor_files: string | null;
  extra_starting_files: string | null;
  settings: string | null;
  subordinate: boolean;
  hidden: boolean;
  points: number | null;
  [key: string]: unknown;
}

export interface CourseGroup {
  id: number;
  name: string;
  url: string;
  assignments: CourseAssignment[];
}

// vitest executes this as ESM (import.meta.url); the Playwright walker
// transpiles it to CJS (__dirname) — support both hosts.
export const BAKERY_DIR =
  typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));

export const COURSE_PATH = join(BAKERY_DIR, '..', '..', 'courses', 'bakery_course.json');

export function courseAvailable(): boolean {
  return existsSync(COURSE_PATH);
}

/** Natural-ish sort key for "1A3.1) Basic Output" style names. */
function nameKey(name: string): string {
  return name.replace(/\d+/g, (digits) => digits.padStart(6, '0')).toLowerCase();
}

interface RawCourse {
  groups: Array<{ id: number; name: string; url: string }>;
  assignments: CourseAssignment[];
  memberships: Array<{ assignment_group_id: number; assignment_id: number }>;
}

export function loadCourse(): CourseGroup[] {
  const course = JSON.parse(readFileSync(COURSE_PATH, 'utf8')) as RawCourse;
  const byId = new Map(course.assignments.map((assignment) => [assignment.id, assignment]));
  return course.groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      url: group.url,
      assignments: course.memberships
        .filter((membership) => membership.assignment_group_id === group.id)
        .map((membership) => byId.get(membership.assignment_id))
        .filter((assignment): assignment is CourseAssignment => assignment !== undefined)
        .sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name))),
    }))
    .sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)));
}

/** Instructor extras JSON ({"!correct.py": "..."} etc.), fail-soft. */
export function instructorFiles(assignment: CourseAssignment): Record<string, string> {
  const raw = (assignment.extra_instructor_files ?? '').trim();
  if (!raw.startsWith('{')) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

/** The instructor solution when the curriculum ships one (45/223 do).
 *  Blank files count as absent (bakery_lecture_testing_nesting_2 ships an
 *  empty !correct.py). */
export function bundledSolution(assignment: CourseAssignment): string | null {
  const files = instructorFiles(assignment);
  const solution = files['!correct.py'] ?? files['correct.py'] ?? null;
  return solution !== null && solution.trim() !== '' ? solution : null;
}
