// @vitest-environment jsdom
/**
 * §15.3 window.frontend stub: constructor compatibility with
 * frontend/services/server.ts:44 and makeBlockPyRequest stamping
 * (server.ts:65-70); never clobbers a real bundle.
 */
import { describe, expect, it } from 'vitest';
import { Server, installFrontendStub } from './frontend-stub';

describe('installFrontendStub (§15.3)', () => {
  it('publishes checkCookies/generateUUID/Server when frontend is absent', () => {
    const target: Record<string, unknown> = {};
    expect(installFrontendStub(target)).toBe(true);
    const frontend = target['frontend'] as Record<string, unknown>;
    expect(typeof frontend['checkCookies']).toBe('function');
    expect(typeof frontend['generateUUID']).toBe('function');
    expect(frontend['Server']).toBe(Server);
  });

  it('leaves a real frontend bundle untouched', () => {
    const real = { checkCookies: () => true };
    const target: Record<string, unknown> = { frontend: real };
    expect(installFrontendStub(target)).toBe(false);
    expect(target['frontend']).toBe(real);
  });
});

describe('Server stub (server.ts:44, 65-70)', () => {
  it('accepts the editor.html:237-241 constructor shape', () => {
    const server = new Server(12, {}, { users: [{ id: 1 }], courses: [] });
    expect(server.courseId).toBe(12);
  });

  it('stamps timestamp and timezone onto payloads', () => {
    const server = new Server(null);
    const payload: Record<string, unknown> = { assignment_id: 5 };
    const result = server.makeBlockPyRequest(payload);
    expect(result).toBe(payload);
    expect(typeof result['timestamp']).toBe('number');
    expect(result['timezone']).toBe(new Date().getTimezoneOffset());
  });
});
