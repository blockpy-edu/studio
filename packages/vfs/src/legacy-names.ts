/**
 * The legacy filename adapter (spec §7.3) — the ONE place the prefix
 * oddities live. Verified against the legacy client in appendix A1
 * (docs/appendices/A1-filename-prefixes.md); citations there.
 *
 * Legacy recognizes eight namespaces ("spaces") signaled by a filename
 * prefix (files.js:178-188). Note the deliberate harmonization: legacy
 * `editors.js` recognized only a subset of the prefixes (`!^?$`) while
 * `files.js` recognized all of `!^?&$*#` — we use the full set everywhere
 * (A1 §7.8).
 */

export const SPACES = [
  'student', // ''  visible + editable student files (answer.py, extras)
  'instructor', // '!' invisible to students under all circumstances
  'starting', // '^' reset-to-start sources; copied to student space on Reset
  'hidden', // '?' hidden from student UI, readable by student code
  'readonly', // '&' instructor-authored, student-visible, uneditable
  'secret', // '$' never menu-visible, never persisted
  'generated', // '*' run artifacts (vestigial in legacy — A1 §4e)
  'bundle', // '#' wire-format concatenation bundles (actively persisted)
] as const;
export type Space = (typeof SPACES)[number];

export const SPACE_PREFIX: Record<Space, string> = {
  student: '',
  instructor: '!',
  starting: '^',
  hidden: '?',
  readonly: '&',
  secret: '$',
  generated: '*',
  bundle: '#',
};

const PREFIX_SPACE: Record<string, Space> = {
  '!': 'instructor',
  '^': 'starting',
  '?': 'hidden',
  '&': 'readonly',
  $: 'secret',
  '*': 'generated',
  '#': 'bundle',
};

/**
 * Storage layer (spec §7.2, corrected per A1 §6.5): which record owns the
 * bytes. `wire` is not a real layer — `#` bundles are a persistence encoding
 * over other layers. `transient` is the Studio run-artifact layer (LD-3x).
 */
export type Layer =
  'system' | 'assignment' | 'uploads' | 'submission' | 'local' | 'wire' | 'transient';

/** Which layer owns files of a given space (A1 §1 model-storage mapping). */
export const SPACE_LAYER: Record<Space, Layer> = {
  student: 'submission',
  instructor: 'assignment',
  starting: 'assignment',
  hidden: 'assignment',
  readonly: 'assignment', // A1 delta 1: '&' is assignment-owned, NOT student
  secret: 'local',
  generated: 'submission', // legacy stores '*' in submission.extraFiles (files.js:585)
  bundle: 'wire',
};

export interface ParsedName {
  /** The space the prefix denotes. */
  space: Space;
  /** Name with the prefix stripped (what the UI displays for '&' files). */
  basename: string;
  /** The full legacy wire/authoring name, prefix included. */
  legacyName: string;
}

/** `parse('!on_run.py')` → `{space:'instructor', basename:'on_run.py', …}` */
export function parse(legacyName: string): ParsedName {
  const first = legacyName.charAt(0);
  const space = PREFIX_SPACE[first];
  if (space) {
    return { space, basename: legacyName.slice(1), legacyName };
  }
  return { space: 'student', basename: legacyName, legacyName };
}

/** Inverse of {@link parse}. */
export function format(space: Space, basename: string): string {
  return SPACE_PREFIX[space] + basename;
}

// ---------------------------------------------------------------------------
// Magic names (A1 §3) — exact filenames the client special-cases.
// ---------------------------------------------------------------------------

export type PersistenceKind =
  | 'saveFile' // individually autosaved via saveFile (1000 ms debounce)
  | 'bundle' // autosaved inside its space's '#' bundle via saveFile
  | 'saveAssignment' // manual-only Save button → saveAssignment
  | 'uploads' // upload/download/rename/list endpoints (placement+directory)
  | 'saveImage' // run-artifact image endpoint
  | 'none'; // never persisted by the client

export interface MagicName {
  legacyName: string;
  persistence: PersistenceKind;
  /** For persistence 'bundle': which bundle carries it. */
  bundle?: BundleName;
  /** Legacy allowed deleting only two files (files.js:229). */
  deletable: boolean;
  notes?: string;
}

export type BundleName =
  | '#extra_student_files.blockpy'
  | '#extra_starting_files.blockpy'
  | '#extra_instructor_files.blockpy';

/** Which bundle carries a space's non-magic extra files (server.js:131-133). */
export const SPACE_BUNDLE: Partial<Record<Space, BundleName>> = {
  student: '#extra_student_files.blockpy',
  generated: '#extra_student_files.blockpy',
  starting: '#extra_starting_files.blockpy',
  instructor: '#extra_instructor_files.blockpy',
  hidden: '#extra_instructor_files.blockpy',
  readonly: '#extra_instructor_files.blockpy',
};

/**
 * The verified magic-name registry (A1 §3, fixture seed §8). Legacy protected
 * the wrong name (`!assignment_settings.py`) in its guard lists — we protect
 * the real `.blockpy` name per A1 §7.4.
 */
export const MAGIC_NAMES: readonly MagicName[] = [
  { legacyName: 'answer.py', persistence: 'saveFile', deletable: false },
  { legacyName: '!instructions.md', persistence: 'saveFile', deletable: false },
  {
    legacyName: '!assignment_settings.blockpy',
    persistence: 'saveAssignment',
    deletable: false,
    notes: 'Manual save only; D5-B: unknown keys in the blob must round-trip (ledger LD-5)',
  },
  { legacyName: '!on_run.py', persistence: 'saveFile', deletable: false },
  { legacyName: '!on_change.py', persistence: 'saveFile', deletable: true },
  { legacyName: '!on_eval.py', persistence: 'saveFile', deletable: true },
  { legacyName: '^starting_code.py', persistence: 'saveFile', deletable: false },
  {
    legacyName: '!sample_submissions.blockpy',
    persistence: 'none',
    deletable: false,
    notes: 'No working persistence path in legacy (A1 §3)',
  },
  {
    legacyName: '!tags.blockpy',
    persistence: 'none',
    deletable: false,
    notes: 'No working persistence path in legacy (A1 §3)',
  },
  {
    legacyName: '!answer_prefix.py',
    persistence: 'bundle',
    bundle: '#extra_instructor_files.blockpy',
    deletable: false,
    notes: 'Concatenated before submission.code on every run (blockpy.js:994-1005)',
  },
  {
    legacyName: '!answer_suffix.py',
    persistence: 'bundle',
    bundle: '#extra_instructor_files.blockpy',
    deletable: false,
    notes: 'Concatenated after submission.code on every run',
  },
  {
    legacyName: '?toolbox.blockpy',
    persistence: 'bundle',
    bundle: '#extra_instructor_files.blockpy',
    deletable: false,
  },
  {
    legacyName: '?mock_urls.blockpy',
    persistence: 'bundle',
    bundle: '#extra_instructor_files.blockpy',
    deletable: false,
  },
  {
    legacyName: 'images.blockpy',
    persistence: 'uploads',
    deletable: false,
    notes: "Unprefixed but assignment-owned; the file itself is a '{}' stub",
  },
  { legacyName: '$settings.blockpy', persistence: 'none', deletable: false },
  { legacyName: '#extra_student_files.blockpy', persistence: 'saveFile', deletable: false },
  { legacyName: '#extra_starting_files.blockpy', persistence: 'saveFile', deletable: false },
  { legacyName: '#extra_instructor_files.blockpy', persistence: 'saveFile', deletable: false },
];

const MAGIC_BY_NAME = new Map(MAGIC_NAMES.map((m) => [m.legacyName, m]));

export function magicName(legacyName: string): MagicName | undefined {
  return MAGIC_BY_NAME.get(legacyName);
}

/**
 * Where a file's bytes go on save: the §7.2 persistence-adapter mapping,
 * verified per A1 §4d. Unknown names fall back to their space's bundle
 * ('secret' and unknown spaces → never persisted).
 */
export interface PersistencePlan {
  kind: PersistenceKind;
  /** The legacy wire name the endpoint receives (bundle name for 'bundle'). */
  wireName: string | null;
}

export function persistencePlan(legacyName: string): PersistencePlan {
  const magic = magicName(legacyName);
  if (magic) {
    switch (magic.persistence) {
      case 'saveFile':
        return { kind: 'saveFile', wireName: legacyName };
      case 'bundle':
        return { kind: 'bundle', wireName: magic.bundle ?? null };
      case 'saveAssignment':
        return { kind: 'saveAssignment', wireName: legacyName };
      case 'uploads':
      case 'saveImage':
        return { kind: magic.persistence, wireName: legacyName };
      case 'none':
        return { kind: 'none', wireName: null };
    }
  }
  const { space } = parse(legacyName);
  const bundle = SPACE_BUNDLE[space];
  if (bundle) return { kind: 'bundle', wireName: bundle };
  return { kind: 'none', wireName: null };
}
