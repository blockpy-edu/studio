/**
 * @blockpy/legacy-shim — window.blockpy / window.frontend compatibility
 * facade (spec §15). M1.6 shipped the `BlockPy` constructor facade with
 * jQuery-Deferred `loadAssignment`, `$MAIN_BLOCKPY_EDITOR`, and the
 * `settings-*` loop; M2.5 adds the §15.3 `window.frontend` stub
 * (`checkCookies`/`generateUUID`/`Server`). The navigation compatibility
 * globals (`URL_MAP`, `INDICES`, …) are published by the app when it owns
 * the navigation (`publishNavigationGlobals`, @blockpy/navigation) — on
 * unmodified templates the assignment_groups.html macro still defines them
 * itself, so the shim never re-emits them.
 */
export {
  BlockPy,
  asLegacyDeferred,
  installLegacyShim,
  optionsToBootConfig,
} from './facade';
export type { BlockPyFacadeDeps, BlockPyOptions, LegacyDeferred } from './facade';
export { Server, installFrontendStub } from './frontend-stub';

export const PACKAGE_NAME = '@blockpy/legacy-shim';
