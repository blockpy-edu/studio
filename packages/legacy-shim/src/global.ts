/**
 * iife entry (spec §15.1): loading `blockpy-studio-legacy.iife.js` on an
 * UNMODIFIED editor.html publishes `window.blockpy.BlockPy` so the
 * template's `new blockpy.BlockPy({...})` mounts BlockPy Studio instead of
 * the Skulpt client. This is the script the per-course deployment flag
 * swaps in (M1.6).
 */
import { installLegacyShim } from './facade';

installLegacyShim();

export { BlockPy, installLegacyShim } from './facade';
