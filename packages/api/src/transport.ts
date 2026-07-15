/**
 * Form-encoded POST transport with the legacy retry/queue semantics
 * (A2 §1-2), with the D2-B fixes (ledger LD-2b/LD-2c):
 *
 * - per-request POST, `application/x-www-form-urlencoded` (never JSON)
 * - auth: `Authorization: Bearer <accessToken>` header ONLY - the access
 *   token is never a body parameter (A2 §1.1)
 * - transport failures retry with unbounded linear backoff (+2000 ms/try,
 *   legacy FAIL_DELAY); logical failures (`success: false`) do NOT retry
 * - offline queue: max 200 entries, oldest trimmed, exact-duplicate payloads
 *   not enqueued twice, flushed LIFO on boot - all legacy semantics - but
 *   dequeue removes ONE entry (legacy's `splice(index)` wiped the tail,
 *   LD-2b) and IP-change detection works on the retry path (LD-2c).
 */
import type { WirePayload } from './context';

export interface LegacyResponse {
  success?: boolean;
  ip?: string;
  [key: string]: unknown;
}

export type FetchLike = (
  url: string,
  // GET has no body - it exists solely for /assignments/by_url (M4.7).
  init: { method: 'POST' | 'GET'; headers: Record<string, string>; body?: string | FormData },
) => Promise<{ ok: boolean; json(): Promise<unknown>; text?(): Promise<string> }>;

/** Minimal key-value storage (localStorage-compatible subset). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const FAIL_DELAY_MS = 2000; // legacy server.js:44
const QUEUE_LIMIT = 200; // legacy server.js:38-41
const QUEUE_KEY = 'BLOCKPY_logEvent_value'; // legacy storage.js:38-41

export interface TransportOptions {
  accessToken?: string;
  fetch: FetchLike;
  storage?: StorageLike;
  /** Called when the server-reported IP differs from the last seen one. */
  onIpChange?: (oldIp: string, newIp: string) => void;
  /** Scheduler injection for tests; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
  /** Retry ceiling for tests; legacy is unbounded. */
  maxRetries?: number;
}

export function encodeForm(payload: WirePayload): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    // jQuery serializes undefined/null as empty strings on the wire
    params.set(key, value === null || value === undefined ? '' : String(value));
  }
  return params.toString();
}

export class Transport {
  private storage: StorageLike;
  private schedule: (fn: () => void, ms: number) => void;
  private lastIp: string | null = null;

  constructor(private options: TransportOptions) {
    this.storage = options.storage ?? new MemoryStorage();
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  }

  headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.options.accessToken) {
      headers['Authorization'] = `Bearer ${this.options.accessToken}`;
    }
    return headers;
  }

  /** One POST, no retry. Returns the parsed legacy envelope. */
  async post(url: string, payload: WirePayload): Promise<LegacyResponse> {
    const response = await this.options.fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: encodeForm(payload),
    });
    if (!response.ok) throw new Error(`POST ${url} failed at transport level`);
    const parsed = (await response.json()) as LegacyResponse;
    if (typeof parsed.ip === 'string') this.checkIp(parsed.ip);
    return parsed;
  }

  /**
   * Plain GET with query params (M4.7): the `/assignments/by_url` route is
   * GET-only (assignments.py:341-342) - the only legacy endpoint we call
   * that refuses POST. No retry loop; resolution failures are cosmetic
   * (Missing Reading style) so callers fail soft.
   */
  async getJson(url: string, params: Record<string, string | number>): Promise<LegacyResponse> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      query.set(key, String(value));
    }
    const headers: Record<string, string> = {};
    if (this.options.accessToken) {
      headers['Authorization'] = `Bearer ${this.options.accessToken}`;
    }
    const separator = url.includes('?') ? '&' : '?';
    const response = await this.options.fetch(`${url}${separator}${query.toString()}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error(`GET ${url} failed at transport level`);
    const parsed = (await response.json()) as LegacyResponse;
    if (typeof parsed.ip === 'string') this.checkIp(parsed.ip);
    return parsed;
  }

  /**
   * POST with the legacy retry loop: transport failures reschedule with
   * linear backoff; logical failures resolve immediately (never retried).
   */
  postRetry(url: string, payload: WirePayload, delayMs = 0): Promise<LegacyResponse> {
    return new Promise((resolve, reject) => {
      const attempt = (currentDelay: number, tries: number) => {
        this.schedule(() => {
          this.post(url, payload).then(resolve, () => {
            if (this.options.maxRetries !== undefined && tries >= this.options.maxRetries) {
              reject(new Error(`POST ${url} exhausted retries`));
              return;
            }
            attempt(currentDelay + FAIL_DELAY_MS, tries + 1);
          });
        }, currentDelay);
      };
      attempt(delayMs, 0);
    });
  }

  /**
   * Multipart POST for the uploads endpoints (legacy `_postBlocking` with
   * FormData, server.js:480-544): the browser sets the multipart boundary
   * (no Content-Type header), finite attempts with the legacy FAIL_DELAY
   * backoff, throwing after exhaustion so callers can show their dialog.
   * `text: true` returns the raw body (downloadFile, jQuery dataType:text).
   */
  async postForm(
    url: string,
    fields: Record<string, string | number | boolean | null | Blob>,
    options: { attempts?: number; text?: boolean } = {},
  ): Promise<LegacyResponse | string> {
    const attempts = options.attempts ?? 3;
    const headers: Record<string, string> = {};
    if (this.options.accessToken) {
      headers['Authorization'] = `Bearer ${this.options.accessToken}`;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => this.schedule(() => resolve(undefined), FAIL_DELAY_MS));
      }
      try {
        const body = new FormData();
        for (const [key, value] of Object.entries(fields)) {
          if (value instanceof Blob) body.append(key, value);
          else body.append(key, value === null || value === undefined ? '' : String(value));
        }
        const response = await this.options.fetch(url, { method: 'POST', headers, body });
        if (!response.ok) throw new Error(`POST ${url} failed at transport level`);
        if (options.text) {
          if (!response.text) throw new Error('fetch implementation lacks text()');
          return response.text();
        }
        const parsed = (await response.json()) as LegacyResponse;
        if (typeof parsed.ip === 'string') this.checkIp(parsed.ip);
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`POST ${url} exhausted attempts`);
  }

  /** LD-2c: functional IP-change detection on every response path. */
  private checkIp(newIp: string): void {
    if (this.lastIp !== null && this.lastIp !== newIp) {
      this.options.onIpChange?.(this.lastIp, newIp);
    }
    this.lastIp = newIp;
  }

  // -- offline event queue (legacy FaultResistantCache semantics) -----------

  private readQueue(): string[] {
    const raw = this.storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }

  private writeQueue(queue: string[]): void {
    this.storage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  /** Enqueue (dedupe exact payloads; trim oldest past 200 - legacy). */
  enqueue(payload: WirePayload): void {
    const entry = JSON.stringify(payload);
    const queue = this.readQueue();
    if (queue.includes(entry)) return;
    queue.push(entry);
    while (queue.length > QUEUE_LIMIT) queue.shift();
    this.writeQueue(queue);
  }

  /** LD-2b: remove exactly one matching entry (legacy wiped the tail). */
  dequeue(payload: WirePayload): void {
    const entry = JSON.stringify(payload);
    const queue = this.readQueue();
    const index = queue.indexOf(entry);
    if (index === -1) return;
    queue.splice(index, 1);
    this.writeQueue(queue);
  }

  queuedPayloads(): WirePayload[] {
    return this.readQueue().map((e) => JSON.parse(e) as WirePayload);
  }

  /**
   * Boot-time flush: LIFO, newest-first (legacy `checkCaches` uses `.pop()`),
   * one at a time, continuing only after each success.
   */
  async flushQueue(url: string): Promise<number> {
    let flushed = 0;
    for (;;) {
      const queue = this.readQueue();
      const entry = queue.pop();
      if (entry === undefined) break;
      const payload = JSON.parse(entry) as WirePayload;
      try {
        const response = await this.post(url, payload);
        if (response.success === false) break;
        this.writeQueue(queue);
        flushed += 1;
      } catch {
        break; // still offline; keep the queue intact
      }
    }
    return flushed;
  }
}
