/**
 * Python `re` → JavaScript RegExp bridge. The SERVER grader compiles
 * `correct_regex` / regex-feedback keys with Python's `re`; the local
 * grader and the validator compile them as JS RegExps. The common
 * Python-only spellings are translated so authors get the same verdict
 * locally; anything still uncompilable is reported as "may still be valid
 * Python" rather than flatly invalid.
 *
 * Translated: leading inline flags `(?i)`, `(?m)`, `(?s)`, `(?u)` (any combo) →
 * RegExp flags; `(?P<name>…)` → `(?<name>…)`; `(?P=name)` → `\k<name>`;
 * `\A` → `^` and `\Z` → `$` (exact without the `m` flag; approximate with).
 */
export interface TranslatedRegex {
  source: string;
  flags: string;
}

// Only flags with a JS equivalent; `(?x)`/`(?a)`/`(?L)` stay put so the
// pattern fails to compile and is reported as Python-only.
const INLINE_FLAGS = /^\(\?([imsu]+)\)/;

export function translatePythonRegex(pattern: string): TranslatedRegex {
  let source = pattern;
  let flags = '';
  const inline = INLINE_FLAGS.exec(source);
  if (inline) {
    const letters = inline[1] ?? '';
    if (letters.includes('i')) flags += 'i';
    if (letters.includes('m')) flags += 'm';
    if (letters.includes('s')) flags += 's';
    if (letters.includes('u')) flags += 'u';
    source = source.slice(inline[0].length);
  }
  source = source
    .replace(/\(\?P</g, '(?<')
    .replace(/\(\?P=(\w+)\)/g, '\\k<$1>')
    // Only bare (unescaped) \A / \Z: an even number of preceding
    // backslashes means the backslash starting \A is not itself escaped.
    .replace(/(^|[^\\])((?:\\\\)*)\\A/g, '$1$2^')
    .replace(/(^|[^\\])((?:\\\\)*)\\Z/g, '$1$2$');
  return { source, flags };
}

/** Compile a Python-flavored pattern as a JS RegExp (throws like `new RegExp`). */
export function compilePythonRegex(pattern: string): RegExp {
  const { source, flags } = translatePythonRegex(pattern);
  return new RegExp(source, flags);
}

/**
 * Validation helper: null when the pattern compiles (after translation);
 * otherwise a message that explains the JS failure AND that Python's `re`
 * (the server grader) may still accept the pattern.
 */
export function pythonRegexError(pattern: string): string | null {
  try {
    compilePythonRegex(pattern);
    return null;
  } catch (error) {
    return (
      `${String(error)}\n` +
      'The pattern could not be compiled as a JavaScript RegExp; it may still be valid ' +
      'Python `re` syntax (the server grader uses Python), but it cannot be checked locally.'
    );
  }
}
