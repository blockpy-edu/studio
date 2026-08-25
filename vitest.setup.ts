/**
 * Shared vitest setup (vitest.config.ts `setupFiles`).
 *
 * jsdom has no canvas backend: `HTMLCanvasElement.prototype.getContext`
 * logs a "Not implemented" stack trace through the virtual console on every
 * call. Blockly measures text through a 2d context
 * (`getFastTextWidthWithSizeString` → `ctx.font = …; ctx.measureText(text)`)
 * whenever a workspace renders, so every chrome test that mounts a block
 * editor printed that trace. Stub the minimum Blockly touches; anything
 * else on the fake context stays undefined, so code that really needs a
 * canvas (e.g. ImageEditor's `createImageData`/`putImageData`) still fails
 * soft exactly as it did with a null context.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (...args: unknown[]) => unknown;
  };
  proto.getContext = function getContext(this: HTMLCanvasElement, contextId: unknown) {
    if (contextId !== '2d') return null;
    return {
      canvas: this,
      font: '',
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
  };
}
