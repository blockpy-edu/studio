/**
 * @blockpy/legacy-shim — window.blockpy / window.frontend compatibility
 * facade (spec §15). M1.6 ships the minimum: the `BlockPy` constructor
 * facade with jQuery-Deferred `loadAssignment`, `$MAIN_BLOCKPY_EDITOR`,
 * and the `settings-*` loop. The §15.3 globals (`frontend`, `markCorrect`,
 * `URL_MAP`, …) land with Milestone 2.5.
 */
export {
  BlockPy,
  asLegacyDeferred,
  installLegacyShim,
  optionsToBootConfig,
} from './facade';
export type { BlockPyFacadeDeps, BlockPyOptions, LegacyDeferred } from './facade';

export const PACKAGE_NAME = '@blockpy/legacy-shim';
