// @vitest-environment jsdom
/** Group organizer slice 1 (M4.6, LD-28). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient, type Transport } from '@blockpy/api';
import { GroupNavStore } from '@blockpy/navigation';
import { GroupOrganizer } from './GroupOrganizer';

const ASSIGNMENTS = [
  { id: 101, name: 'Hello', url: '/a/101', subordinate: false, hidden: false, correct: false },
  { id: 103, name: 'Reading', url: '/a/103', subordinate: false, hidden: true, correct: false },
];

function makeHarness(urls: Record<string, string>) {
  const postRetry = vi.fn(() => Promise.resolve({ success: true }));
  const api = new ApiClient({
    urls,
    context: {
      assignmentId: 101,
      assignmentGroupId: 3,
      courseId: 1,
      submissionId: null,
      userId: 9,
      submissionVersion: 0,
      assignmentVersion: 0,
      passcode: '',
      partId: '',
    },
    transport: { postRetry } as unknown as Transport,
    now: () => new Date(0),
  });
  const navStore = new GroupNavStore({
    assignments: ASSIGNMENTS,
    anySecretive: false,
    currentAssignmentId: 101,
  });
  return { api, postRetry, navStore };
}

const ALL_URLS = {
  saveAssignment: '/save',
  editAssignmentGroup: '/group/edit',
  moveMembership: '/group/move',
};

describe('GroupOrganizer (M4.6 slice 1)', () => {
  afterEach(cleanup);

  it('saves only touched assignment fields and refreshes the nav header', async () => {
    const { api, postRetry, navStore } = makeHarness(ALL_URLS);
    const { container } = render(
      <GroupOrganizer
        api={api}
        groupId={3}
        assignments={ASSIGNMENTS}
        navStore={navStore}
        visible
        onClose={() => {}}
      />,
    );
    const nameInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Name of assignment 101"]',
    )!;
    fireEvent.change(nameInput, { target: { value: 'Hello v2' } });
    const row = container.querySelector('[data-assignment-id="101"]')!;
    fireEvent.click(
      [...row.querySelectorAll('button')].find((b) => b.textContent === 'Save')!,
    );
    await waitFor(() => expect(postRetry).toHaveBeenCalledTimes(1));
    const [url, payload] = postRetry.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe('/save');
    expect(payload['assignment_id']).toBe(101);
    expect(payload['name']).toBe('Hello v2');
    // Untouched fields stay OFF the wire (unknown ≠ false).
    expect('points' in payload).toBe(false);
    expect('public' in payload).toBe(false);
    expect('hidden' in payload).toBe(false);
    // Nav header refreshed in place.
    await waitFor(() =>
      expect(
        navStore.getSnapshot().entries.find((entry) => entry.id === 101)!.name,
      ).toBe('Hello v2'),
    );
  });

  it('remove posts move_membership with new_group_id=-1 and drops the row', async () => {
    const { api, postRetry, navStore } = makeHarness(ALL_URLS);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = render(
      <GroupOrganizer
        api={api}
        groupId={3}
        assignments={ASSIGNMENTS}
        navStore={navStore}
        visible
        onClose={() => {}}
      />,
    );
    const row = container.querySelector('[data-assignment-id="103"]')!;
    fireEvent.click(row.querySelector('.blockpy-organizer-remove')!);
    await waitFor(() => expect(postRetry).toHaveBeenCalledTimes(1));
    const [url, payload] = postRetry.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe('/group/move');
    expect(payload['assignment_id']).toBe(103);
    expect(payload['old_group_id']).toBe(3);
    expect(payload['new_group_id']).toBe(-1);
    await waitFor(() =>
      expect(container.querySelector('[data-assignment-id="103"]')).toBeNull(),
    );
    expect(navStore.getSnapshot().entries.map((entry) => entry.id)).toEqual([
      101,
    ]);
  });

  it('group rename posts assignment_group_id + new_name', async () => {
    const { api, postRetry } = makeHarness(ALL_URLS);
    const { container } = render(
      <GroupOrganizer
        api={api}
        groupId={3}
        assignments={ASSIGNMENTS}
        navStore={null}
        visible
        onClose={() => {}}
      />,
    );
    fireEvent.change(
      container.querySelector('.blockpy-organizer-group-name')!,
      { target: { value: 'Week 2' } },
    );
    fireEvent.click(
      [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'Rename Group',
      )!,
    );
    await waitFor(() => expect(postRetry).toHaveBeenCalledTimes(1));
    const [url, payload] = postRetry.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe('/group/edit');
    expect(payload['assignment_group_id']).toBe(3);
    expect(payload['new_name']).toBe('Week 2');
  });

  it('capability detection: without the new url keys only saves render', () => {
    const { api } = makeHarness({ saveAssignment: '/save' });
    const { container } = render(
      <GroupOrganizer
        api={api}
        groupId={3}
        assignments={ASSIGNMENTS}
        navStore={null}
        visible
        onClose={() => {}}
      />,
    );
    expect(container.querySelector('.blockpy-organizer-group-name')).toBeNull();
    expect(container.querySelector('.blockpy-organizer-remove')).toBeNull();
    expect(container.querySelector('.blockpy-organizer-add-id')).toBeNull();
    expect(container.textContent).toContain('has not published');
    // Per-assignment saves still work.
    expect(
      container.querySelector('[aria-label="Name of assignment 101"]'),
    ).not.toBeNull();
  });
});
