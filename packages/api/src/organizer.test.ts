/** Group-organizer endpoints (M4.6 slice 1, LD-28). */
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client';
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

function makeClient(urls: Record<string, string>) {
  const postRetry = vi.fn(() => Promise.resolve({ success: true }));
  const client = new ApiClient({
    urls,
    context: { ...CONTEXT },
    transport: { postRetry } as unknown as Transport,
    now: () => new Date(0),
  });
  return { client, postRetry };
}

describe('ApiClient group organizer endpoints', () => {
  it('editAssignmentGroup posts new_name/new_url with the base payload', async () => {
    const { client, postRetry } = makeClient({
      editAssignmentGroup: '/assignment_group/edit',
    });
    await client.editAssignmentGroup({
      assignment_group_id: 3,
      new_name: 'Week 2',
      new_url: 'week2',
    });
    expect(postRetry).toHaveBeenCalledTimes(1);
    const [url, payload] = postRetry.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe('/assignment_group/edit');
    expect(payload['assignment_group_id']).toBe(3);
    expect(payload['new_name']).toBe('Week 2');
    expect(payload['new_url']).toBe('week2');
    // The eleven base fields ride along (createServerData).
    expect(payload['user_id']).toBe(9);
    expect(payload['course_id']).toBe(1);
  });

  it('moveMembership posts the id triple; -1 removes', async () => {
    const { client, postRetry } = makeClient({
      moveMembership: '/assignment_group/move_membership',
    });
    await client.moveMembership({
      assignment_id: 42,
      old_group_id: 3,
      new_group_id: -1,
    });
    const [, payload] = postRetry.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(payload['assignment_id']).toBe(42);
    expect(payload['old_group_id']).toBe(3);
    expect(payload['new_group_id']).toBe(-1);
  });

  it('endpoints are capability-detected (templates must publish the keys)', () => {
    const { client } = makeClient({ saveAssignment: '/save' });
    expect(client.isEndpointConnected('editAssignmentGroup')).toBe(false);
    expect(client.isEndpointConnected('moveMembership')).toBe(false);
    expect(client.isEndpointConnected('saveAssignment')).toBe(true);
  });

  it('loadAssignmentByUrl GETs /assignments/by_url and maps the record (M4.7/LD-16)', async () => {
    const getJson = vi.fn(() =>
      Promise.resolve({
        success: true,
        assignment: { id: 55, name: 'Reading: Variables', url: 'reading_variables' },
      }),
    );
    const client = new ApiClient({
      urls: { loadAssignmentByUrl: '/assignments/by_url' },
      context: { ...CONTEXT },
      transport: { getJson } as unknown as Transport,
    });
    const resolved = await client.loadAssignmentByUrl('reading_variables');
    expect(resolved).toEqual({
      id: 55,
      name: 'Reading: Variables',
      url: 'reading_variables',
    });
    const [url, params] = getJson.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe('/assignments/by_url');
    expect(params['url']).toBe('reading_variables');
    expect(params['course_id']).toBe(1);
  });

  it('loadAssignmentByUrl fails soft: no key, logical failure, transport error → null', async () => {
    // No key published: never calls the transport.
    const getJson = vi.fn(() => Promise.resolve({ success: true }));
    const unconnected = new ApiClient({
      urls: {},
      context: { ...CONTEXT },
      transport: { getJson } as unknown as Transport,
    });
    expect(await unconnected.loadAssignmentByUrl('x')).toBeNull();
    expect(getJson).not.toHaveBeenCalled();
    // Logical failure (unknown url slug).
    const failing = new ApiClient({
      urls: { loadAssignmentByUrl: '/by_url' },
      context: { ...CONTEXT },
      transport: {
        getJson: () => Promise.resolve({ success: false }),
      } as unknown as Transport,
    });
    expect(await failing.loadAssignmentByUrl('nope')).toBeNull();
    // Transport rejection.
    const throwing = new ApiClient({
      urls: { loadAssignmentByUrl: '/by_url' },
      context: { ...CONTEXT },
      transport: {
        getJson: () => Promise.reject(new Error('offline')),
      } as unknown as Transport,
    });
    expect(await throwing.loadAssignmentByUrl('slug')).toBeNull();
  });

  it('read-only mode blocks both (A1 §2 persistence guard)', async () => {
    const postRetry = vi.fn(() => Promise.resolve({ success: true }));
    const client = new ApiClient({
      urls: { editAssignmentGroup: '/edit', moveMembership: '/move' },
      context: { ...CONTEXT },
      transport: { postRetry } as unknown as Transport,
      readOnly: () => true,
    });
    const edited = await client.editAssignmentGroup({
      assignment_group_id: 3,
      new_name: 'x',
    });
    const moved = await client.moveMembership({
      assignment_id: 1,
      old_group_id: 3,
      new_group_id: -1,
    });
    expect(edited.success).toBe(false);
    expect(moved.success).toBe(false);
    expect(postRetry).not.toHaveBeenCalled();
  });
});
