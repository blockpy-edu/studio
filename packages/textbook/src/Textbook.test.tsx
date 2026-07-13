// @vitest-environment jsdom
/**
 * Textbook component (spec §11.4 / textbook.html): sidebar macro parity,
 * page open + URL contract, client-side rehydration fallback (LD-16),
 * instructor RAW editor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Textbook, type TextbookLoadResult } from './Textbook';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const DOC = {
  version: 1,
  settings: {},
  content: [
    {
      header: 'Chapter 1) Introduction',
      content: [
        { reading: 'primer_read' },
        {
          header: 'Part A',
          group: 'group_a',
          content: [{ reading: 'basics_read' }, { reading: 'lost_read' }],
        },
      ],
    },
  ],
};

const load =
  (instructions = JSON.stringify(DOC)): ((id: number) => Promise<TextbookLoadResult>) =>
  async (id: number) => ({
    assignment: {
      id,
      name: 'Sample Book',
      url: 'sample_book',
      instructions,
      settings: '{}',
    },
    submission: { id: 900 },
  });

const resolver = async (url: string) =>
  url === 'primer_read'
    ? { id: 201, name: 'Primer', url }
    : url === 'basics_read'
      ? { id: 202, name: 'Basics', url }
      : url === 'group_a'
        ? { id: 301, name: 'Group A', url }
        : null;

describe('Textbook (§11.4)', () => {
  it('renders the sidebar with macro classes and opens the first reading', async () => {
    const renderReading = vi.fn((id: number) => <div>READER {id}</div>);
    render(
      <Textbook
        assignmentId={105}
        loadAssignment={load()}
        renderReading={renderReading}
        resolveAssignment={resolver}
      />,
    );
    await screen.findByText('Primer');
    // Default page = first reading in document order.
    expect(screen.getByText('READER 201')).toBeTruthy();
    // Chapter header: disabled secondary; top-level reading: info + active.
    const header = screen.getByText('Chapter 1) Introduction');
    expect(header.className).toContain('disabled');
    expect(header.className).toContain('list-group-item-secondary');
    // The info accent applies to TOP-LEVEL readings only (indent 0,
    // textbook.html:62); primer sits at indent 1 under the chapter.
    const primer = screen.getByText('Primer');
    expect(primer.className).not.toContain('list-group-item-info');
    expect(primer.className).toContain('active');
    expect(primer.style.paddingLeft).toBe('13px');
    // Deeper nesting: 5 + 2*8.
    const basics = screen.getByText('Basics');
    expect(basics.style.paddingLeft).toBe('21px');
  });

  it('opens a reading on click, pushing ?page= and updating the title', async () => {
    const renderReading = vi.fn((id: number) => <div>READER {id}</div>);
    render(
      <Textbook
        assignmentId={105}
        loadAssignment={load()}
        renderReading={renderReading}
        resolveAssignment={resolver}
      />,
    );
    fireEvent.click(await screen.findByText('Basics'));
    expect(screen.getByText('READER 202')).toBeTruthy();
    expect(window.location.search).toContain('page=basics_read');
    expect(document.title).toBe('Basics - Sample Book - BlockPy Textbook');
  });

  it('honors a ?page= deep link (by url, assignments.py:100-112)', async () => {
    window.history.replaceState(null, '', '/?page=basics_read');
    render(
      <Textbook
        assignmentId={105}
        loadAssignment={load()}
        renderReading={(id) => <div>READER {id}</div>}
        resolveAssignment={resolver}
      />,
    );
    expect(await screen.findByText('READER 202')).toBeTruthy();
  });

  it('renders unresolvable references with the legacy Missing Reading style (LD-16)', async () => {
    render(
      <Textbook
        assignmentId={105}
        loadAssignment={load()}
        renderReading={(id) => <div>READER {id}</div>}
        resolveAssignment={resolver}
      />,
    );
    const missing = await screen.findByText('Missing Reading');
    expect(missing.className).toContain('disabled');
    fireEvent.click(missing);
    // Not clickable — the open page stays the primer.
    expect(screen.getByText('READER 201')).toBeTruthy();
  });

  it('without a resolver every url reference is missing (unmodified server)', async () => {
    render(
      <Textbook
        assignmentId={105}
        loadAssignment={load()}
        renderReading={(id) => <div>READER {id}</div>}
      />,
    );
    await waitFor(() => expect(screen.getAllByText('Missing Reading')).toHaveLength(3));
    expect(screen.getByText('Select a reading from the sidebar.')).toBeTruthy();
  });

  it('surfaces schema errors like the server route (Error: …)', async () => {
    render(
      <Textbook
        assignmentId={105}
        loadAssignment={load('{"version": 99}')}
        renderReading={(id) => <div>READER {id}</div>}
      />,
    );
    expect(await screen.findByText('Error: Unknown or missing version')).toBeTruthy();
  });

  it('gives instructors the RAW editor and saves both documents', async () => {
    const save = vi.fn(async () => ({ success: true }));
    render(
      <Textbook
        assignmentId={105}
        loadAssignment={load()}
        renderReading={(id) => <div>READER {id}</div>}
        resolveAssignment={resolver}
        isInstructor={() => true}
        saveTextbookAssignment={save}
      />,
    );
    fireEvent.click(await screen.findByLabelText(/Raw Editor/));
    const textareas = document.querySelectorAll('textarea');
    expect(textareas).toHaveLength(2);
    fireEvent.change(textareas[0]!, { target: { value: '{"version": 1, "content": []}' } });
    fireEvent.click(screen.getByText('Save Assignment'));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(105, '{"version": 1, "content": []}', '{}'),
    );
  });
});
