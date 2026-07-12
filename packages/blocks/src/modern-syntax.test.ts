// @vitest-environment jsdom
/**
 * M3.6 remainder: walrus / await / bytes / ellipsis get real blocks;
 * async def/for/with degrade to a SINGLE ast_Raw statement (text verbatim)
 * instead of corrupting blocks or rawifying the whole remainder.
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

describe('modern syntax round trips (M3.6)', () => {
  const EXACT: [name: string, source: string][] = [
    ['walrus in a condition re-parenthesizes', `if (n := 10) > 4:\n    print(n)`],
    ['walrus in a call argument', `print(x := 5)`],
    ['bytes literal keeps prefix/quotes/escapes', `data = b'\\x00abc'`],
    ['ellipsis literal', `x = ...`],
    ['await in value position', `result = await fetch(url)`],
  ];
  for (const [name, source] of EXACT) {
    it(name, () => {
      const once = trip(source);
      expect(once).toBe(source.trim());
      expect(trip(once)).toBe(source.trim());
    });
  }

  it('produces real blocks, not ast_Raw, for the new constructs', () => {
    const { rawXml } = convert(
      `if (n := 10) > 4:\n    d = b'ab'\n    e = ...\n    r = await go()`,
    );
    expect(rawXml.querySelectorAll('block[type="ast_Raw"]').length).toBe(0);
    for (const type of ['ast_NamedExpr', 'ast_Bytes', 'ast_Ellipsis', 'ast_Await']) {
      expect(rawXml.querySelectorAll(`block[type="${type}"]`).length).toBe(1);
    }
  });
});

describe('async constructs degrade per-statement (M3.6)', () => {
  it('async def becomes one ast_Raw; siblings stay real blocks', () => {
    const source = `async def go():\n    return 1\nprint(2)`;
    const { rawXml } = convert(source);
    // Exactly one raw chunk (the async def), and print survives as a block.
    expect(rawXml.querySelectorAll('block[type="ast_Raw"]').length).toBe(1);
    expect(rawXml.querySelectorAll('block[type="ast_Call"]').length).toBe(1);
    expect(rawXml.querySelectorAll('block[type="ast_FunctionDef"]').length).toBe(0);
    // Regenerated text preserves the async source verbatim.
    const text = xmlToPython(rawXml).trim();
    expect(text).toContain('async def go():');
    expect(text).toContain('print(2)');
  });

  it('async for and async with also raw-fallback cleanly', () => {
    for (const source of [
      `async for x in feed:\n    print(x)`,
      `async with lock:\n    print(1)`,
    ]) {
      const { rawXml } = convert(source);
      expect(rawXml.querySelectorAll('block[type="ast_Raw"]').length).toBe(1);
      expect(xmlToPython(rawXml).trim()).toBe(source);
    }
  });
});
