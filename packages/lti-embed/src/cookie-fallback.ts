/**
 * Cookie-blocked boot fallback (spec §13) - port of the editor.html:27-99
 * inline script plus `frontend.checkCookies()` (frontend/site/core.ts:20-27)
 * and `frontend.generateUUID()` (frontend/utilities/random.ts:31-45).
 *
 * On boot: detect cookie availability, publish `window.ltiLoadedCorrectly`,
 * log the console error verbatim, and perform the LTI platform-storage
 * handshake - `lti.put_data` postMessages for the state and nonce,
 * listening for `lti.put_data.response` with the legacy validation ladder
 * (object → subject → message-id → origin → error → success log).
 *
 * Two pinned caveats:
 *  - PLATFORM_ORIGIN stays `'*'` ("right now (Jan 4, 2024), it's still
 *    expecting '*' to be the origin", editor.html:33) behind a constant so
 *    it can be corrected when platforms comply. Because `event.origin` is
 *    never literally `'*'`, the response listener can never accept a
 *    message - faithfully matching legacy, where the handshake fires and
 *    the confirmation is unreachable.
 *  - Legacy posts the LITERAL placeholder strings `"blockpy_<state_id>"` /
 *    `"<state_id>"` / `"nonce_<nonce_value>"` - the generated `stateId`
 *    was never interpolated (half-finished code). Studio substitutes the
 *    generated UUIDs per the spec's "with generated UUIDs" (ledger LD-14).
 */

export function checkCookies(doc: Document = document, nav: Navigator = navigator): boolean {
  let cookieEnabled = nav.cookieEnabled;
  if (!cookieEnabled) {
    doc.cookie = 'testcookie';
    cookieEnabled = doc.cookie.indexOf('testcookie') !== -1;
  }
  return cookieEnabled;
}

/** frontend/utilities/random.ts:31-45, verbatim port (Public Domain/MIT). */
export function generateUUID(): string {
  let d = new Date().getTime(); // Timestamp
  let d2 = (typeof performance !== 'undefined' && performance.now && performance.now() * 1000) || 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = Math.random() * 16;
    if (d > 0) {
      r = ((d + r) % 16) | 0;
      d = Math.floor(d / 16);
    } else {
      r = ((d2 + r) % 16) | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** The current '*' platform-origin caveat (§13), kept behind a constant. */
export const PLATFORM_ORIGIN = '*';

/** editor.html:30-31, verbatim. */
export const COOKIE_ERROR_MESSAGE =
  'Cookies appear to be disabled. We will attempt to load without cookies. ' +
  'You might need to disable an ad-blocker, adjust your security settings, or use a different browser (we recommend Chrome).';

export interface CookieFallbackResult {
  loadedCorrectly: boolean;
  dispose: () => void;
}

export function installCookieFallback(
  win: Window = window,
  uuid: () => string = generateUUID,
): CookieFallbackResult {
  const loadedCorrectly = checkCookies(win.document, win.navigator);
  (win as unknown as Record<string, unknown>)['ltiLoadedCorrectly'] = loadedCorrectly;
  if (loadedCorrectly) {
    return { loadedCorrectly, dispose: () => undefined };
  }
  console.error(COOKIE_ERROR_MESSAGE);

  const targetFrame = win.parent;
  const platformOrigin = PLATFORM_ORIGIN;
  const messageId = uuid();
  const stateId = uuid();
  const nonceValue = uuid();

  // First try to see if we can get the state and nonce values from the
  // platform. If we can't, then we'll need to generate new ones and store
  // them. (Legacy comment; the validation ladder below is editor.html:48-81.)
  const listener = (event: MessageEvent) => {
    // This isn't a message we're expecting
    if (typeof event.data !== 'object' || event.data === null) {
      return;
    }
    const data = event.data as Record<string, unknown>;
    // Validate it's the response type you expect
    if (data['subject'] !== 'lti.put_data.response') {
      return;
    }
    // Validate the message id matches the id you sent
    if (data['message_id'] !== messageId) {
      // this is not the response you're looking for
      return;
    }
    // Validate that the event's origin is the same as the derived platform
    // origin (never true while PLATFORM_ORIGIN is '*' - legacy-exact).
    if (event.origin !== platformOrigin) {
      return;
    }
    // handle errors
    const error = data['error'] as Record<string, unknown> | undefined;
    if (error) {
      console.log(error['code']);
      console.log(error['message']);
      return;
    }
    // It's the response we expected - state and nonce values were stored.
    console.log('Success! State and nonce values were stored.');
  };
  win.addEventListener('message', listener);

  targetFrame.postMessage(
    {
      subject: 'lti.put_data',
      message_id: messageId,
      key: `blockpy_${stateId}`,
      value: stateId,
    },
    platformOrigin,
  );
  targetFrame.postMessage(
    {
      subject: 'lti.put_data',
      message_id: messageId,
      key: `nonce_${nonceValue}`,
      value: nonceValue,
    },
    platformOrigin,
  );

  return { loadedCorrectly, dispose: () => win.removeEventListener('message', listener) };
}
