/**
 * Instructions pane — Row 1 header region (A8 §1). Rendering per A6 §1:
 * `marked` with forced `breaks: true` (EasyMDE default path), raw HTML
 * allowed, **no sanitization** (maintainer decision D4-A — legacy parity),
 * then `target="_blank"` added to links lacking a target.
 * (Legacy also ran hljs over code blocks post-render; that lands with the
 * instructions-highlighting pass.)
 */
import { useMemo } from 'react';
import { marked } from 'marked';

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
  return (
    <div className="col-md-9 blockpy-panel blockpy-header" role="heading" aria-level={1}>
      <span className="blockpy-name">
        <strong>BlockPy: </strong>
        {assignmentName ?? ''}
      </span>
      <div
        className="blockpy-instructions"
        // D4-A: legacy renders instructor HTML unsanitized.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
