/**
 * Fork flow endpoint + ownership decode (M7.9, LD-42). Wire contract per
 * the WORKING server route `/assignments/fork` (assignments.py:133-178);
 * the trigger is save_assignment rejecting with forkable=true
 * (helpers.py:55-60).
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client';
import { decodeAssignment } from './decoder';
import type { Transport } from './transport';
import type { ApiContext } from './context';

const CONTEXT: ApiContext = {
  assignmentId: 7,
  assignmentGroupId: 3,
  courseId: 1,
  submissionId: null,
  userId: 9,
  submissionVersion: 0,
  assignmentVersion: 0,
  passcode: '',
  partId: '',
};

describe('ApiClient.forkAssignment (M7.9, LD-42)', () => {
  it('posts assignment_id (+ optional url/group) with the base payload', async () => {
    const postRetry = vi.fn(() => Promise.resolve({ success: true, id: 99 }));
    const client = new ApiClient({
      urls: { forkAssignment: '/assignments/fork' },
      context: { ...CONTEXT },
      transport: { postRetry } as unknown as Transport,
      now: () => new Date(0),
    });
    await client.forkAssignment(42, { url: 'my_copy' });
    const [url, payload] = postRetry.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe('/assignments/fork');
    expect(payload['assignment_id']).toBe(42);
    expect(payload['url']).toBe('my_copy');
    expect(payload['group']).toBeUndefined();
    // The owning course comes from the base context payload.
    expect(payload['course_id']).toBe(1);
    // Minimal call: no url/group fields at all.
    await client.forkAssignment(42);
    const [, minimal] = postRetry.mock.calls[1] as unknown as [string, Record<string, unknown>];
    expect('url' in minimal).toBe(false);
    expect('group' in minimal).toBe(false);
  });

  it('is capability-detected and read-only-guarded', async () => {
    const postRetry = vi.fn(() => Promise.resolve({ success: true }));
    const unconnected = new ApiClient({
      urls: {},
      context: { ...CONTEXT },
      transport: { postRetry } as unknown as Transport,
    });
    expect(unconnected.isEndpointConnected('forkAssignment')).toBe(false);
    const readOnly = new ApiClient({
      urls: { forkAssignment: '/fork' },
      context: { ...CONTEXT },
      transport: { postRetry } as unknown as Transport,
      readOnly: () => true,
    });
    expect((await readOnly.forkAssignment(1)).success).toBe(false);
    expect(postRetry).not.toHaveBeenCalled();
  });
});

describe('decodeAssignment ownership fields (M7.9)', () => {
  it('surfaces owner/course/forked ids; absent → null; raw untouched', () => {
    const decoded = decodeAssignment({
      id: 7,
      name: 'A',
      owner_id: 12,
      course_id: 34,
      forked_id: 56,
      forked_version: 2,
    });
    expect(decoded.ownerId).toBe(12);
    expect(decoded.courseId).toBe(34);
    expect(decoded.forkedId).toBe(56);
    expect(decoded.forkedVersion).toBe(2);
    expect(decoded.raw['owner_id']).toBe(12);
    const bare = decodeAssignment({ id: 7 });
    expect(bare.ownerId).toBeNull();
    expect(bare.courseId).toBeNull();
    expect(bare.forkedId).toBeNull();
    expect(bare.forkedVersion).toBeNull();
  });
});
