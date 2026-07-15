/**
 * Reading-content markdown pipeline (spec §11.2, appendix A6 §2).
 *
 * Legacy renders reader/quiz content with markdown-it (blockpy-server
 * frontend/services/plugins.ts:192-260); the rewrite unifies on `marked`
 * (the instructions pane's library) while replicating the markdown-it
 * pipeline's observable behaviors - ledger LD-13 documents the known
 * deltas. Replicated exactly:
 *
 *   - `html: true`, no sanitization (D4-A legacy parity);
 *   - `breaks` OFF (markdown-it default; the instructions pane forces
 *     breaks:true - the two pipelines really differ here, A6 §3);
 *   - the `highlight` callback's fence scheme (plugins.ts:194-243):
 *     python + non-empty info-string attrs → runnable structure
 *     (`pre.reader-launch-blockpy[data-part-id]` + hidden raw-source div +
 *     hydration slot), ts/typescript/r → the kettle analog, other known
 *     languages → plain hljs pre, unknown → escaped `pre.hljs`;
 *   - the replace-link core rule (plugins.ts:244-260): markdown link hrefs
 *     and image srcs not starting with "http" (verbatim predicate) are
 *     rewritten through the env's downloadUrl; raw-HTML links untouched.
 *
 * The knockout `blockPyEditor`/`kettleLauncher` bindings become inert
 * `.reader-runnable-slot` divs the Reader component hydrates with React
 * portals (Runnable.tsx).
 */
import { Marked } from 'marked';
import hljs from 'highlight.js';

export interface ReaderRenderEnv {
  /** Relative link/image target → download_file URL (plugins.ts:271-273). */
  downloadUrl: (link: string) => string;
}

/** Everything after the language word in the fence info string, verbatim
 *  (markdown-it's langAttrs split; A6 open question 4 freezes this). */
export function splitFenceInfo(info: string): { lang: string; attrs: string } {
  const trimmed = (info ?? '').trim();
  const match = /^(\S+)(?:\s+(.*))?$/.exec(trimmed);
  if (!match) return { lang: '', attrs: '' };
  return { lang: match[1] ?? '', attrs: match[2] ?? '' };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeAttr = escapeHtml;

function highlightOrEscape(source: string, lang: string): string {
  try {
    return hljs.highlight(source, { language: lang }).value;
  } catch {
    return escapeHtml(source);
  }
}

/** The runnable-block emission (plugins.ts:198-225): highlighted pre with
 *  the launch class + part id, the hidden raw source, and the slot div. */
function runnableFence(
  source: string,
  lang: string,
  attrs: string,
  kind: 'blockpy' | 'kettle',
): string {
  const launchClass = attrs
    ? ` class="reader-launch-${kind}" data-part-id="${escapeAttr(attrs)}"`
    : '';
  return (
    `<pre${launchClass} style="margin-bottom: 5px"><code class="language-${lang} hljs">` +
    highlightOrEscape(source, lang) +
    `</code></pre>` +
    `<div style="display: none">${escapeHtml(source)}</div>` +
    `<div class="reader-runnable-slot" data-kind="${kind}" data-lang="${lang}"` +
    ` data-part-id="${escapeAttr(attrs)}"></div>`
  );
}

function renderFence(source: string, info: string): string {
  const { lang, attrs } = splitFenceInfo(info);
  if (lang && hljs.getLanguage(lang)) {
    if (lang === 'python') {
      return runnableFence(source, lang, attrs, 'blockpy');
    } else if (lang === 'typescript' || lang === 'ts' || lang === 'r') {
      return runnableFence(source, lang, attrs, 'kettle');
    }
    return (
      `<pre style="margin-bottom: 5px"><code class="language-${lang} hljs">` +
      highlightOrEscape(source, lang) +
      `</code></pre>`
    );
  }
  return '<pre class="hljs"><code>' + escapeHtml(source) + '</code></pre>';
}

/** `link.startsWith("http")` - the verbatim legacy predicate ("httpfoo"
 *  counts as absolute too, plugins.ts:188-190). */
const rewriteLink = (link: string, env: ReaderRenderEnv): string =>
  link.startsWith('http') ? link : env.downloadUrl(link);

export function renderReadingMarkdown(source: string, env: ReaderRenderEnv): string {
  const marked = new Marked({
    gfm: true,
    // markdown-it default: single newlines do NOT become <br> (unlike the
    // instructions pane's forced breaks:true, A6 §3).
    breaks: false,
    async: false,
    renderer: {
      code({ text, lang }) {
        return renderFence(text, lang ?? '');
      },
      link({ href, title, tokens }) {
        const target = rewriteLink(href, env);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
        return `<a href="${escapeAttr(target)}"${titleAttr}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, title, text }) {
        const target = rewriteLink(href, env);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
        return `<img src="${escapeAttr(target)}" alt="${escapeAttr(text)}"${titleAttr}>`;
      },
    },
  });
  return marked.parse(source ?? '', { async: false }) as string;
}
