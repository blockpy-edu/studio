/**
 * Golden-transcript replay harness — first cut of the G3 gate (spec §16.2).
 * For every request the LEGACY client made in the recorded session (A5),
 * assert that our client, given the same inputs, produces the same field
 * set on the wire. Field VALUES for context fields are also compared where
 * they are deterministic (ids, version); timestamps are shape-checked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiClient } from './client';
import type { ApiContext } from './context';
import { Transport, type FetchLike } from './transport';

interface HarEntry {
  request: {
    method: string;
    url: string;
    postData?: { text?: string };
  };
}

const HAR_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'appendices',
  'transcripts',
  'group189-anonymous.har',
);
const har = JSON.parse(readFileSync(HAR_PATH, 'utf8')) as {
  log: { entries: HarEntry[] };
};

const postEntries = (path: string): HarEntry[] =>
  har.log.entries.filter(
    (e) => e.request.method === 'POST' && new URL(e.request.url).pathname.endsWith(path),
  );

const fieldsOf = (entry: HarEntry): Map<string, string> => {
  const params = new URLSearchParams(entry.request.postData?.text ?? '');
  return new Map(params.entries());
};

/** Build a client whose transport records instead of sending. */
function recordingClient(context: ApiContext) {
  const sent: Array<{ url: string; body: URLSearchParams }> = [];
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, body: new URLSearchParams(init.body) });
    return { ok: true, json: async () => ({ success: true, ip: '127.0.0.1' }) };
  };
  const transport = new Transport({ fetch, schedule: (fn) => fn() });
  const client = new ApiClient({
    urls: {
      loadAssignment: '/blockpy/load_assignment',
      saveFile: '/blockpy/save_file',
      logEvent: '/blockpy/log_event',
      updateSubmission: '/blockpy/update_submission',
    },
    context,
    transport,
    now: () => new Date(1783706305312),
  });
  return { client, sent };
}

/** The context the recorded anonymous session ran under (visible in the HAR). */
function transcriptContext(entry: HarEntry): ApiContext {
  const f = fieldsOf(entry);
  const int = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
  return {
    assignmentId: int('assignment_id'),
    assignmentGroupId: int('assignment_group_id'),
    courseId: int('course_id'),
    submissionId: int('submission_id'),
    userId: int('user_id'),
    submissionVersion: Number(f.get('version') ?? 0),
    assignmentVersion: Number(f.get('assignment_version') ?? 0),
    passcode: f.get('passcode') ?? '',
    partId: f.get('part_id') ?? '',
  };
}

function expectSameFields(
  ours: URLSearchParams,
  legacy: Map<string, string>,
  opts: { allowMissing?: string[] } = {},
) {
  const ourKeys = new Set([...ours.keys()]);
  for (const key of legacy.keys()) {
    expect(ourKeys, `missing legacy field "${key}"`).toContain(key);
  }
  for (const key of ourKeys) {
    if (opts.allowMissing?.includes(key)) continue;
    expect([...legacy.keys()], `extra field "${key}" not in legacy request`).toContain(key);
  }
}

describe('G3 replay: request field parity with the legacy transcript', () => {
  it('covers the transcript endpoints', () => {
    expect(postEntries('/blockpy/save_file').length).toBeGreaterThan(0);
    expect(postEntries('/blockpy/log_event').length).toBeGreaterThan(0);
    expect(postEntries('/blockpy/update_submission').length).toBeGreaterThan(0);
    expect(postEntries('/blockpy/load_assignment').length).toBeGreaterThan(0);
  });

  it('save_file matches the legacy field set and values', async () => {
    for (const entry of postEntries('/blockpy/save_file')) {
      const legacy = fieldsOf(entry);
      const { client, sent } = recordingClient(transcriptContext(entry));
      await client.saveFile(legacy.get('filename')!, legacy.get('code')!);
      const ours = sent[0]!.body;
      // legacy save_file omits assignment_version/part_id — ours includes the
      // full base payload; extra base fields are harmless (server reads by
      // name) but tracked here so any change is deliberate:
      expectSameFields(ours, legacy, { allowMissing: ['assignment_version', 'part_id'] });
      for (const key of ['assignment_id', 'course_id', 'filename', 'code', 'version'] as const) {
        expect(ours.get(key)).toBe(legacy.get(key));
      }
      expect(Number(ours.get('timestamp'))).toBeGreaterThan(0);
    }
  });

  it('log_event matches the legacy field set', async () => {
    for (const entry of postEntries('/blockpy/log_event')) {
      const legacy = fieldsOf(entry);
      const { client, sent } = recordingClient(transcriptContext(entry));
      await client.logEvent(
        legacy.get('event_type')!,
        legacy.get('category') ?? '',
        legacy.get('label') ?? '',
        legacy.get('message') ?? '',
        legacy.get('file_path') ?? '',
      );
      const ours = sent[0]!.body;
      expectSameFields(ours, legacy, {
        allowMissing: ['assignment_version', 'part_id', 'extended'],
      });
      expect(ours.get('event_type')).toBe(legacy.get('event_type'));
      expect(ours.get('category')).toBe(legacy.get('category'));
      expect(ours.get('message')).toBe(legacy.get('message'));
    }
  });

  it('update_submission matches the legacy field set', async () => {
    const BASE_FIELDS = new Set([
      'assignment_id',
      'assignment_group_id',
      'course_id',
      'submission_id',
      'user_id',
      'version',
      'assignment_version',
      'timestamp',
      'timezone',
      'passcode',
      'part_id',
    ]);
    for (const entry of postEntries('/blockpy/update_submission')) {
      const legacy = fieldsOf(entry);
      const { client, sent } = recordingClient(transcriptContext(entry));
      // forward whatever extras legacy sent (status/correct always; the
      // grading call additionally carries score/image)
      const extras: Record<string, string> = {};
      for (const [key, value] of legacy) {
        if (!BASE_FIELDS.has(key)) extras[key] = value;
      }
      await client.updateSubmission(extras);
      const ours = sent[0]!.body;
      expectSameFields(ours, legacy, {
        allowMissing: ['assignment_version', 'part_id', 'version'],
      });
      for (const [key, value] of Object.entries(extras)) {
        expect(ours.get(key), key).toBe(value);
      }
    }
  });

  it('load_assignment matches the legacy field set exactly', async () => {
    for (const entry of postEntries('/blockpy/load_assignment')) {
      const legacy = fieldsOf(entry);
      const { client, sent } = recordingClient(transcriptContext(entry));
      await client.loadAssignment(Number(legacy.get('assignment_id')));
      expectSameFields(sent[0]!.body, legacy);
    }
  });
});
