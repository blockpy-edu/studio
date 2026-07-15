// @vitest-environment jsdom
/**
 * §13 conformance: frame resize message shape + debounce, cookie fallback
 * handshake (validation ladder, generated UUIDs - LD-14), loading screen,
 * emoji proxy mapping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COOKIE_ERROR_MESSAGE,
  FRAME_RESIZE_DEBOUNCE,
  FRAME_RESIZE_PADDING,
  LOADING_NOTICE_TEXT,
  PACKAGE_NAME,
  checkCookies,
  emojiProxyUrl,
  generateUUID,
  installCookieFallback,
  installFrameResize,
  loadingNoticeHtml,
  makeEmojiProxy,
  removeLoadingScreen,
} from './index';

it('exposes its package name', () => {
  expect(PACKAGE_NAME).toBe('@blockpy/lti-embed');
});

describe('installFrameResize (§13, editor.html:350-380)', () => {
  let posted: Array<{ message: unknown; origin: unknown }>;
  let resizeCallback: ((entries: Array<{ target: Element }>) => void) | null;
  let observed: Element[];
  let win: Window;

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    resizeCallback = null;
    observed = [];
    class FakeResizeObserver {
      constructor(callback: (entries: Array<{ target: Element }>) => void) {
        resizeCallback = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      disconnect() {
        observed = [];
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    win = Object.create(window, {
      parent: {
        value: {
          postMessage: (message: unknown, origin: unknown) => posted.push({ message, origin }),
        },
      },
    }) as Window;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('posts the JSON-stringified frameResize message to the parent on install', () => {
    const dispose = installFrameResize(win);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.origin).toBe('*');
    // Legacy JSON-stringifies the payload (editor.html:353-356).
    expect(typeof posted[0]!.message).toBe('string');
    const parsed = JSON.parse(posted[0]!.message as string) as Record<string, unknown>;
    expect(parsed['subject']).toBe('lti.frameResize');
    expect(typeof parsed['height']).toBe('number');
    dispose();
  });

  it('debounces body resizes by 500 ms and reposts', () => {
    const dispose = installFrameResize(win);
    expect(observed).toContain(document.body);
    posted.length = 0;
    resizeCallback!([{ target: document.body }]);
    resizeCallback!([{ target: document.body }]);
    expect(posted).toHaveLength(0);
    vi.advanceTimersByTime(FRAME_RESIZE_DEBOUNCE - 1);
    expect(posted).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(posted).toHaveLength(1);
    const parsed = JSON.parse(posted[0]!.message as string) as Record<string, unknown>;
    expect(parsed['height']).toBeGreaterThanOrEqual(FRAME_RESIZE_PADDING);
    dispose();
  });

  it('ignores resizes of other elements (legacy loops for body only)', () => {
    const dispose = installFrameResize(win);
    posted.length = 0;
    resizeCallback!([{ target: document.createElement('div') }]);
    vi.advanceTimersByTime(FRAME_RESIZE_DEBOUNCE);
    expect(posted).toHaveLength(0);
    dispose();
  });
});

describe('checkCookies (frontend/site/core.ts:20-27)', () => {
  it('returns true when navigator reports cookies enabled', () => {
    expect(checkCookies(document, { cookieEnabled: true } as Navigator)).toBe(true);
  });

  it('falls back to writing a testcookie when navigator says disabled', () => {
    // jsdom allows cookie writes, so the fallback probe succeeds.
    expect(checkCookies(document, { cookieEnabled: false } as Navigator)).toBe(true);
    expect(document.cookie).toContain('testcookie');
  });
});

describe('generateUUID (frontend/utilities/random.ts:31-45)', () => {
  it('produces v4-shaped UUIDs', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(generateUUID()).not.toBe(uuid);
  });
});

describe('installCookieFallback (§13, editor.html:27-99)', () => {
  const makeWin = (cookieEnabled: boolean) => {
    const posted: Array<{ message: Record<string, unknown>; origin: unknown }> = [];
    const listeners: Array<(event: MessageEvent) => void> = [];
    const store: Record<string, unknown> = {};
    const win = {
      document,
      navigator: { cookieEnabled } as Navigator,
      parent: {
        postMessage: (message: Record<string, unknown>, origin: unknown) =>
          posted.push({ message, origin }),
      },
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) =>
        listeners.push(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    } as unknown as Window;
    Object.assign(win, store);
    return { win, posted, listeners };
  };

  it('publishes ltiLoadedCorrectly and skips the handshake when cookies work', () => {
    const { win, posted, listeners } = makeWin(true);
    const result = installCookieFallback(win);
    expect(result.loadedCorrectly).toBe(true);
    expect((win as unknown as Record<string, unknown>)['ltiLoadedCorrectly']).toBe(true);
    expect(posted).toHaveLength(0);
    expect(listeners).toHaveLength(0);
  });

  it('logs the verbatim error and posts state + nonce put_data with generated UUIDs (LD-14)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // jsdom cookies always work, so force the probe to fail via a document
    // stub whose cookie write does not stick.
    const { win, posted } = makeWin(false);
    (win as unknown as { document: unknown }).document = {
      get cookie() {
        return '';
      },
      set cookie(_value: string) {
        /* blocked */
      },
    };
    let counter = 0;
    const result = installCookieFallback(win, () => `uuid-${++counter}`);
    try {
      expect(result.loadedCorrectly).toBe(false);
      expect((win as unknown as Record<string, unknown>)['ltiLoadedCorrectly']).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(COOKIE_ERROR_MESSAGE);
      expect(posted).toHaveLength(2);
      // message_id shared; key/value carry the GENERATED ids (legacy posted
      // literal "<state_id>" placeholders - fixed per §13, ledger LD-14).
      expect(posted[0]!.message).toEqual({
        subject: 'lti.put_data',
        message_id: 'uuid-1',
        key: 'blockpy_uuid-2',
        value: 'uuid-2',
      });
      expect(posted[1]!.message).toEqual({
        subject: 'lti.put_data',
        message_id: 'uuid-1',
        key: 'nonce_uuid-3',
        value: 'uuid-3',
      });
      expect(posted[0]!.origin).toBe('*');
    } finally {
      errorSpy.mockRestore();
      result.dispose();
    }
  });

  it('validates responses with the legacy ladder (origin check unreachable while "*")', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { win, listeners } = makeWin(false);
    (win as unknown as { document: unknown }).document = {
      get cookie() {
        return '';
      },
      set cookie(_value: string) {
        /* blocked */
      },
    };
    let counter = 0;
    const result = installCookieFallback(win, () => `uuid-${++counter}`);
    try {
      expect(listeners).toHaveLength(1);
      const fire = (data: unknown, origin: string) =>
        listeners[0]!({ data, origin } as MessageEvent);
      fire('not-an-object', 'https://platform.example');
      fire({ subject: 'other' }, 'https://platform.example');
      fire({ subject: 'lti.put_data.response', message_id: 'wrong' }, 'https://platform.example');
      // Correct subject + id, but origin can never equal '*': rejected.
      fire({ subject: 'lti.put_data.response', message_id: 'uuid-1' }, 'https://platform.example');
      expect(logSpy).not.toHaveBeenCalledWith('Success! State and nonce values were stored.');
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
      result.dispose();
    }
  });
});

describe('loading screen (§13, editor.html:20-23, 383)', () => {
  it('renders the verbatim Safari notice with an optional retry link', () => {
    expect(loadingNoticeHtml()).toContain(LOADING_NOTICE_TEXT);
    expect(loadingNoticeHtml()).not.toContain('<a');
    const withRetry = loadingNoticeHtml('/assignments/load?assignment_id=7');
    expect(withRetry).toContain('href="/assignments/load?assignment_id=7"');
    expect(withRetry).toContain('Click here to try again');
  });

  it('removes every .delete-on-load element', () => {
    document.body.innerHTML = `<span class="delete-on-load">a</span><div><p class="delete-on-load">b</p></div>`;
    removeLoadingScreen(document);
    expect(document.querySelectorAll('.delete-on-load')).toHaveLength(0);
  });
});

describe('emoji proxy (§13, editor.html:294)', () => {
  it('maps parts to lowercased .svg paths under the proxy base', () => {
    expect(emojiProxyUrl('/emoji/', '1F600')).toBe('/emoji/1f600.svg');
    expect(makeEmojiProxy('https://cdn.example/emoji/')('1F62E')).toBe(
      'https://cdn.example/emoji/1f62e.svg',
    );
  });
});
