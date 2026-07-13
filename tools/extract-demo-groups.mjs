/**
 * Extract the demo assignment groups from the (untracked) bakery course
 * export into a small COMMITTED JSON the dev harness + GitHub Pages demo
 * serve statically.
 *
 *   node tools/extract-demo-groups.mjs
 *
 * Reads courses/bakery_course.json (a blockpy-server course export; not in
 * git — ask a maintainer) and writes
 * packages/app/src/demo/bakery-groups.json.
 *
 * Ordering note: the export's membership `position` columns are all 0 and
 * the legacy server never ordered by them (course.py:204-244, see plan
 * M4.6) — course pages showed insertion order. For a DEMO that arbitrary
 * order reads as broken, so assignments sort by their "1A3.1)" name prefix
 * (natural sort); subordinate readings ride along wherever the nav hides
 * them anyway.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const course = JSON.parse(readFileSync(join(repoRoot, 'courses', 'bakery_course.json'), 'utf8'));

/** [group id in the export, stable demo key] */
const WANTED = [
  [159, 'bakery_1a'],
  [172, 'bakery_6b'],
];

const byId = new Map(course.assignments.map((assignment) => [assignment.id, assignment]));

/** Natural-ish sort key for "1A3.1) Basic Output" style names. */
function nameKey(name) {
  return name.replace(/\d+/g, (digits) => digits.padStart(6, '0')).toLowerCase();
}

const TYPE_SLOTS = ['quiz', 'reading', 'textbook', 'java', 'typescript', 'explain', 'blockpy'];

const groups = WANTED.map(([groupId, key]) => {
  const group = course.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Group ${groupId} not in the export`);
  const members = course.memberships
    .filter((membership) => membership.assignment_group_id === groupId)
    .map((membership) => byId.get(membership.assignment_id))
    .filter(Boolean)
    .sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)));
  const typeIndex = Object.fromEntries(TYPE_SLOTS.map((slot) => [slot, []]));
  for (const assignment of members) {
    (typeIndex[assignment.type] ?? typeIndex.blockpy).push(assignment.id);
  }
  return {
    key,
    id: groupId,
    name: group.name,
    url: group.url,
    typeIndex,
    nav: members.map((assignment) => ({
      id: assignment.id,
      name: assignment.name,
      url: `#${assignment.id}`,
      subordinate: assignment.subordinate === true,
      hidden: assignment.hidden === true,
      correct: false,
    })),
    // Wire-shaped records, served verbatim as load_assignment responses.
    assignments: members.map((assignment) => {
      const record = { ...assignment };
      delete record.owner_id__email; // no emails in the published bundle
      return record;
    }),
  };
});

const outPath = join(repoRoot, 'packages', 'app', 'src', 'demo', 'bakery-groups.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ groups }, null, 1) + '\n');
console.log(
  `Wrote ${outPath}:`,
  groups.map((group) => `${group.name} (${group.assignments.length} assignments)`).join(', '),
);
