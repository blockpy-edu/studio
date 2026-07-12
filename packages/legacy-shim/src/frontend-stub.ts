/**
 * `window.frontend` minimal surface (spec §15.3): enough that unmodified
 * server templates keep working during migration. Templates call
 * `frontend.checkCookies()` (editor.html:27-28, textbook.html:46),
 * `frontend.generateUUID()` (editor.html:42-43), and construct
 * `new frontend.Server(courseId, initialIds, initialData)`
 * (editor.html:237-241) to feed the knockout components Studio replaces.
 *
 * The real `Server` (frontend/services/server.ts) is a knockout store hub;
 * the only behavior template code drives directly is the constructor shape
 * and `makeBlockPyRequest`'s timestamp/timezone stamping (server.ts:65-70)
 * — everything else delegates to `@blockpy/api` inside the mounted app.
 */
import { checkCookies, generateUUID } from '@blockpy/lti-embed';

export class Server {
  courseId: number | null;

  constructor(courseId: number | null, _initialIds?: unknown, _initialData?: unknown) {
    this.courseId = courseId;
  }

  /** server.ts:65-70, verbatim semantics. */
  makeBlockPyRequest(payload: Record<string, unknown>): Record<string, unknown> {
    const now = new Date();
    payload['timestamp'] = now.getTime();
    payload['timezone'] = now.getTimezoneOffset();
    return payload;
  }
}

/**
 * Publish `window.frontend` unless the REAL bundle already owns it (shim
 * pages that still load the legacy frontend script must win). Returns
 * whether the stub was installed.
 */
export function installFrontendStub(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): boolean {
  if (target['frontend'] !== undefined) return false;
  target['frontend'] = { checkCookies, generateUUID, Server };
  return true;
}
