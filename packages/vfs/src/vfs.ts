/**
 * The layered virtual file system (spec §7.2), storing files by (space,
 * basename) internally; legacy names exist only at the edges via the
 * legacy-names adapter. Search orders, deletion guards, and bundle wire
 * shapes are verified per appendix A1.
 */
import {
  format,
  magicName,
  parse,
  persistencePlan,
  SPACE_BUNDLE,
  type BundleName,
  type PersistencePlan,
  type Space,
} from './legacy-names';
import { editableBy, visibleInUi, type Role } from './permissions';

export interface VfsEntry {
  space: Space;
  basename: string;
  legacyName: string;
  contents: string;
}

export type ResolvedFile =
  { kind: 'file'; entry: VfsEntry } | { kind: 'remote'; basename: string; url: string };

export interface VfsChange {
  type: 'write' | 'delete';
  legacyName: string;
}

export type VfsListener = (change: VfsChange) => void;

/**
 * File-search orders (files.js:563-599, verified A1 §4a). Shadowing priority
 * is role-dependent; remote/uploaded files are always consulted last.
 */
const STUDENT_ORDER: Space[] = ['hidden', 'readonly', 'student', 'generated'];
const INSTRUCTOR_EVERYWHERE_ORDER: Space[] = [
  'readonly',
  'student',
  'generated',
  'instructor',
  'hidden',
  'starting',
];
const INSTRUCTOR_PATH_ORDER: Space[] = [
  'instructor',
  'hidden',
  'starting',
  'readonly',
  'student',
  'generated',
];

export class Vfs {
  private spaces = new Map<Space, Map<string, string>>();
  private remoteFiles = new Map<string, string>(); // basename -> url
  private remoteContents = new Map<string, string>(); // basename -> fetched body
  private dirtyNames = new Set<string>(); // legacy names
  private listeners = new Set<VfsListener>();

  // -- basic operations ------------------------------------------------------

  /** Write by legacy name. Low-level: permission checks are the caller's job
   * (use `canEdit` / `visibleInUi`); the engine and boot loaders write files
   * students could never edit. */
  write(legacyName: string, contents: string): void {
    const { space, basename } = parse(legacyName);
    let files = this.spaces.get(space);
    if (!files) {
      files = new Map();
      this.spaces.set(space, files);
    }
    const previous = files.get(basename);
    if (previous === contents) return;
    files.set(basename, contents);
    this.dirtyNames.add(legacyName);
    this.emit({ type: 'write', legacyName });
  }

  read(legacyName: string): string | undefined {
    const { space, basename } = parse(legacyName);
    return this.spaces.get(space)?.get(basename);
  }

  has(legacyName: string): boolean {
    return this.read(legacyName) !== undefined;
  }

  /**
   * Delete by legacy name. Magic names are protected: legacy allows deleting
   * only `!on_change.py` / `!on_eval.py` (files.js:229), and we protect
   * `!assignment_settings.blockpy` despite legacy's `.py` typo (A1 §7.4).
   */
  delete(legacyName: string): boolean {
    const magic = magicName(legacyName);
    if (magic && !magic.deletable) return false;
    const { space, basename } = parse(legacyName);
    const files = this.spaces.get(space);
    if (!files?.has(basename)) return false;
    files.delete(basename);
    this.dirtyNames.add(legacyName);
    this.emit({ type: 'delete', legacyName });
    return true;
  }

  /** All entries, optionally limited to one space. */
  list(space?: Space): VfsEntry[] {
    const result: VfsEntry[] = [];
    for (const [sp, files] of this.spaces) {
      if (space && sp !== space) continue;
      for (const [basename, contents] of files) {
        result.push({ space: sp, basename, legacyName: format(sp, basename), contents });
      }
    }
    return result;
  }

  // -- role-aware views ------------------------------------------------------

  /** Entries this role may see in the file-tab UI. */
  listVisible(role: Role): VfsEntry[] {
    return this.list().filter((e) => visibleInUi(e.legacyName, role));
  }

  canEdit(legacyName: string, role: Role): boolean {
    return editableBy(legacyName, role);
  }

  /**
   * Runtime file lookup with the legacy role-dependent shadowing order
   * (A1 §4a). `instructorPath` corresponds to an explicit `_instructor/`
   * path prefix in legacy instructor searches.
   */
  searchForFile(
    basename: string,
    role: Role,
    opts: { instructorPath?: boolean } = {},
  ): ResolvedFile | undefined {
    const order =
      role === 'instructor'
        ? opts.instructorPath
          ? INSTRUCTOR_PATH_ORDER
          : INSTRUCTOR_EVERYWHERE_ORDER
        : STUDENT_ORDER;
    for (const space of order) {
      const contents = this.spaces.get(space)?.get(basename);
      if (contents !== undefined) {
        return {
          kind: 'file',
          entry: { space, basename, legacyName: format(space, basename), contents },
        };
      }
    }
    const url = this.remoteFiles.get(basename);
    if (url !== undefined) return { kind: 'remote', basename, url };
    return undefined;
  }

  /**
   * The engine-staging view: every basename reachable through the role's
   * search order (A1 §4a), resolved to its winning contents and keyed by
   * PREFIX-STRIPPED basename — exactly what `EngineJob.files` /
   * `PedalGradeOptions.files` stage into the run's working directory.
   * Remote files are URLs, not contents, so they are not staged here.
   */
  stageFiles(role: Role): Record<string, string> {
    const order =
      role === 'instructor' ? INSTRUCTOR_EVERYWHERE_ORDER : STUDENT_ORDER;
    const staged: Record<string, string> = {};
    // Remote files are consulted LAST in every search order (A1 §4a), so
    // their fetched contents stage at the lowest priority — any local space
    // overwrites them below.
    for (const [basename, contents] of this.remoteContents) {
      staged[basename] = contents;
    }
    // Walk the order from LOWEST priority to highest so higher-priority
    // spaces overwrite (the search order lists highest first).
    for (const space of [...order].reverse()) {
      const files = this.spaces.get(space);
      if (!files) continue;
      for (const [basename, contents] of files) {
        staged[basename] = contents;
      }
    }
    return staged;
  }

  /** Register uploaded/remote files (consulted last in every search order). */
  setRemoteFiles(files: Record<string, string>): void {
    this.remoteFiles = new Map(Object.entries(files));
    // Drop cached bodies for files that disappeared from the listing.
    for (const basename of [...this.remoteContents.keys()]) {
      if (!this.remoteFiles.has(basename)) this.remoteContents.delete(basename);
    }
  }

  /**
   * Cache a remote file's fetched body so runs can stage it (legacy
   * `downloadRemoteFiles` → `remoteFiles_`, files.js:717-736).
   */
  setRemoteContents(basename: string, contents: string): void {
    this.remoteContents.set(basename, contents);
  }

  hasRemoteContents(basename: string): boolean {
    return this.remoteContents.has(basename);
  }

  // -- reset-to-start (A1: Reset copies ^name → unprefixed, prefix stripped) --

  /** Copy every 'starting' file over its student-space counterpart. */
  resetToStart(): void {
    for (const entry of this.list('starting')) {
      const target =
        entry.basename === 'starting_code.py' ? 'answer.py' : format('student', entry.basename);
      this.write(target, entry.contents);
    }
  }

  // -- dirty tracking & events ------------------------------------------------

  isDirty(legacyName: string): boolean {
    return this.dirtyNames.has(legacyName);
  }

  dirty(): string[] {
    return [...this.dirtyNames];
  }

  markClean(legacyName?: string): void {
    if (legacyName === undefined) this.dirtyNames.clear();
    else this.dirtyNames.delete(legacyName);
  }

  onChange(listener: VfsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: VfsChange): void {
    for (const listener of this.listeners) listener(change);
  }

  // -- wire bundles (files.js:283-299; server.js:131-133) ---------------------

  /**
   * Encode a `#` bundle: JSON object of `{legacyName: contents}` for every
   * non-magic extra file the bundle carries. Magic names with individual
   * persistence are excluded (they save through their own channel).
   */
  encodeBundle(bundle: BundleName): string {
    const members: Record<string, string> = {};
    for (const entry of this.list()) {
      const plan = persistencePlan(entry.legacyName);
      if (plan.kind === 'bundle' && plan.wireName === bundle) {
        members[entry.legacyName] = entry.contents;
      }
    }
    return JSON.stringify(members);
  }

  /** Decode a `#` bundle payload back into individual files. */
  loadBundle(json: string): void {
    const members = JSON.parse(json) as Record<string, string>;
    for (const [legacyName, contents] of Object.entries(members)) {
      this.write(legacyName, contents);
    }
  }

  /** The bundle (if any) that carries this legacy name on the wire. */
  bundleFor(legacyName: string): BundleName | undefined {
    const plan = persistencePlan(legacyName);
    return plan.kind === 'bundle' ? (plan.wireName as BundleName) : undefined;
  }

  /** Persistence plan passthrough (see legacy-names.ts). */
  persistencePlan(legacyName: string): PersistencePlan {
    return persistencePlan(legacyName);
  }
}

export { SPACE_BUNDLE };
