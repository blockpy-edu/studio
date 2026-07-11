/**
 * Instructions pane — Row 1 header region (A8 §1). Rendering per A6 §1:
 * `marked` with forced `breaks: true` (EasyMDE default path), raw HTML
 * allowed, **no sanitization** (maintainer decision D4-A — legacy parity),
 * then `target="_blank"` added to links lacking a target. Code blocks are
 * highlighted 400 ms after render (legacy interface.js:38-47 debounce;
 * dead-in-legacy, made real per LD-10 — see chrome/highlight.ts).
 */
import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import { highlightCodeBlocks } from './highlight';

export function renderInstructions(markdown: string): string {
  const html = marked.parse(markdown, {
    breaks: true,
    gfm: true,
    async: false,
  });
  // EasyMDE post-processing: open links in a new tab unless targeted.
  return html.replace(/<a (?![^>]*target=)/g, '<a target="_blank" ');
}

export interface InstructionsProps {
  markdown: string;
  assignmentName?: string;
}

export function Instructions({ markdown, assignmentName }: InstructionsProps) {
  const html = useMemo(() => renderInstructions(markdown), [markdown]);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Legacy debounces the highlight pass 400 ms after instructions change.
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (bodyRef.current) highlightCodeBlocks(bodyRef.current);
    }, 400);
    return () => clearTimeout(timeout);
  }, [html]);

  return (
    <div className="col-md-9 blockpy-panel blockpy-header" role="heading" aria-level={1}>
      <span className="blockpy-name">
        <strong>BlockPy: </strong>
        {assignmentName ?? ''}
      </span>
      <div
        ref={bodyRef}
        className="blockpy-instructions"
        // D4-A: legacy renders instructor HTML unsanitized.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
