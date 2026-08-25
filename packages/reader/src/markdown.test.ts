import { describe, expect, it } from 'vitest';
import { renderReadingMarkdown, splitFenceInfo } from './markdown';

const ENV = { downloadUrl: (link: string) => `/dl?filename=${link}` };

describe('splitFenceInfo (the langAttrs contract, A6 §2.2/open q. 4)', () => {
  it('splits language and verbatim part id', () => {
    expect(splitFenceInfo('python part1')).toEqual({ lang: 'python', attrs: 'part1' });
    expect(splitFenceInfo('python')).toEqual({ lang: 'python', attrs: '' });
    expect(splitFenceInfo('python  two words ')).toEqual({
      lang: 'python',
      attrs: 'two words',
    });
    expect(splitFenceInfo('')).toEqual({ lang: '', attrs: '' });
  });
});

describe('renderReadingMarkdown fences (plugins.ts:194-243)', () => {
  it('python + part id → launch pre, hidden source, runnable slot', () => {
    const html = renderReadingMarkdown('```python part1\nprint(1)\n```', ENV);
    expect(html).toContain('class="reader-launch-blockpy" data-part-id="part1"');
    expect(html).toContain('<code class="language-python hljs">');
    expect(html).toContain('<div style="display: none">print(1)</div>');
    expect(html).toContain(
      '<div class="reader-runnable-slot" data-kind="blockpy" data-lang="python" data-part-id="part1">',
    );
  });

  it('python without attrs keeps the structure but no launch class/part id', () => {
    const html = renderReadingMarkdown('```python\nx = 1\n```', ENV);
    expect(html).not.toContain('reader-launch-blockpy');
    expect(html).toContain('data-part-id=""');
    expect(html).toContain('<code class="language-python hljs">');
  });

  it('typescript/r fences take the kettle path', () => {
    const html = renderReadingMarkdown('```ts editor1\nlet x = 1;\n```', ENV);
    expect(html).toContain('class="reader-launch-kettle" data-part-id="editor1"');
    expect(html).toContain('data-kind="kettle"');
  });

  it('other known languages render plain hljs pres; unknown escape', () => {
    const known = renderReadingMarkdown('```javascript\nlet a = 1;\n```', ENV);
    expect(known).toContain('<code class="language-javascript hljs">');
    expect(known).not.toContain('reader-runnable-slot');
    const unknown = renderReadingMarkdown('```mystery\n<b>&raw</b>\n```', ENV);
    expect(unknown).toContain('<pre class="hljs"><code>');
    expect(unknown).toContain('&lt;b&gt;&amp;raw&lt;/b&gt;');
  });
});

describe('link/image rewriting (plugins.ts:188-190, 244-260)', () => {
  it('relative targets route through downloadUrl; http passes through', () => {
    const html = renderReadingMarkdown(
      '[data](data.csv) ![pic](chart.png) [site](https://example.com)',
      ENV,
    );
    expect(html).toContain('href="/dl?filename=data.csv"');
    expect(html).toContain('src="/dl?filename=chart.png"');
    expect(html).toContain('href="https://example.com"');
  });

  it('the verbatim startsWith("http") predicate: "httpfoo" counts as absolute', () => {
    const html = renderReadingMarkdown('[weird](httpfoo/bar)', ENV);
    expect(html).toContain('href="httpfoo/bar"');
  });

  it('raw HTML passes through untouched - including its links (html:true, D4-A)', () => {
    const html = renderReadingMarkdown('<a href="raw.csv">raw</a> <script>x()</script>', ENV);
    expect(html).toContain('<a href="raw.csv">raw</a>');
    expect(html).toContain('<script>x()</script>');
  });

  it('rejects script/file/data schemes in markdown links and images (validateLink)', () => {
    const cases = [
      '[x](javascript:alert(1))',
      '[x](JavaScript:alert(1))',
      '[x](vbscript:msgbox)',
      '[x](file:///etc/passwd)',
      '[x](data:text/html;base64,PHNjcmlwdD4=)',
      '[x](java%09script:alert(1))',
      '[x](&#106;avascript:alert(1))',
      '![x](javascript:alert(1))',
    ];
    for (const source of cases) {
      const html = renderReadingMarkdown(source, ENV);
      expect(html, source).not.toMatch(/javascript|vbscript|file:|data:/i);
      expect(html, source).not.toContain('<a ');
      expect(html, source).not.toContain('<img ');
      expect(html, source).toContain('x'); // the text survives
    }
    // downloadUrl never saw them either.
    const seen: string[] = [];
    renderReadingMarkdown('[x](javascript:alert(1))', { downloadUrl: (l) => (seen.push(l), l) });
    expect(seen).toEqual([]);
  });

  it('keeps http(s), mailto, anchors, relative paths and image data-URLs', () => {
    const html = renderReadingMarkdown(
      '[a](https://x.example) [b](mailto:me@example.com) [c](#top) [d](../f.csv) ' +
        '![e](data:image/png;base64,iVBORw0KGgo=)',
      ENV,
    );
    expect(html).toContain('href="https://x.example"');
    expect(html).toContain('href="/dl?filename=mailto:me@example.com"');
    expect(html).toContain('href="/dl?filename=#top"');
    expect(html).toContain('href="/dl?filename=../f.csv"');
    expect(html).toContain('src="/dl?filename=data:image/png;base64,iVBORw0KGgo="');
  });
});

describe('markdown-it parity options (A6 §3)', () => {
  it('single newlines do NOT become <br> (breaks off, unlike instructions)', () => {
    const html = renderReadingMarkdown('line one\nline two', ENV);
    expect(html).not.toContain('<br');
  });
});
