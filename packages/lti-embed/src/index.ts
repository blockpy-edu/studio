/**
 * @blockpy/lti-embed — LTI embedding glue (spec §13): frame resize,
 * cookie-blocked fallback + platform-storage handshake, loading screen,
 * emoji proxy hook. Ports of the editor.html/textbook.html inline scripts
 * and frontend/site/core.ts.
 */
export {
  FRAME_RESIZE_DEBOUNCE,
  FRAME_RESIZE_PADDING,
  installFrameResize,
  type FrameResizeMessage,
} from './frame-resize';
export {
  COOKIE_ERROR_MESSAGE,
  PLATFORM_ORIGIN,
  checkCookies,
  generateUUID,
  installCookieFallback,
  type CookieFallbackResult,
} from './cookie-fallback';
export { LOADING_NOTICE_TEXT, loadingNoticeHtml, removeLoadingScreen } from './loading';
export { emojiProxyUrl, makeEmojiProxy } from './emoji';

export const PACKAGE_NAME = '@blockpy/lti-embed';
