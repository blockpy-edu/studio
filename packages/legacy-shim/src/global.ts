/**
 * iife entry (spec §15.1): loading `blockpy-studio-legacy.iife.js` on an
 * UNMODIFIED editor.html publishes `window.blockpy.BlockPy` so the
 * template's `new blockpy.BlockPy({...})` mounts BlockPy Studio instead of
 * the Skulpt client. This is the script the per-course deployment flag
 * swaps in (M1.6).
 */
import { installLegacyShim } from './facade';
import { installFrontendStub } from './frontend-stub';

installLegacyShim();
// §15.3: only when the real frontend bundle is absent (pages that still
// load it must win).
installFrontendStub();

export { BlockPy, installLegacyShim } from './facade';
export { Server, installFrontendStub } from './frontend-stub';
