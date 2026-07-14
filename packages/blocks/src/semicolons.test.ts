// @vitest-environment jsdom
/**
 * M7.5: semicolon-joined simple statements (`a = 1; b = 2`). The grammar
 * wraps them in a StatementGroup node the converter now flattens — matching
 * BlockMirror, whose Skulpt AST yielded two same-line statements (its
 * grindlehook demo was full of them). Round trips NORMALIZE `;` to
 * newlines, exactly like legacy's generator; hence a dedicated
 * non-exact-text suite instead of corpus entries (roundtrip.test.ts asserts
 * exact text).
 */
import { describe, expect, it } from 'vitest';
import './ast';
import { TextToBlocksConverter } from './text-to-blocks';
import { xmlToPython } from './blocks-to-text';

function convert(source: string) {
  const converter = new TextToBlocksConverter();
  const result = converter.convertSource('__main__.py', source);
  expect(result.error).toBeNull();
  return result;
}

function trip(source: string): string {
  return xmlToPython(convert(source).xml).trim();
}

describe('semicolon statement groups (M7.5)', () => {
  const NORMALIZED: [name: string, source: string, expected: string][] = [
    ['two assignments', `a = 1; b = 2`, `a = 1\nb = 2`],
    ['trailing semicolon tolerated', `a = 1;`, `a = 1`],
    // `pass` drops: BlockMirror has no Pass block (converter returns null;
    // `pass` re-synthesizes only for EMPTY bodies) — legacy parity,
    // unrelated to semicolons.
    ['calls mix; pass drops like legacy', `print(1); pass; x = f()`, `print(1)\nx = f()`],
    // `return (a + b)`: ast_ReturnFull's generator always parenthesizes its
    // value — pre-existing legacy generator behavior, not a semicolon
    // artifact (a no-semicolon `return a + b` does the same).
    [
      'inside a function body',
      `def go():\n    a = 1; b = 2\n    return a + b`,
      `def go():\n    a = 1\n    b = 2\n    return (a + b)`,
    ],
    [
      'inside an if body with siblings after',
      `if x:\n    a = 1; b = 2\nprint(a)`,
      `if x:\n    a = 1\n    b = 2\nprint(a)`,
    ],
  ];
  for (const [name, source, expected] of NORMALIZED) {
    it(name, () => {
      const once = trip(source);
      expect(once).toBe(expected);
      // The normalized form is a fixed point (double trip).
      expect(trip(once)).toBe(expected);
    });
  }

  it('produces real stacked blocks, never ast_Raw', () => {
    const { rawXml } = convert(`a = 1; b = 2; print(a + b)`);
    expect(rawXml.querySelectorAll('block[type="ast_Raw"]').length).toBe(0);
    expect(rawXml.querySelectorAll('block[type="ast_Assign"]').length).toBe(2);
    expect(rawXml.querySelectorAll('block[type="ast_Call"]').length).toBe(1);
  });

  it('statements after a semicolon line are unaffected (no rawify-to-EOF)', () => {
    const { rawXml } = convert(`a = 1; b = 2\nfor i in range(3):\n    print(i)`);
    expect(rawXml.querySelectorAll('block[type="ast_Raw"]').length).toBe(0);
    expect(rawXml.querySelectorAll('block[type="ast_For"]').length).toBe(1);
  });
});
