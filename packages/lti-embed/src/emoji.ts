/**
 * Emoji proxy (spec §13) - legacy `Sk.emojiProxy = (part) =>
 * `${staticEmojiPath}${part.toLowerCase()}.svg`` (editor.html:294,
 * textbook.html:203; the client's own default pointed at twemoji,
 * configurations.js:108).
 *
 * VERIFIED consumer (2026-07-11): the ONLY reader of `Sk.emojiProxy` in the
 * legacy stack is pygame4skulpt's `image.js` `load()` - emoji-SVG pygame
 * surfaces - not general console output rendering (the spec §13 "output
 * rendering" phrasing is superseded by this finding; see the M2.5 plan
 * note). Studio therefore preserves the mapping as engine config plumbing
 * (`BootConfig.paths.emojiProxy` → this resolver) for a future
 * pygame-equivalent rather than wiring a console hook that legacy never had.
 */
export function emojiProxyUrl(emojiProxyBase: string, part: string): string {
  return `${emojiProxyBase}${part.toLowerCase()}.svg`;
}

export function makeEmojiProxy(emojiProxyBase: string): (part: string) => string {
  return (part) => emojiProxyUrl(emojiProxyBase, part);
}
