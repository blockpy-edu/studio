/**
 * @blockpy/app — application shell and embeddable entry point.
 *
 * The iife build of this module is `blockpy-studio.iife.js`, exposing
 * window.BlockPyStudio.{mount, mountLegacy} (spec §5.2).
 */
export { mount, mountLegacy } from './mount';
export type {
  BootConfig,
  GroupBootData,
  AssignmentTypeIndex,
  LegacyUrlMap,
  LegacyAssignmentPayload,
} from './boot-config';
