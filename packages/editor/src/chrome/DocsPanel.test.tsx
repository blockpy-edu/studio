// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { clearDocsCache, DocsPanel } from './DocsPanel';

const SAMPLE_DOC = [
  '# Guide',
  'Intro text.',
  '## Strings',
  'About `str`.',
  '## Numbers',
  'About ints.',
].join('\n');

function mockFetch(body: string, ok = true) {
  const mock = vi.fn(() =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 404,
      text: () => Promise.resolve(body),
    }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('DocsPanel (M4.3, LD-25)', () => {
  beforeEach(() => {
    clearDocsCache();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fetches once per session per URL, renders markdown + TOC with anchors', async () => {
    const fetchMock = mockFetch(SAMPLE_DOC);
    const { container, unmount } = render(
      <DocsPanel url="https://example.com/guide.md" onCollapse={() => {}} />,
    );
    expect(container.textContent).toContain('Loading documentation');
    await act(async () => {});
    // Rendered through the instructions pipeline.
    expect(container.querySelector('.blockpy-docs-body h1')!.textContent).toBe(
      'Guide',
    );
    expect(container.querySelector('#docs-strings')).not.toBeNull();
    // TOC lists all three headings, indented by level.
    const tocLinks = container.querySelectorAll('.blockpy-docs-toc a');
    expect([...tocLinks].map((a) => a.textContent)).toEqual([
      'Guide',
      'Strings',
      'Numbers',
    ]);
    // TOC click scrolls the heading into view (no page navigation).
    fireEvent.click(tocLinks[1]!);
    expect(
      window.HTMLElement.prototype.scrollIntoView,
    ).toHaveBeenCalled();
    // Session cache: a remount does not refetch.
    unmount();
    render(
      <DocsPanel url="https://example.com/guide.md" onCollapse={() => {}} />,
    );
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('filter box narrows the TOC without touching the body', async () => {
    mockFetch(SAMPLE_DOC);
    const { container } = render(
      <DocsPanel url="https://example.com/guide.md" onCollapse={() => {}} />,
    );
    await act(async () => {});
    fireEvent.change(container.querySelector('.blockpy-docs-filter')!, {
      target: { value: 'num' },
    });
    const tocLinks = container.querySelectorAll('.blockpy-docs-toc a');
    expect([...tocLinks].map((a) => a.textContent)).toEqual(['Numbers']);
    // Content stays complete — the filter is a TOC affordance only.
    expect(container.querySelector('.blockpy-docs-body')!.textContent).toContain(
      'About ints.',
    );
  });

  it('offers the raw download link and fails soft on fetch errors', async () => {
    mockFetch('missing', false);
    const { container } = render(
      <DocsPanel url="https://example.com/gone.md" onCollapse={() => {}} />,
    );
    const download = container.querySelector<HTMLAnchorElement>(
      '.blockpy-docs-download',
    )!;
    expect(download.href).toBe('https://example.com/gone.md');
    await act(async () => {});
    expect(container.querySelector('.blockpy-docs-error')!.textContent).toContain(
      'HTTP 404',
    );
    // Failed fetches don't poison the session cache: a fresh mount retries.
    const retryMock = mockFetch(SAMPLE_DOC);
    cleanup();
    const { container: second } = render(
      <DocsPanel url="https://example.com/gone.md" onCollapse={() => {}} />,
    );
    await act(async () => {});
    expect(retryMock).toHaveBeenCalledTimes(1);
    expect(second.querySelector('.blockpy-docs-body h1')).not.toBeNull();
  });

  it('collapse button reports to the caller', async () => {
    mockFetch(SAMPLE_DOC);
    const onCollapse = vi.fn();
    const { container } = render(
      <DocsPanel url="https://example.com/guide.md" onCollapse={onCollapse} />,
    );
    await act(async () => {});
    fireEvent.click(container.querySelector('[title="Hide docs panel"]')!);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
