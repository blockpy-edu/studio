/**
 * @blockpy/app - application shell and embeddable entry point.
 *
 * The iife build of this module is `blockpy-studio.iife.js`, exposing
 * window.BlockPyStudio.{mount, mountLegacy} (spec §5.2). `mountConfig` is
 * the programmatic core the legacy shim's BlockPy facade drives (§15.1).
 */
export { mount, mountConfig, mountLegacy } from './mount';
export type { MountExtras } from './studio-handle';
export { StudioHandle, type StudioActions } from './studio-handle';
export {
  AssignmentHost,
  classifyAssignment,
  replaceAssignmentIdInUrl,
  type AssignmentHostProps,
  type AssignmentType,
} from './AssignmentHost';
export { bootConfigFromLegacyGlobals, settingsFromSearch } from './legacy-globals';
export type { LegacyGlobalsSource } from './legacy-globals';
export {
  parseAssignmentSettings,
  parseConcatenatedFiles,
  vfsFromAssignment,
} from './assignment-loader';
export type {
  BootConfig,
  GroupBootData,
  AssignmentTypeIndex,
  LegacyUrlMap,
  LegacyAssignmentPayload,
} from './boot-config';
