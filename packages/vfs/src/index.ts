/**
 * @blockpy/vfs — Layered virtual file system with the legacy filename
 * adapter (spec §7). Conformance authority: docs/appendices/A1-filename-prefixes.md.
 */
export {
  SPACES,
  SPACE_PREFIX,
  SPACE_LAYER,
  SPACE_BUNDLE,
  MAGIC_NAMES,
  parse,
  format,
  magicName,
  persistencePlan,
} from './legacy-names';
export type {
  Space,
  Layer,
  ParsedName,
  MagicName,
  BundleName,
  PersistenceKind,
  PersistencePlan,
} from './legacy-names';
export { visibleInUi, editableBy, creatableSpaces } from './permissions';
export type { Role } from './permissions';
export { Vfs } from './vfs';
export type { VfsEntry, VfsChange, VfsListener, ResolvedFile } from './vfs';

export const PACKAGE_NAME = '@blockpy/vfs';
export { Autosaver } from './autosaver';
export type { AutosaverOptions, FileSaver } from './autosaver';
