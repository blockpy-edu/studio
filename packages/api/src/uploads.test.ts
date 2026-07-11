/**
 * Uploaded-files endpoints (spec §14.2; legacy server.js:468-544): the
 * multipart form path and the client methods' exact field names.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient } from './client';
import { MemoryStorage, Transport, type FetchLike } from './transport';
import type { ApiContext } from './context';

interface Call {
  url: string;
  body: string | FormData;
  headers: Record<string, string>;
}

function harness(responses: Array<{ ok: boolean; payload?: unknown; text?: string }>) {
  const calls: Call[] = [];
  let index = 0;
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return {
      ok: next.ok,
      json: async () => next.payload ?? { success: true },
      text: async () => next.text ?? '',
    };
  };
  const context: ApiContext = {
    assignmentId: 101,
    assignmentGroupId: 11,
    courseId: 1,
    submissionId: 5001,
    userId: 42,
    submissionVersion: 7,
    assignmentVersion: 3,
    passcode: '',
    partId: '',
  };
  const transport = new Transport({
    accessToken: 'tok-1',
    fetch: fetchStub,
    storage: new MemoryStorage(),
    schedule: (fn) => fn(), // collapse backoff delays
  });
  const api = new ApiClient({
    urls: {
      listUploadedFiles: '/list',
      uploadFile: '/upload',
      downloadFile: '/download',
      renameFile: '/rename',
    },
    context,
    transport,
  });
  return { api, transport, calls };
}

const formEntries = (body: string | FormData): Record<string, unknown> =>
  Object.fromEntries((body as FormData).entries());

describe('multipart uploads transport (server.js FormData paths)', () => {
  it('uploadFile sends multipart with base payload + file fields', async () => {
    const { api, calls } = harness([{ ok: true, payload: { success: true } }]);
    await api.uploadFile('assignment', 101, 'data.csv', new Blob(['x,y']));
    const fields = formEntries(calls[0]!.body);
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(fields['placement']).toBe('assignment');
    expect(fields['directory']).toBe('101');
    expect(fields['filename']).toBe('data.csv');
    expect(fields['contents']).toBeInstanceOf(Blob);
    expect(fields['assignment_id']).toBe('101'); // base payload rides along
    expect(fields['delete']).toBeUndefined();
    // Browser must set the multipart boundary — no Content-Type header.
    expect(calls[0]!.headers['Content-Type']).toBeUndefined();
    expect(calls[0]!.headers['Authorization']).toBe('Bearer tok-1');
  });

  it('delete = upload with empty contents + delete flag (images.js:239)', async () => {
    const { api, calls } = harness([{ ok: true, payload: { success: true } }]);
    await api.uploadFile('submission', 5001, 'old.png', '', true);
    const fields = formEntries(calls[0]!.body);
    expect(fields['contents']).toBe('');
    expect(fields['delete']).toBe('true');
  });

  it('downloadFile returns the raw text body (dataType: "text")', async () => {
    const { api } = harness([{ ok: true, text: 'France,Paris\n' }]);
    await expect(api.downloadFile('assignment', 101, 'capitals.txt')).resolves.toBe(
      'France,Paris\n',
    );
  });

  it('renameFile sends old_filename/new_filename', async () => {
    const { api, calls } = harness([{ ok: true, payload: { success: true } }]);
    await api.renameFile('course', 1, 'a.png', 'b.png');
    const fields = formEntries(calls[0]!.body);
    expect(fields['old_filename']).toBe('a.png');
    expect(fields['new_filename']).toBe('b.png');
  });

  it('retries transport failures with finite attempts, then throws', async () => {
    const { api, calls } = harness([{ ok: false }]);
    await expect(api.renameFile('course', 1, 'a', 'b')).rejects.toThrow();
    expect(calls).toHaveLength(3); // legacy _postBlocking attempts
  });

  it('read-only blocks mutations but not listing/downloading', async () => {
    const calls: Call[] = [];
    const fetchStub: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body, headers: init.headers });
      return {
        ok: true,
        json: async () => ({ success: true, files: {} }),
        text: async () => 'body',
      };
    };
    const { api } = harness([{ ok: true }]);
    const readOnlyApi = new ApiClient({
      urls: { listUploadedFiles: '/list', uploadFile: '/upload', downloadFile: '/download', renameFile: '/rename' },
      context: api.context,
      transport: new Transport({ fetch: fetchStub, storage: new MemoryStorage(), schedule: (fn) => fn() }),
      readOnly: () => true,
    });
    expect((await readOnlyApi.uploadFile('user', 42, 'f.txt', 'x')).readOnly).toBe(true);
    expect((await readOnlyApi.renameFile('user', 42, 'a', 'b')).readOnly).toBe(true);
    await readOnlyApi.listUploadedFiles();
    await readOnlyApi.downloadFile('user', 42, 'f.txt');
    expect(calls.filter((call) => call.url === '/upload' || call.url === '/rename')).toHaveLength(0);
  });
});
