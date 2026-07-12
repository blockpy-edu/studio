/**
 * Docs browser panel (M4.3; STUDIO EXTENSION, LD-25 — no legacy analog).
 * A collapsible right-hand panel beside the editor rendering a course
 * reference document from the assignment's `docs_url` setting (raw string
 * per A4 semantics; typically identical across a course).
 *
 * - Fetched once per SESSION per URL (module cache) — instructors host the
 *   file; a reload picks up edits.
 * - Rendered through the existing marked + hljs pipeline (A6 parity rules:
 *   breaks, raw HTML unsanitized per D4-A, target=_blank links, 400 ms
 *   highlight pass).
 * - TOC generated from headings (ids assigned post-render) + a text filter
 *   box; explicit download link to the raw file.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderInstructions } from './Instructions';
import { highlightCodeBlocks } from './highlight';
import { Icon } from './icons';

/** Session-scoped fetch cache (fetch once per URL per page load). */
const DOCS_CACHE = new Map<string, Promise<string>>();

/** Test hook: drop the session cache (not exported from the package). */
export function clearDocsCache(): void {
  DOCS_CACHE.clear();
}

function fetchDocs(url: string): Promise<string> {
  let cached = DOCS_CACHE.get(url);
  if (!cached) {
    cached = fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    });
    // Failures don't poison the session cache — a re-open retries.
    cached.catch(() => DOCS_CACHE.delete(url));
    DOCS_CACHE.set(url, cached);
  }
  return cached;
}

interface TocEntry {
  id: string;
  text: string;
  level: number;
}

export interface DocsPanelProps {
  /** The `docs_url` setting value (the panel renders only when non-empty). */
  url: string;
  /** Collapse button handler (the store flag lives with the caller). */
  onCollapse(): void;
}

export function DocsPanel({ url, onCollapse }: DocsPanelProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [filter, setFilter] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setMarkdown(null);
    setError(null);
    fetchDocs(url).then(
      (text) => {
        if (live) setMarkdown(text);
      },
      (cause: Error) => {
        if (live) setError(cause.message);
      },
    );
    return () => {
      live = false;
    };
  }, [url]);

  const html = useMemo(
    () => (markdown === null ? '' : renderInstructions(markdown)),
    [markdown],
  );

  // Post-render pass: assign heading ids (TOC anchors) and collect the TOC;
  // highlight code fences on the legacy 400 ms debounce (LD-10 pipeline).
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || markdown === null) return;
    const seen = new Map<string, number>();
    const entries: TocEntry[] = [];
    body.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
      const text = heading.textContent ?? '';
      let id = 'docs-' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const count = seen.get(id) ?? 0;
      seen.set(id, count + 1);
      if (count > 0) id = `${id}-${count}`;
      heading.id = id;
      entries.push({ id, text, level: Number(heading.tagName.slice(1)) });
    });
    setToc(entries);
    const timeout = setTimeout(() => highlightCodeBlocks(body), 400);
    return () => clearTimeout(timeout);
  }, [markdown, html]);

  const visibleToc = filter.trim()
    ? toc.filter((entry) =>
        entry.text.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : toc;

  return (
    <div className="blockpy-docs-panel">
      <div className="blockpy-panel-header">
        <strong>Docs:</strong>
        <a
          className="blockpy-docs-download"
          href={url}
          target="_blank"
          rel="noreferrer"
          download
        >
          <Icon name="download" />
          Download
        </a>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary blockpy-panel-header-action"
          title="Hide docs panel"
          onClick={onCollapse}
        >
          <Icon name="docs" />
        </button>
      </div>
      {error !== null ? (
        <div className="blockpy-docs-error">
          Could not load the reference document ({error}).{' '}
          <a href={url} target="_blank" rel="noreferrer">
            Open it directly.
          </a>
        </div>
      ) : markdown === null ? (
        <div className="blockpy-docs-loading">Loading documentation…</div>
      ) : (
        <>
          {toc.length > 0 && (
            <div className="blockpy-docs-toc">
              <input
                type="text"
                className="form-control form-control-sm blockpy-docs-filter"
                placeholder="Filter sections…"
                aria-label="Filter documentation sections"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <ul>
                {visibleToc.map((entry) => (
                  <li
                    key={entry.id}
                    style={{ paddingLeft: `${(entry.level - 1) * 10}px` }}
                  >
                    <a
                      href={`#${entry.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        bodyRef.current
                          ?.querySelector(`#${entry.id}`)
                          ?.scrollIntoView({ block: 'start' });
                      }}
                    >
                      {entry.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div
            ref={bodyRef}
            className="blockpy-docs-body blockpy-instructions"
            // D4-A: instructor-authored HTML renders unsanitized (same
            // trust model as instructions).
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </>
      )}
    </div>
  );
}
