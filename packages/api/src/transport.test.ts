/**
 * Transport conformance: auth placement (A2 §1.1), queue semantics (A2 §2)
 * with the D2-B fixes (ledger LD-2a/2b/2c).
 */
import { describe, expect, it, vi } from 'vitest';
import { encodeForm, Transport, type FetchLike } from './transport';

const okFetch =
  (responses: Array<Record<string, unknown>> = []): FetchLike =>
  async () => ({
    ok: true,
    json: async () => responses.shift() ?? { success: true, ip: '127.0.0.1' },
  });

describe('auth placement (A2 §1.1)', () => {
  it('sends the access token as a Bearer header, never in the body', async () => {
    let captured: { headers: Record<string, string>; body: string } | undefined;
    const fetch: FetchLike = async (_url, init) => {
      captured = init;
      return { ok: true, json: async () => ({ success: true }) };
    };
    const t = new Transport({ fetch, accessToken: 'tok123', schedule: (fn) => fn() });
    await t.post('/x', { a: 1 });
    expect(captured!.headers['Authorization']).toBe('Bearer tok123');
    expect(captured!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(captured!.body).not.toContain('tok123');
  });

  it('form-encodes null/undefined as empty strings (jQuery parity)', () => {
    expect(encodeForm({ a: null, b: 0, c: false, d: 'x' })).toBe('a=&b=0&c=false&d=x');
  });
});

describe('retry (A2 §2)', () => {
  it('retries transport failures with linear backoff and resolves', async () => {
    const delays: number[] = [];
    let failures = 2;
    const fetch: FetchLike = async () => {
      if (failures-- > 0) throw new Error('offline');
      return { ok: true, json: async () => ({ success: true }) };
    };
    const t = new Transport({
      fetch,
      schedule: (fn, ms) => {
        delays.push(ms);
        fn();
      },
    });
    const response = await t.postRetry('/x', { a: 1 });
    expect(response.success).toBe(true);
    expect(delays).toEqual([0, 2000, 4000]); // legacy FAIL_DELAY ladder
  });

  it('does NOT retry logical failures (success: false)', async () => {
    const fetch = vi.fn(okFetch([{ success: false }]));
    const t = new Transport({ fetch, schedule: (fn) => fn() });
    const response = await t.postRetry('/x', { a: 1 });
    expect(response.success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('offline queue (A2 §2 + LD-2b)', () => {
  const make = () => new Transport({ fetch: okFetch(), schedule: (fn) => fn() });

  it('dedupes exact payloads and trims oldest past 200', () => {
    const t = make();
    t.enqueue({ n: 1 });
    t.enqueue({ n: 1 });
    expect(t.queuedPayloads()).toHaveLength(1);
    for (let i = 0; i < 220; i++) t.enqueue({ n: i });
    expect(t.queuedPayloads()).toHaveLength(200);
    expect(t.queuedPayloads()[0]).toEqual({ n: 20 }); // oldest trimmed
  });

  it('LD-2b: dequeue removes exactly one entry, not the tail', () => {
    const t = make();
    t.enqueue({ n: 1 });
    t.enqueue({ n: 2 });
    t.enqueue({ n: 3 });
    t.dequeue({ n: 1 }); // legacy splice(0) would have wiped ALL entries
    expect(t.queuedPayloads()).toEqual([{ n: 2 }, { n: 3 }]);
  });

  it('flushes LIFO (newest first) and stops on transport failure', async () => {
    const posted: unknown[] = [];
    let online = true;
    const fetch: FetchLike = async (_url, init) => {
      if (!online) throw new Error('offline');
      posted.push(Object.fromEntries(new URLSearchParams(init.body)));
      return { ok: true, json: async () => ({ success: true }) };
    };
    const t = new Transport({ fetch, schedule: (fn) => fn() });
    t.enqueue({ n: 1 });
    t.enqueue({ n: 2 });
    t.enqueue({ n: 3 });
    expect(await t.flushQueue('/log')).toBe(3);
    expect(posted.map((p) => (p as { n: string }).n)).toEqual(['3', '2', '1']);

    t.enqueue({ n: 4 });
    online = false;
    expect(await t.flushQueue('/log')).toBe(0);
    expect(t.queuedPayloads()).toEqual([{ n: 4 }]); // intact while offline
  });
});

describe('IP-change detection (LD-2c)', () => {
  it('fires on every response path when the reported IP changes', async () => {
    const changes: string[] = [];
    const t = new Transport({
      fetch: okFetch([
        { success: true, ip: '1.1.1.1' },
        { success: true, ip: '2.2.2.2' },
      ]),
      schedule: (fn) => fn(),
      onIpChange: (oldIp, newIp) => changes.push(`${oldIp}->${newIp}`),
    });
    await t.postRetry('/x', {});
    await t.postRetry('/x', {}); // legacy's _postRetry path never detected this
    expect(changes).toEqual(['1.1.1.1->2.2.2.2']);
  });
});
